import type { Timestamp } from 'firebase-admin/firestore'

export type LabStage =
  | 'queued'
  | 'in_production'
  | 'qc'
  | 'shipped'
  | 'delivered'
  | 'rework'

export type StageEvent = {
  from_sub_status_id: string
  to_sub_status_id: string
  from_stage: LabStage
  to_stage: LabStage
  moved_by_uid: string
  moved_at: Timestamp
  note?: string
}

export type LabItemDoc = {
  id?: string
  case_id: string
  clinic_id: string
  stage: LabStage
  sub_status_id: string
  stage_history?: StageEvent[]
  updated_at: Timestamp
}
