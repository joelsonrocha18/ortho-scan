export type ScanStatus = 'pendente' | 'aprovado' | 'reprovado' | 'convertido'
export type ScanArch = 'superior' | 'inferior' | 'ambos'
export type ScanFileKind = 'scan3d' | 'foto_intra' | 'foto_extra' | 'raiox' | 'dicom' | 'projeto' | 'outro'
export type ScanRxType = 'panoramica' | 'teleradiografia' | 'tomografia'
export type ScanArchSide = 'superior' | 'inferior' | 'mordida'

export type ScanAttachment = {
  id: string
  name: string
  kind: ScanFileKind
  rxType?: ScanRxType
  slotId?: string
  arch?: ScanArchSide
  mime?: string
  size?: number
  url?: string
  filePath?: string
  isLocal?: boolean
  status?: 'ok' | 'erro'
  attachedAt?: string
  note?: string
  flaggedAt?: string
  flaggedReason?: string
  createdAt: string
}

export type PhotoSlot = {
  id: string
  label: string
  kind: 'foto_intra' | 'foto_extra'
}

export type Scan = {
  id: string
  shortId?: string
  serviceOrderCode?: string
  purposeProductId?: string
  purposeProductType?: string
  purposeLabel?: string
  patientName: string
  patientId?: string
  dentistId?: string
  requestedByDentistId?: string
  clinicId?: string
  scanDate: string
  arch: ScanArch
  complaint?: string
  dentistGuidance?: string
  notes?: string
  planningDetectedUpperTrays?: number
  planningDetectedLowerTrays?: number
  planningDetectedAt?: string
  planningDetectedSource?: 'keyframes' | 'goalset'
  attachments: ScanAttachment[]
  status: ScanStatus
  linkedCaseId?: string
  createdAt: string
  updatedAt: string
}
