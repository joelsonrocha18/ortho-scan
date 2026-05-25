import type { Timestamp } from 'firebase/firestore'

export type Patient = {
  id: string
  shortId?: string
  name: string
  firstName?: string
  lastName?: string
  cpf?: string
  phone?: string
  whatsapp?: string
  email?: string
  birthDate?: string
  gender?: 'masculino' | 'feminino' | 'outro'
  clinicId?: string
  address?: {
    cep?: string
    street?: string
    number?: string
    complement?: string
    district?: string
    city?: string
    state?: string
  }
  primaryDentistId?: string
  portal_uid?: string
  portal_enabled?: boolean
  active_invite_id?: string
  current_tray?: number
  treatment_start_date?: Timestamp
  notes?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
