import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'
import { DATA_MODE } from '../data/dataMode'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import { uploadToStorage } from './storageRepo'
import { listProfiles } from './profileRepo'

export type InternalChatMessage = {
  id: string
  sender_user_id: string
  sender_name: string
  sender_role: string
  body: string
  room_key: string
  room_label: string
  created_at: string
}

export type InternalChatContact = {
  userId: string
  name: string
  email?: string
  role: string
  clinicId?: string
}

function getFirestoreDb() {
  if (!firestoreDb) throw new Error('Firebase não configurado.')
  return firestoreDb
}

function stableRoomPair(a: string, b: string) {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a]
}

export function directRoomKey(userA: string, userB: string) {
  const [a, b] = stableRoomPair(userA, userB)
  return `dm_${a}_${b}`
}

function shouldArchiveChatMessage() {
  const explicit = ((import.meta.env.VITE_CHAT_ARCHIVE_TO_STORAGE as string | undefined) ?? '').trim().toLowerCase()
  return explicit === 'true'
}

async function archiveChatMessage(message: InternalChatMessage) {
  if (!shouldArchiveChatMessage()) return
  const safeRoom = message.room_key.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const safeId = message.id.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const fileName = `${message.created_at.slice(0, 19).replace(/[:T]/g, '-')}_${safeId}.json`
  const path = `internal-chat/${safeRoom}/${fileName}`
  const payload = JSON.stringify({
    id: message.id,
    roomKey: message.room_key,
    roomLabel: message.room_label,
    senderUserId: message.sender_user_id,
    senderName: message.sender_name,
    senderRole: message.sender_role,
    body: message.body,
    createdAt: message.created_at,
  })
  const file = new File([payload], `${safeId}.json`, { type: 'application/json' })
  await uploadToStorage(path, file)
}

function mapMessageDoc(id: string, data: Record<string, unknown>): InternalChatMessage {
  return {
    id,
    sender_user_id: String(data.sender_user_id ?? data.senderUserId ?? ''),
    sender_name: String(data.sender_name ?? data.senderName ?? ''),
    sender_role: String(data.sender_role ?? data.senderRole ?? ''),
    body: String(data.body ?? ''),
    room_key: String(data.room_key ?? data.roomKey ?? ''),
    room_label: String(data.room_label ?? data.roomLabel ?? ''),
    created_at: String(data.created_at ?? data.createdAt ?? nowIsoDateTime()),
  }
}

export async function listInternalChatContacts(payload: { userId: string; clinicId?: string }) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Chat interno remoto disponível apenas no Firebase.', data: [] as InternalChatContact[] }
  }
  try {
    const profiles = await listProfiles()
    const scoped = profiles.filter((row) => {
      if (!row.user_id || row.user_id === payload.userId) return false
      if (!payload.clinicId) return true
      if (row.role === 'master_admin') return true
      return (row.clinic_id ?? '') === payload.clinicId
    })
    return {
      ok: true as const,
      data: scoped
        .map((row) => ({
          userId: row.user_id,
          name: (row.full_name ?? '').trim() || (row.login_email ?? '').trim() || 'Usuário',
          email: (row.login_email ?? '').trim() || undefined,
          role: row.role,
          clinicId: row.clinic_id ?? undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Falha ao listar contatos.',
      data: [] as InternalChatContact[],
    }
  }
}

export async function ensureInternalDirectRoom(payload: { me: string; other: string }) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Chat interno remoto indisponível.', roomKey: '' }
  if (!payload.me || !payload.other || payload.me === payload.other) {
    return { ok: false as const, error: 'Participantes inválidos.', roomKey: '' }
  }
  const [userA, userB] = stableRoomPair(payload.me, payload.other)
  const roomKey = directRoomKey(userA, userB)
  const now = nowIsoDateTime()
  await setDoc(
    doc(getFirestoreDb(), 'internal_chat_rooms', roomKey),
    {
      room_key: roomKey,
      roomKey,
      user_a: userA,
      userA,
      user_b: userB,
      userB,
      created_by: payload.me,
      createdBy: payload.me,
      updated_at: now,
      updatedAt: now,
    },
    { merge: true },
  )
  return { ok: true as const, roomKey }
}

export async function listInternalChatMessages(roomKey: string, messageLimit = 80) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Chat interno remoto indisponível.', data: [] as InternalChatMessage[] }
  }
  const snapshot = await getDocs(
    query(
      collection(getFirestoreDb(), 'internal_chat_messages'),
      where('room_key', '==', roomKey),
      orderBy('created_at', 'asc'),
      limit(messageLimit),
    ),
  )
  return {
    ok: true as const,
    data: snapshot.docs.map((item) => mapMessageDoc(item.id, item.data())),
  }
}

export function subscribeInternalChatMessages(
  roomKey: string,
  onChange: (messages: InternalChatMessage[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (DATA_MODE !== 'firebase' || !roomKey) {
    return () => undefined
  }
  return onSnapshot(
    query(
      collection(getFirestoreDb(), 'internal_chat_messages'),
      where('room_key', '==', roomKey),
      orderBy('created_at', 'asc'),
      limit(200),
    ),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => mapMessageDoc(item.id, item.data())))
    },
    (error) => {
      onError?.(error.message)
    },
  )
}

export async function sendInternalChatMessage(payload: {
  senderUserId: string
  senderName: string
  senderRole: string
  body: string
  roomKey: string
  roomLabel: string
}) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Chat interno remoto indisponível.' }
  const id = createEntityId('chat')
  const createdAt = nowIsoDateTime()
  const message: InternalChatMessage = {
    id,
    sender_user_id: payload.senderUserId,
    sender_name: payload.senderName,
    sender_role: payload.senderRole,
    body: payload.body,
    room_key: payload.roomKey,
    room_label: payload.roomLabel,
    created_at: createdAt,
  }
  await setDoc(doc(getFirestoreDb(), 'internal_chat_messages', id), {
    ...message,
    senderUserId: payload.senderUserId,
    senderName: payload.senderName,
    senderRole: payload.senderRole,
    roomKey: payload.roomKey,
    roomLabel: payload.roomLabel,
    createdAt,
  })
  await archiveChatMessage(message)
  return { ok: true as const }
}

export async function markInternalChatRoomRead(payload: { userId: string; roomKey: string; readAt?: string }) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Chat interno remoto indisponível.' }
  const timestamp = payload.readAt ?? nowIsoDateTime()
  const docId = `${payload.userId}_${payload.roomKey}`
  await setDoc(
    doc(getFirestoreDb(), 'internal_chat_reads', docId),
    {
      user_id: payload.userId,
      userId: payload.userId,
      room_key: payload.roomKey,
      roomKey: payload.roomKey,
      last_read_at: timestamp,
      lastReadAt: timestamp,
      updated_at: timestamp,
      updatedAt: timestamp,
    },
    { merge: true },
  )
  return { ok: true as const }
}

export async function listInternalChatUnreadCounts(payload: { userId: string; roomKeys: string[] }) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Chat interno remoto indisponível.', data: {} as Record<string, number> }
  }
  const uniqueKeys = Array.from(new Set(payload.roomKeys.filter(Boolean)))
  if (uniqueKeys.length === 0) return { ok: true as const, data: {} as Record<string, number> }

  const readsSnapshot = await getDocs(
    query(collection(getFirestoreDb(), 'internal_chat_reads'), where('user_id', '==', payload.userId)),
  )
  const readMap = new Map(
    readsSnapshot.docs.map((item) => {
      const data = item.data()
      return [String(data.room_key ?? data.roomKey ?? ''), String(data.last_read_at ?? data.lastReadAt ?? '1970-01-01T00:00:00.000Z')]
    }),
  )

  const counts: Record<string, number> = {}
  await Promise.all(
    uniqueKeys.map(async (roomKey) => {
      const lastReadAt = readMap.get(roomKey) ?? '1970-01-01T00:00:00.000Z'
      const countSnapshot = await getCountFromServer(
        query(
          collection(getFirestoreDb(), 'internal_chat_messages'),
          where('room_key', '==', roomKey),
          where('created_at', '>', lastReadAt),
          where('sender_user_id', '!=', payload.userId),
        ),
      )
      counts[roomKey] = countSnapshot.data().count
    }),
  )
  return { ok: true as const, data: counts }
}
