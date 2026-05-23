import { listCasesForUser, listLabItemsForUser, listPatientsForUser, listScansForUser } from '../../../../auth/scope'
import { loadDb } from '../../../../data/db'
import { ok } from '../../../../shared/errors'
import type { User } from '../../../../types/User'
import { CaseLifecycleService } from '../../../cases/domain/services/CaseLifecycleService'
import { toLabOrder } from '../../../lab/domain/entities/LabOrder'
import type { DashboardDateRange, DashboardRepository } from '../../application/ports/DashboardRepository'

function isWithinDateRange(value: string | undefined, period?: DashboardDateRange) {
  if (!period || !value) return true
  const date = value.slice(0, 10)
  return date >= period.startDate && date <= period.endDate
}

export class LocalDashboardRepository implements DashboardRepository {
  private readonly currentUser: User | null

  constructor(currentUser: User | null) {
    this.currentUser = currentUser
  }

  loadSnapshot(period?: DashboardDateRange) {
    const db = loadDb()
    const visibleCases = this.currentUser ? listCasesForUser(db, this.currentUser) : db.cases
    const visiblePatients = this.currentUser ? listPatientsForUser(db, this.currentUser) : db.patients
    const visibleScans = this.currentUser ? listScansForUser(db, this.currentUser) : db.scans
    const visibleLabOrders = (this.currentUser ? listLabItemsForUser(db, this.currentUser) : db.labItems).map(toLabOrder)
    const periodCases = visibleCases.filter((caseItem) => isWithinDateRange(caseItem.createdAt ?? caseItem.scanDate, period))
    const periodScans = visibleScans.filter((scan) => isWithinDateRange(scan.scanDate ?? scan.createdAt, period))
    const periodLabOrders = visibleLabOrders.filter((order) => isWithinDateRange(order.createdAt ?? order.plannedDate, period))
    const cases = periodCases.map((caseItem) =>
      CaseLifecycleService.refreshCase(caseItem, visibleLabOrders.filter((order) => order.caseId === caseItem.id)),
    )
    return ok({
      cases,
      patients: visiblePatients,
      scans: periodScans,
      labOrders: periodLabOrders,
    })
  }
}

export function createLocalDashboardRepository(currentUser: User | null) {
  return new LocalDashboardRepository(currentUser)
}
