export type Role =
  | 'master_admin'
  | 'dentist_admin'
  | 'dentist_client'
  | 'clinic_client'
  | 'lab_tech'
  | 'receptionist'

export type User = {
  id: string
  shortId?: string
  name: string
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
  isActive: boolean
  linkedDentistId?: string
  linkedClinicId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
