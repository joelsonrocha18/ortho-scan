import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../../lib/firebaseClient'
import type { ChatMessage, ChatParticipantRole, ChatRoom, MessageType } from '../../../../types/Chat'

function getFirestoreDb() {
  if (!db) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return db
}

export function subscribeToChatRoom(
  roomId: string,
  onUpdate: (room: ChatRoom) => void,
): () => void {
  return onSnapshot(doc(getFirestoreDb(), 'chat_rooms', roomId), (snap) => {
    if (snap.exists()) onUpdate({ id: snap.id, ...snap.data() } as ChatRoom)
  })
}

export function subscribeToChatMessages(
  roomId: string,
  onUpdate: (messages: ChatMessage[]) => void,
  messageLimit = 50,
): () => void {
  const q = query(
    collection(getFirestoreDb(), 'chat_rooms', roomId, 'messages'),
    orderBy('created_at', 'desc'),
    limit(messageLimit),
  )

  return onSnapshot(q, (snap) => {
    const messages = snap.docs
      .map((item) => ({ id: item.id, ...item.data() }) as ChatMessage)
      .reverse()
    onUpdate(messages)
  })
}

export async function sendTextMessage(params: {
  roomId: string
  caseId: string
  clinicId: string
  senderUid: string
  senderRole: ChatParticipantRole
  senderName: string
  text: string
}): Promise<void> {
  const { roomId, ...rest } = params
  await addDoc(collection(getFirestoreDb(), 'chat_rooms', roomId, 'messages'), {
    room_id: roomId,
    case_id: rest.caseId,
    clinic_id: rest.clinicId,
    sender_uid: rest.senderUid,
    sender_role: rest.senderRole,
    sender_name: rest.senderName,
    type: 'text',
    text: rest.text,
    read_by: { [rest.senderUid]: serverTimestamp() },
    created_at: serverTimestamp(),
  })
}

export async function sendAttachmentMessage(params: {
  roomId: string
  caseId: string
  clinicId: string
  senderUid: string
  senderRole: ChatParticipantRole
  senderName: string
  type: Exclude<MessageType, 'text'>
  attachmentUrl: string
  attachmentName: string
  attachmentSize: number
  attachmentMime: string
  durationSeconds?: number
}): Promise<void> {
  const { roomId, ...rest } = params
  await addDoc(collection(getFirestoreDb(), 'chat_rooms', roomId, 'messages'), {
    room_id: roomId,
    case_id: rest.caseId,
    clinic_id: rest.clinicId,
    sender_uid: rest.senderUid,
    sender_role: rest.senderRole,
    sender_name: rest.senderName,
    type: rest.type,
    attachment_url: rest.attachmentUrl,
    attachment_name: rest.attachmentName,
    attachment_size: rest.attachmentSize,
    attachment_mime: rest.attachmentMime,
    ...(rest.durationSeconds !== undefined ? { duration_seconds: rest.durationSeconds } : {}),
    read_by: { [rest.senderUid]: serverTimestamp() },
    created_at: serverTimestamp(),
  })
}
