export type Patient = {
  id: string
  shortId?: string
  name: string
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
    district?: string
    city?: string
    state?: string
  }
  primaryDentistId?: string
  notes?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
