import type { ProductType } from './Product'
import type { Timestamp } from 'firebase/firestore'
import type {
  LabFinancialImpact,
  LabProductionChecklist,
  LabStageSLASnapshot,
  LabStageTimelineRecord,
  LabStageValue,
  OrthoDomainEvent,
} from './Domain'

export type LabStatus = 'aguardando_iniciar' | 'em_producao' | 'controle_qualidade' | 'prontas'

export type LabPriority = 'Baixo' | 'Medio' | 'Urgente'

export type LabStage = LabStageValue

export type StageEvent = {
  from_sub_status_id: string
  to_sub_status_id: string
  from_stage: LabStage
  to_stage: LabStage
  moved_by_uid: string
  moved_at: Timestamp
  note?: string
}

export type LabItem = {
  id: string
  productType?: ProductType
  productId?: ProductType
  requestedProductId?: string
  requestedProductLabel?: string
  patientId?: string
  dentistId?: string
  clinicId?: string
  requestCode?: string
  requestKind?: 'producao' | 'reconfeccao' | 'reposicao_programada'
  expectedReplacementDate?: string
  deliveredToProfessionalAt?: string
  caseId?: string
  arch: 'superior' | 'inferior' | 'ambos'
  plannedUpperQty?: number
  plannedLowerQty?: number
  planningDefinedAt?: string
  trayNumber: number
  patientName: string
  plannedDate: string
  dueDate: string
  status: LabStatus
  stage?: LabStageValue
  batch_type?: 'single' | 'batch'
  tray_numbers?: number[]
  sub_status_id?: string
  stage_history?: StageEvent[]
  assigned_to?: string
  sla_due_at?: Timestamp
  stageTimeline?: LabStageTimelineRecord[]
  sla?: LabStageSLASnapshot
  productionChecklist?: LabProductionChecklist
  reworkOfCaseId?: string
  reworkOfLabOrderId?: string
  reworkOfTrayNumber?: number
  financialImpact?: LabFinancialImpact
  domainEvents?: OrthoDomainEvent[]
  priority: LabPriority
  notes?: string
  createdAt: string
  updatedAt: string
}
