import type { Timestamp } from 'firebase/firestore'

export type ChatParticipantRole =
  | 'master_admin'
  | 'dentist_admin'
  | 'lab_tech'
  | 'receptionist'
  | 'dentist_client'

export type ChatRoom = {
  id: string
  case_id: string
  clinic_id: string
  dentist_id: string
  participant_uids: string[]
  participant_roles: Record<string, ChatParticipantRole>
  last_message_text: string
  last_message_at: Timestamp
  last_message_by_uid: string
  unread_counts: Record<string, number>
  created_at: Timestamp
}

export type MessageType = 'text' | 'image' | 'file' | 'audio'

export type ChatMessage = {
  id: string
  room_id: string
  case_id: string
  clinic_id: string
  sender_uid: string
  sender_role: ChatParticipantRole
  sender_name: string
  type: MessageType
  text?: string
  attachment_url?: string
  attachment_name?: string
  attachment_size?: number
  attachment_mime?: string
  duration_seconds?: number
  read_by: Record<string, Timestamp>
  deleted_at?: Timestamp
  created_at: Timestamp
}

export type ChatReadReceipt = {
  room_id: string
  uid: string
  last_read_at: Timestamp
  last_read_message_id: string
}
