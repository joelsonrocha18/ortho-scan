import { CasePlanningVersioningService } from '../../../cases/domain/services/CasePlanningVersioningService'
import { CaseLifecycleService } from '../../../cases/domain/services/CaseLifecycleService'
import { LabStage } from '../../../lab/domain/valueObjects/LabStage'
import {
  buildActualChangeDateMap,
  buildAlignerWhatsappHref,
  buildArchScheduleDates,
  resolveAlignerArchTotals,
  resolveDeliveredToPatient,
} from '../../../../lib/alignerChange'
import { nowIsoDate } from '../../../../shared/utils'
import type { Case } from '../../../../types/Case'
import type { Patient } from '../../../../types/Patient'
import type { LabOrder } from '../../../lab/domain/entities/LabOrder'
import type { Scan } from '../../../../types/Scan'

export type StrategicNotificationKind = 'scan_rejected' | 'case_ready' | 'sla_delay' | 'planning_approval' | 'aligner_change_due_today'
export type StrategicNotificationSeverity = 'danger' | 'warning' | 'success' | 'info'
export type StrategicNotificationAction = {
  label: string
  href: string
  external?: boolean
}

export type StrategicNotification = {
  id: string
  kind: StrategicNotificationKind
  severity: StrategicNotificationSeverity
  title: string
  description: string
  at: string
  href?: string
  caseId?: string
  scanId?: string
  actions?: StrategicNotificationAction[]
}

type NotificationInput = {
  cases: Case[]
  labOrders: LabOrder[]
  scans: Scan[]
  patients?: Patient[]
  todayIso?: string
}

function severityWeight(value: StrategicNotificationSeverity) {
  if (value === 'danger') return 4
  if (value === 'warning') return 3
  if (value === 'success') return 2
  return 1
}

function notificationKindWeight(value: StrategicNotificationKind) {
  if (value === 'aligner_change_due_today') return 5
  if (value === 'sla_delay') return 4
  if (value === 'scan_rejected') return 3
  if (value === 'case_ready') return 2
  return 1
}

function resolvePatientWhatsapp(caseItem: Case, patients: Patient[]) {
  if (caseItem.patientId) {
    const byId = patients.find((patient) => patient.id === caseItem.patientId)
    if (byId?.whatsapp?.trim()) return byId.whatsapp.trim()
  }
  const normalizedPatientName = caseItem.patientName.trim().toLocaleLowerCase()
  const byName = patients.find((patient) => patient.name.trim().toLocaleLowerCase() === normalizedPatientName)
  return byName?.whatsapp?.trim()
}

function formatAlignerTarget(target: { upper?: number; lower?: number }) {
  const upper = typeof target.upper === 'number' && target.upper > 0 ? Math.trunc(target.upper) : undefined
  const lower = typeof target.lower === 'number' && target.lower > 0 ? Math.trunc(target.lower) : undefined

  if (upper && lower) {
    if (upper === lower) {
      return `alinhadores numero ${upper} superior e inferior`
    }
    return `alinhador superior numero ${upper} e inferior numero ${lower}`
  }
  if (upper) return `alinhador superior numero ${upper}`
  if (lower) return `alinhador inferior numero ${lower}`
  return 'proximo alinhador'
}

function resolveAlignerTargetDueToday(caseItem: Case, todayIso: string) {
  const installedAt = caseItem.installation?.installedAt?.slice(0, 10)
  if (!installedAt) return undefined

  const totals = resolveAlignerArchTotals(caseItem)
  const deliveredToPatient = resolveDeliveredToPatient(caseItem, totals)
  if (deliveredToPatient.upper <= 0 && deliveredToPatient.lower <= 0) return undefined

  const upperSchedule = buildArchScheduleDates(
    installedAt,
    caseItem.changeEveryDays,
    totals.upper,
    buildActualChangeDateMap(caseItem.installation, 'superior'),
  )
  const lowerSchedule = buildArchScheduleDates(
    installedAt,
    caseItem.changeEveryDays,
    totals.lower,
    buildActualChangeDateMap(caseItem.installation, 'inferior'),
  )

  let upper: number | undefined
  for (let trayNumber = 1; trayNumber <= deliveredToPatient.upper; trayNumber += 1) {
    if (upperSchedule[trayNumber] === todayIso) {
      upper = trayNumber
      break
    }
  }

  let lower: number | undefined
  for (let trayNumber = 1; trayNumber <= deliveredToPatient.lower; trayNumber += 1) {
    if (lowerSchedule[trayNumber] === todayIso) {
      lower = trayNumber
      break
    }
  }

  if (!upper && !lower) return undefined
  return { upper, lower, dueDate: todayIso }
}

export function deriveStrategicNotifications(input: NotificationInput) {
  const labByCaseId = new Map<string, LabOrder[]>()
  const todayIso = input.todayIso ?? nowIsoDate()
  const patients = input.patients ?? []
  input.labOrders.forEach((order) => {
    if (!order.caseId) return
    const current = labByCaseId.get(order.caseId) ?? []
    labByCaseId.set(order.caseId, [...current, order])
  })

  const items: StrategicNotification[] = []

  input.scans
    .filter((scan) => scan.status === 'reprovado')
    .forEach((scan) => {
      items.push({
        id: `scan-rejected-${scan.id}`,
        kind: 'scan_rejected',
        severity: 'warning',
        title: 'Exame rejeitado',
        description: `${scan.patientName} precisa de nova avaliacao ou recaptura do exame.`,
        at: scan.updatedAt,
        href: '/app/scans',
        scanId: scan.id,
      })
    })

  input.cases.forEach((caseItem) => {
    const refreshed = CaseLifecycleService.refreshCase(caseItem, labByCaseId.get(caseItem.id) ?? [])
    const pendingPlanning = CasePlanningVersioningService.listPendingApprovals(refreshed)[0]
    if (pendingPlanning) {
      items.push({
        id: `planning-approval-${caseItem.id}-${pendingPlanning.id}`,
        kind: 'planning_approval',
        severity: 'info',
        title: `Planejamento ${pendingPlanning.label} aguardando aprovacao`,
        description: `${caseItem.patientName} possui uma nova versão publicada para revisão clínica.`,
        at: pendingPlanning.createdAt,
        href: '/app/portal-dentista',
        caseId: caseItem.id,
      })
    }
    if (refreshed.sla?.overallStatus === 'overdue') {
      items.push({
        id: `sla-delay-${caseItem.id}`,
        kind: 'sla_delay',
        severity: 'danger',
        title: 'Trabalho em atraso',
        description: `${caseItem.patientName} está com atraso no fluxo produtivo.`,
        at: refreshed.updatedAt,
        href: `/app/cases/${caseItem.id}`,
        caseId: caseItem.id,
      })
    }

    const dueTodayTarget = resolveAlignerTargetDueToday(refreshed, todayIso)
    if (dueTodayTarget) {
      const patientWhatsapp = resolvePatientWhatsapp(caseItem, patients)
      const whatsappHref = buildAlignerWhatsappHref(
        patientWhatsapp,
        caseItem.patientName,
        { upper: dueTodayTarget.upper, lower: dueTodayTarget.lower },
        dueTodayTarget.dueDate,
        todayIso,
      )
      items.push({
        id: `aligner-change-${caseItem.id}-${dueTodayTarget.dueDate}`,
        kind: 'aligner_change_due_today',
        severity: 'warning',
        title: 'Troca prevista para hoje',
        description: `${caseItem.patientName}: trocar ${formatAlignerTarget({ upper: dueTodayTarget.upper, lower: dueTodayTarget.lower })} hoje.`,
        at: dueTodayTarget.dueDate,
        href: `/app/cases/${caseItem.id}`,
        caseId: caseItem.id,
        actions: whatsappHref
          ? [{
              label: 'Enviar WhatsApp',
              href: whatsappHref,
              external: true,
            }]
          : undefined,
      })
    }

    const latestReadyOrder = (labByCaseId.get(caseItem.id) ?? [])
      .filter((order) => {
        const stage = LabStage.fromOrder(order).value
        return stage === 'shipped' || stage === 'delivered'
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

    if (latestReadyOrder && (caseItem.deliveryLots?.length ?? 0) === 0) {
      items.push({
        id: `case-ready-${caseItem.id}-${latestReadyOrder.id}`,
        kind: 'case_ready',
        severity: 'success',
      title: 'Caso pronto para entrega',
        description: `${caseItem.patientName} tem OS pronta para envio ao dentista.`,
        at: latestReadyOrder.updatedAt,
        href: `/app/cases/${caseItem.id}`,
        caseId: caseItem.id,
      })
    }
  })

  return items
    .sort(
      (left, right) =>
        notificationKindWeight(right.kind) - notificationKindWeight(left.kind) ||
        severityWeight(right.severity) - severityWeight(left.severity) ||
        right.at.localeCompare(left.at),
    )
    .slice(0, 12)
}

export class StrategicNotificationsService {
  static derive = deriveStrategicNotifications
}
