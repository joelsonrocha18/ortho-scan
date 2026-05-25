import type { Timestamp } from 'firebase-admin/firestore'

export type FcmPlatform = 'web' | 'android' | 'ios'

export type FcmTokenEntry = {
  uid: string
  token: string
  platform: FcmPlatform
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
