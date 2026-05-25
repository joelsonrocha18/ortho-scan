import type { Timestamp } from 'firebase/firestore'

export type PatientInviteStatus = 'pending' | 'used' | 'expired'

export type PatientInvite = {
  id: string
  code: string
  patient_id: string
  clinic_id: string
  dentist_id: string
  case_id: string
  created_by_uid: string
  created_at: Timestamp
  expires_at: Timestamp
  used_at?: Timestamp
  firebase_uid?: string
  status: PatientInviteStatus
  link_token: string
}
