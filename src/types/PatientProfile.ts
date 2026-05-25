import type { Timestamp } from 'firebase/firestore'

export type PatientProfile = {
  uid: string
  patient_id: string
  clinic_id: string
  dentist_id: string
  case_ids: string[]
  display_name?: string
  photo_url?: string
  created_at: Timestamp
  last_login_at: Timestamp
}
