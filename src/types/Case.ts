import type { ProductType } from './Product'
import type {
  CaseFinancialSnapshot,
  CaseLifecycleStatusValue,
  CasePlanningVersion,
  CaseReworkSummary,
  CaseSLASnapshot,
  CaseStageApproval,
  LabStageValue,
  OrthoDomainEvent,
  OrthoDomainEventName,
  SLAStatusValue,
} from './Domain'
import type { Timestamp } from 'firebase/firestore'

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

export type CaseTimelineEntry = {
  id: string
  at: string
  type:
    | 'case_created'
    | 'status_changed'
    | 'note_added'
    | 'delivery_registered'
    | 'installation_registered'
    | 'tray_updated'
    | 'contract_updated'
    | 'budget_updated'
    | 'planning_version_published'
    | 'planning_version_approved'
    | 'lab_event'
    | 'sla_alert'
    | 'audit'
  title: string
  description?: string
  actorName?: string
  actorEmail?: string
  source?: 'domain' | 'audit'
  metadata?: {
    status?: CaseStatus
    phase?: CasePhase
    trayNumber?: number
    noteScope?: 'planning' | 'budget' | 'contract' | 'installation' | 'tray' | 'general'
    caseLifecycleStatus?: CaseLifecycleStatusValue
    labStage?: LabStageValue
    slaStatus?: SLAStatusValue
    domainEvent?: OrthoDomainEventName
    caseId?: string
    labOrderId?: string
  }
}

export type LabStageChangedEvent = {
  type: 'lab_stage_changed'
  lab_item_id: string
  from_sub_status_id: string
  to_sub_status_id: string
  from_stage: LabStageValue
  to_stage: LabStageValue
  moved_by_uid: string
  moved_at: Timestamp
  note?: string
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
  total_trays?: number
  changeEveryDays: number
  tray_change_interval_days?: number
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
  planningNote?: string
  complaint?: string
  dentistGuidance?: string
  planningVersions?: CasePlanningVersion[]
  stageApprovals?: CaseStageApproval[]
  financial?: CaseFinancialSnapshot
  lifecycleStatus?: CaseLifecycleStatusValue
  lab_stage?: LabStageValue
  lab_sub_status_id?: string
  current_lab_item_id?: string
  patient_portal_enabled?: boolean
  sla?: CaseSLASnapshot
  reworkSummary?: CaseReworkSummary
  domainEvents?: OrthoDomainEvent[]
  timeline?: LabStageChangedEvent[]
  timelineEntries?: CaseTimelineEntry[]
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
