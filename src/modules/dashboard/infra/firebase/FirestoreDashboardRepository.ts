import { listCasesFirebase } from '../../../../data/caseRepo'
import { listScansFirebase } from '../../../../data/scanRepo'
import { listPatientsFirebase } from '../../../../repo/patientRepo'
import { ok, err, type Result } from '../../../../shared/errors'
import type { Case } from '../../../../types/Case'
import type { Patient } from '../../../../types/Patient'
import type { Scan } from '../../../../types/Scan'
import type { User } from '../../../../types/User'
import type { LabOrder } from '../../../lab/domain/entities/LabOrder'
import { CaseLifecycleService } from '../../../cases/domain/services/CaseLifecycleService'
import type { DashboardDateRange, DashboardRepository, ExecutiveDashboardSnapshot } from '../../application/ports/DashboardRepository'
import { listLabOrdersFirebase } from '../../../lab/infra/firebase/FirestoreLabRepository'

function isWithinDateRange(value: string | undefined, period?: DashboardDateRange) {
  if (!period || !value) return true
  const date = value.slice(0, 10)
  return date >= period.startDate && date <= period.endDate
}

function scopedPatients(patients: Patient[], currentUser: User | null) {
  if (!currentUser) return []
  if (currentUser.role === 'master_admin') return patients
  if (currentUser.role === 'dentist_client') {
    return patients.filter((patient) => patient.primaryDentistId === currentUser.linkedDentistId)
  }
  if (currentUser.linkedClinicId) {
    return patients.filter((patient) => patient.clinicId === currentUser.linkedClinicId)
  }
  return patients
}

function scopedCases(cases: Case[], patients: Patient[], currentUser: User | null) {
  if (!currentUser) return []
  if (currentUser.role === 'master_admin') return cases
  const patientIds = new Set(patients.map((patient) => patient.id))
  if (currentUser.role === 'dentist_client') {
    return cases.filter((caseItem) =>
      (caseItem.patientId && patientIds.has(caseItem.patientId)) ||
      caseItem.dentistId === currentUser.linkedDentistId ||
      caseItem.requestedByDentistId === currentUser.linkedDentistId,
    )
  }
  if (currentUser.linkedClinicId) {
    return cases.filter((caseItem) =>
      caseItem.clinicId === currentUser.linkedClinicId ||
      (caseItem.patientId && patientIds.has(caseItem.patientId)),
    )
  }
  return cases
}

function scopedScans(scans: Scan[], patients: Patient[], currentUser: User | null) {
  if (!currentUser) return []
  if (currentUser.role === 'master_admin') return scans
  const patientIds = new Set(patients.map((patient) => patient.id))
  if (currentUser.role === 'dentist_client') {
    return scans.filter((scan) =>
      (scan.patientId && patientIds.has(scan.patientId)) ||
      scan.dentistId === currentUser.linkedDentistId ||
      scan.requestedByDentistId === currentUser.linkedDentistId,
    )
  }
  if (currentUser.linkedClinicId) {
    return scans.filter((scan) =>
      scan.clinicId === currentUser.linkedClinicId ||
      (scan.patientId && patientIds.has(scan.patientId)),
    )
  }
  return scans
}

function scopedLabOrders(labOrders: LabOrder[], cases: Case[], patients: Patient[], currentUser: User | null) {
  if (!currentUser) return []
  if (currentUser.role === 'master_admin') return labOrders
  const caseIds = new Set(cases.map((caseItem) => caseItem.id))
  const patientIds = new Set(patients.map((patient) => patient.id))
  return labOrders.filter((order) =>
    (order.caseId && caseIds.has(order.caseId)) ||
    (order.patientId && patientIds.has(order.patientId)) ||
    (currentUser.role === 'dentist_client' && order.dentistId === currentUser.linkedDentistId) ||
    (currentUser.linkedClinicId && order.clinicId === currentUser.linkedClinicId),
  )
}

export class FirestoreDashboardRepository implements DashboardRepository {
  private readonly currentUser: User | null

  constructor(currentUser: User | null) {
    this.currentUser = currentUser
  }

  async loadSnapshot(period?: DashboardDateRange): Promise<Result<ExecutiveDashboardSnapshot, string>> {
    try {
      const [allCases, allPatients, allScans, allLabOrders] = await Promise.all([
        listCasesFirebase(),
        listPatientsFirebase({ includeDeleted: false }),
        listScansFirebase(),
        listLabOrdersFirebase(),
      ])
      const patients = scopedPatients(allPatients, this.currentUser)
      const scopedCaseItems = scopedCases(allCases, patients, this.currentUser)
      const scopedScanItems = scopedScans(allScans, patients, this.currentUser)
      const scopedLabOrderItems = scopedLabOrders(allLabOrders, scopedCaseItems, patients, this.currentUser)
      const cases = scopedCaseItems.filter((caseItem) => isWithinDateRange(caseItem.createdAt ?? caseItem.scanDate, period))
      const scans = scopedScanItems.filter((scan) => isWithinDateRange(scan.scanDate ?? scan.createdAt, period))
      const labOrders = scopedLabOrderItems.filter((order) => isWithinDateRange(order.createdAt ?? order.plannedDate, period))
      const ordersByCaseId = new Map<string, LabOrder[]>()
      scopedLabOrderItems.forEach((order) => {
        if (!order.caseId) return
        const current = ordersByCaseId.get(order.caseId) ?? []
        ordersByCaseId.set(order.caseId, [...current, order])
      })

      return ok({
        cases: cases.map((caseItem) => CaseLifecycleService.refreshCase(caseItem, ordersByCaseId.get(caseItem.id) ?? [])),
        patients,
        scans,
        labOrders,
      })
    } catch (error) {
      return err(error instanceof Error ? error.message : 'Falha ao carregar o painel pelo Firebase.')
    }
  }
}

export function createFirestoreDashboardRepository(currentUser: User | null) {
  return new FirestoreDashboardRepository(currentUser)
}
