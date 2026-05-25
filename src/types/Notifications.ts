import type { Timestamp } from 'firebase/firestore'

export type FcmTokenEntry = {
  uid: string
  token: string
  platform: 'web' | 'android' | 'ios'
  created_at: Timestamp
  last_used_at: Timestamp
}

export type NotificationPayload = {
  title: string
  body: string
  data?: Record<string, string>
  icon?: string
  badge?: string
}
