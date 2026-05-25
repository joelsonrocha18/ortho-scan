import type { Timestamp } from 'firebase/firestore'

export type WorkflowStage = {
  id: string
  label: string
  order: number
  color?: string
  is_final: boolean
}

export type LabWorkflowConfig = {
  clinicId: string
  stages: WorkflowStage[]
  updated_at: Timestamp
  updated_by: string
}
