import { supabase } from '../lib/supabaseClient'
import { uploadToStorage } from './storageRepo'

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

function stableRoomPair(a: string, b: string) {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a]
}

export function directRoomKey(userA: string, userB: string) {
  const [a, b] = stableRoomPair(userA, userB)
  return `dm_${a}_${b}`
}

function shouldArchiveChatMessage() {
  const storageProvider = ((import.meta.env.VITE_STORAGE_PROVIDER as string | undefined) ?? 'supabase').trim().toLowerCase()
  const explicit = ((import.meta.env.VITE_CHAT_ARCHIVE_TO_STORAGE as string | undefined) ?? '').trim().toLowerCase()
  return explicit === 'true' || storageProvider === 'microsoft_drive'
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

export async function listInternalChatContacts(payload: { userId: string; clinicId?: string }) {
  if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.', data: [] as InternalChatContact[] }
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, login_email, role, clinic_id, is_active, deleted_at')
    .is('deleted_at', null)
    .eq('is_active', true)
  if (error) return { ok: false as const, error: error.message, data: [] as InternalChatContact[] }

  const current = payload.userId
  const scoped = ((data ?? []) as Array<{
    user_id: string
    full_name?: string | null
    login_email?: string | null
    role: string
    clinic_id?: string | null
  }>).filter((row) => {
    if (!row.user_id || row.user_id === current) return false
    if (!payload.clinicId) return true
    if (row.role === 'master_admin') return true
    return (row.clinic_id ?? '') === payload.clinicId
  })

  return {
    ok: true as const,
    data: scoped
      .map((row) => ({
        userId: row.user_id,
        name: (row.full_name ?? '').trim() || (row.login_email ?? '').trim() || 'Usuario',
        email: (row.login_email ?? '').trim() || undefined,
        role: row.role,
        clinicId: row.clinic_id ?? undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function ensureInternalDirectRoom(payload: { me: string; other: string }) {
  if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.', roomKey: '' }
  if (!payload.me || !payload.other || payload.me === payload.other) {
    return { ok: false as const, error: 'Participantes invalidos.', roomKey: '' }
  }
  const [userA, userB] = stableRoomPair(payload.me, payload.other)
  const roomKey = directRoomKey(userA, userB)
  const { error } = await supabase
    .from('internal_chat_rooms')
    .upsert({
      room_key: roomKey,
      user_a: userA,
      user_b: userB,
      created_by: payload.me,
    })
  if (error) return { ok: false as const, error: error.message, roomKey: '' }
  return { ok: true as const, roomKey }
}

export async function listInternalChatMessages(roomKey: string, limit = 80) {
  if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.', data: [] as InternalChatMessage[] }
  const { data, error } = await supabase
    .from('internal_chat_messages')
    .select('id, sender_user_id, sender_name, sender_role, body, room_key, room_label, created_at')
    .eq('room_key', roomKey)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) return { ok: false as const, error: error.message, data: [] as InternalChatMessage[] }
  return { ok: true as const, data: (data ?? []) as InternalChatMessage[] }
}

export async function sendInternalChatMessage(payload: { senderUserId: string; senderName: string; senderRole: string; body: string; roomKey: string; roomLabel: string }) {
  if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.' }
  const insertPayload = {
    sender_user_id: payload.senderUserId,
    sender_name: payload.senderName,
    sender_role: payload.senderRole,
    body: payload.body,
    room_key: payload.roomKey,
    room_label: payload.roomLabel,
  }
  const { data, error } = await supabase
    .from('internal_chat_messages')
    .insert(insertPayload)
    .select('id, sender_user_id, sender_name, sender_role, body, room_key, room_label, created_at')
    .maybeSingle()
  if (error) return { ok: false as const, error: error.message }
  const inserted = data as InternalChatMessage | null
  if (inserted) {
    await archiveChatMessage(inserted)
  }
  return { ok: true as const }
}

export async function markInternalChatRoomRead(payload: { userId: string; roomKey: string; readAt?: string }) {
  if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.' }
  const timestamp = payload.readAt ?? new Date().toISOString()
  const { error } = await supabase.from('internal_chat_reads').upsert({
    user_id: payload.userId,
    room_key: payload.roomKey,
    last_read_at: timestamp,
    updated_at: timestamp,
  })
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}

export async function listInternalChatUnreadCounts(payload: { userId: string; roomKeys: string[] }) {
  const sb = supabase
  if (!sb) return { ok: false as const, error: 'Supabase nao configurado.', data: {} as Record<string, number> }
  const uniqueKeys = Array.from(new Set(payload.roomKeys.filter(Boolean)))
  if (uniqueKeys.length === 0) return { ok: true as const, data: {} as Record<string, number> }

  const { data: reads, error: readsError } = await sb
    .from('internal_chat_reads')
    .select('room_key, last_read_at')
    .eq('user_id', payload.userId)
    .in('room_key', uniqueKeys)
  if (readsError) return { ok: false as const, error: readsError.message, data: {} as Record<string, number> }

  const readMap = new Map((reads ?? []).map((item) => [item.room_key as string, (item.last_read_at as string) ?? '1970-01-01T00:00:00.000Z']))
  const counts: Record<string, number> = {}

  await Promise.all(
    uniqueKeys.map(async (roomKey) => {
      const lastReadAt = readMap.get(roomKey) ?? '1970-01-01T00:00:00.000Z'
      const { count } = await sb
        .from('internal_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room_key', roomKey)
        .gt('created_at', lastReadAt)
        .neq('sender_user_id', payload.userId)
      counts[roomKey] = count ?? 0
    }),
  )

  return { ok: true as const, data: counts }
}
