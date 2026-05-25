import type { Timestamp } from 'firebase-admin/firestore'

export type ChatParticipantRole =
  | 'master_admin'
  | 'dentist_admin'
  | 'lab_tech'
  | 'receptionist'
  | 'dentist_client'

export type MessageType = 'text' | 'image' | 'file' | 'audio'

export type ChatMessage = {
  id?: string
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
