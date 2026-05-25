import type { Timestamp } from 'firebase/firestore'

export type TrayConfirmation = {
  id: string
  case_id: string
  patient_id: string
  clinic_id: string
  dentist_id: string
  tray_number: number
  confirmed_at: Timestamp
  selfie_url?: string
  selfie_uploaded_at?: Timestamp
  note?: string
  source: 'app' | 'portal_web'
}
