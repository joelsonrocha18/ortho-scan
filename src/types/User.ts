import type { Permission } from '../auth/permissions'

export type Role =
  | 'master_admin'
  | 'dentist_admin'
  | 'dentist_client'
  | 'clinic_client'
  | 'lab_tech'
  | 'receptionist'

export type AccessMethod = 'username' | 'email' | 'google' | 'apple'

export type User = {
  id: string
  shortId?: string
  name: string
  accessMethod?: AccessMethod
  username?: string
  email: string
  password?: string
  cpf?: string
  cep?: string
  birthDate?: string
  phone?: string
  whatsapp?: string
  addressLine?: string
  role: Role
  permissions?: Permission[]
  isActive: boolean
  linkedDentistId?: string
  linkedClinicId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
