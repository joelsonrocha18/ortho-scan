import type { ProductType } from './Product'

export type CaseStatus =
  | 'planejamento'
  | 'em_producao'
  | 'em_entrega'
  | 'em_tratamento'
  | 'aguardando_reposicao'
  | 'finalizado'
export type CasePhase =
  | 'planejamento'
  | 'orçamento'
  | 'contrato_pendente'
  | 'contrato_aprovado'
  | 'em_producao'
  | 'finalizado'

export type TrayState = 'pendente' | 'em_producao' | 'pronta' | 'entregue' | 'rework'

export type CaseTray = {
  trayNumber: number
  state: TrayState
  dueDate?: string
  deliveredAt?: string
  notes?: string
}

export type CaseAttachment = {
  id: string
  name: string
  type: 'scan' | 'foto' | 'outro'
  url: string
  mime?: string
  size?: number
  isLocal?: boolean
  status?: 'ok' | 'erro'
  attachedAt?: string
  note?: string
  flaggedAt?: string
  flaggedReason?: string
  createdAt: string
}

export type CaseDeliveryLot = {
  id: string
  arch: 'superior' | 'inferior' | 'ambos'
  fromTray: number
  toTray: number
  quantity: number
  deliveredToDoctorAt: string
  note?: string
  createdAt: string
}

export type CaseInstallation = {
  installedAt: string
  note?: string
  deliveredUpper?: number
  deliveredLower?: number
  patientDeliveryLots?: Array<{
    id: string
    fromTray: number
    toTray: number
    quantity: number
    deliveredAt: string
    note?: string
    createdAt: string
  }>
  actualChangeDates?: Array<{
    trayNumber: number
    changedAt: string
    arch?: 'superior' | 'inferior' | 'ambos'
  }>
  manualChangeCompletion?: Array<{
    trayNumber: number
    completed: boolean
    arch?: 'superior' | 'inferior' | 'ambos'
  }>
}

export type Case = {
  id: string
  shortId?: string
  productType?: ProductType
  productId?: ProductType
  requestedProductId?: string
  requestedProductLabel?: string
  treatmentCode?: string
  treatmentOrigin?: 'interno' | 'externo'
  patientName: string
  patientId?: string
  dentistId?: string
  requestedByDentistId?: string
  clinicId?: string
  scanDate: string
  totalTrays: number
  changeEveryDays: number
  totalTraysUpper?: number
  totalTraysLower?: number
  attachmentBondingTray?: boolean
  status: CaseStatus
  phase: CasePhase
  budget?: {
    value?: number
    notes?: string
    createdAt?: string
  }
  contract?: {
    status: 'pendente' | 'aprovado'
    approvedAt?: string
    notes?: string
  }
  deliveryLots?: CaseDeliveryLot[]
  installation?: CaseInstallation
  trays: CaseTray[]
  attachments: CaseAttachment[]
  sourceScanId?: string
  sourceExamCode?: string
  arch?: 'superior' | 'inferior' | 'ambos'
  complaint?: string
  dentistGuidance?: string
  scanFiles?: {
    id: string
    name: string
    kind: 'scan3d' | 'foto_intra' | 'foto_extra' | 'raiox' | 'dicom' | 'projeto' | 'outro'
    slotId?: string
    rxType?: 'panoramica' | 'teleradiografia' | 'tomografia'
    arch?: 'superior' | 'inferior' | 'mordida'
    isLocal?: boolean
    url?: string
    filePath?: string
    status?: 'ok' | 'erro'
    attachedAt?: string
    note?: string
    flaggedAt?: string
    flaggedReason?: string
    createdAt: string
  }[]
  createdAt: string
  updatedAt: string
}

