import type { Result } from '../../../../shared/errors'
import type { MaybePromise } from '../../../../shared/types'
import type { Case } from '../../../../types/Case'
import type { Patient } from '../../../../types/Patient'
import type { Scan } from '../../../../types/Scan'
import type { LabOrder } from '../../../lab/domain/entities/LabOrder'

export type ExecutiveDashboardSnapshot = {
  cases: Case[]
  patients: Patient[]
  scans: Scan[]
  labOrders: LabOrder[]
}

export type DashboardDateRange = {
  startDate: string
  endDate: string
}

export interface DashboardRepository {
  loadSnapshot(period?: DashboardDateRange): MaybePromise<Result<ExecutiveDashboardSnapshot, string>>
}
