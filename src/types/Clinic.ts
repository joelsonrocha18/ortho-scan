export type ClinicAddress = {
  cep?: string
  street?: string
  number?: string
  district?: string
  city?: string
  state?: string
}

export type Clinic = {
  id: string
  shortId?: string
  legalName?: string
  tradeName: string
  cnpj?: string
  phone?: string
  whatsapp?: string
  email?: string
  address?: ClinicAddress
  notes?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
