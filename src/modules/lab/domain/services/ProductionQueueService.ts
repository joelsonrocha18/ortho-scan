import { getReplenishmentAlerts } from '../../../../domain/replenishment'
import { resolveTreatmentOrigin } from '../../../../lib/treatmentOrigin'
import { nowIsoDate } from '../../../../shared/utils/date'
import type { LabStageValue } from '../../../../types/Domain'
import type { Case } from '../../../../types/Case'
import type { Clinic } from '../../../../types/Clinic'
import type { Patient } from '../../../../types/Patient'
import type { LabOrder, LabOrderPriority, LabOrderStage } from '../entities/LabOrder'
import {
  isProgrammedReplenishmentOrder,
  isReworkOrder,
  isReworkProductionOrder,
} from '../entities/LabOrder'
import { LabSLAService } from './LabSLAService'
import { LabStage } from '../valueObjects/LabStage'

export type LabFilterPriority = 'todos' | Lowercase<LabOrderPriority>
export type LabFilterStatus = 'todos' | LabOrderStage
export type LabFilterOrigin = 'todos' | 'interno' | 'externo'

export type LabQueueFilters = {
  search: string
  priority: LabFilterPriority
  overdueOnly: boolean
  alertsOnly: boolean
  status: LabFilterStatus
  origin: LabFilterOrigin
}

export type PatientSearchOption = Pick<Patient, 'id' | 'shortId' | 'name' | 'birthDate' | 'clinicId' | 'primaryDentistId'> & {
  dentistName?: string
  clinicName?: string
}

export type LabPipelineItem = LabOrder & {
  stage: LabStageValue
  alerts: string[]
  priorityScore: number
}

export type LabOrderIdentityContext = {
  caseById?: Map<string, Pick<Case, 'treatmentCode'>>
}

function toNonNegativeInt(value?: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value ?? 0))
}

function hasRevisionSuffix(code?: string) {
  return Boolean(code?.trim().match(/\/\d+$/))
}

function priorityWeight(priority: LabOrderPriority) {
  if (priority === 'Urgente') return 300
  if (priority === 'Medio') return 200
  return 100
}

function stageWeight(stage: LabStageValue) {
  if (stage === 'rework') return 120
  if (stage === 'qc') return 100
  if (stage === 'in_production') return 80
  if (stage === 'queued') return 60
  if (stage === 'shipped') return 40
  return 20
}

function statusWeight(status: LabOrderStage) {
  if (status === 'prontas') return 400
  if (status === 'controle_qualidade') return 300
  if (status === 'em_producao') return 200
  return 100
}

function toTime(value?: string) {
  const time = Date.parse(value ?? '')
  return Number.isFinite(time) ? time : 0
}

function planningWeight(order: Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty'>) {
  return toNonNegativeInt(order.plannedUpperQty) + toNonNegativeInt(order.plannedLowerQty) > 0 ? 1 : 0
}

function normalizedIdentityValue(value?: string) {
  return value?.trim().toLowerCase() ?? ''
}

function baseProductionIdentity(order: LabOrder, context?: LabOrderIdentityContext) {
  const requestKind = order.requestKind ?? 'producao'
  const requestCode = order.requestCode?.trim() ?? ''
  const isRevision = /\/\d+$/.test(requestCode)
  const treatmentCode = order.caseId ? context?.caseById?.get(order.caseId)?.treatmentCode : undefined
  const reworkKey = [
    order.reworkOfCaseId ?? '',
    order.reworkOfLabOrderId ?? '',
    order.reworkOfTrayNumber ?? '',
  ].join('|')

  if (requestKind !== 'producao' || isRevision || reworkKey !== '||') return null

  const aliases = [
    order.caseId ? `case:${normalizedIdentityValue(order.caseId)}` : '',
    requestCode ? `code:${normalizedIdentityValue(requestCode)}` : '',
    treatmentCode ? `code:${normalizedIdentityValue(treatmentCode)}` : '',
  ].filter(Boolean)

  return {
    product: order.productId ?? order.productType ?? '',
    aliases: aliases.length > 0 ? [...new Set(aliases)] : [`order:${order.id}`],
  }
}

function canonicalOrderKey(order: LabOrder) {
  const requestKind = order.requestKind ?? 'producao'
  const requestCode = order.requestCode?.trim() ?? ''
  const isRevision = /\/\d+$/.test(requestCode)
  const product = order.productId ?? order.productType ?? ''
  const reworkKey = [
    order.reworkOfCaseId ?? '',
    order.reworkOfLabOrderId ?? '',
    order.reworkOfTrayNumber ?? '',
  ].join('|')
  const scope = order.caseId ?? (requestCode ? `standalone:${requestCode}` : '')

  if (!scope) return `standalone:${order.id}`

  if (requestKind === 'producao' && !isRevision && reworkKey === '||') {
    return ['base-production', scope, product].join('|')
  }

  if (requestKind === 'producao' && reworkKey !== '||') {
    return ['rework-production', scope, order.trayNumber, order.arch, product, reworkKey].join('|')
  }

  if (requestKind === 'reposicao_programada') {
    return [
      'programmed-replenishment',
      scope,
      order.trayNumber,
      order.expectedReplacementDate ?? order.dueDate,
      order.arch,
      product,
    ].join('|')
  }

  return [
    requestKind,
    scope,
    order.trayNumber,
    order.expectedReplacementDate ?? order.dueDate,
    order.arch,
    product,
    requestCode,
    reworkKey,
  ].join('|')
}

function compareCanonicalOrders(left: LabOrder, right: LabOrder) {
  const leftCaseScoped = left.caseId ? 1 : 0
  const rightCaseScoped = right.caseId ? 1 : 0
  if (leftCaseScoped !== rightCaseScoped) return leftCaseScoped - rightCaseScoped

  const leftDelivered = left.deliveredToProfessionalAt ? 1 : 0
  const rightDelivered = right.deliveredToProfessionalAt ? 1 : 0
  if (leftDelivered !== rightDelivered) return leftDelivered - rightDelivered

  const leftStatus = statusWeight(left.status)
  const rightStatus = statusWeight(right.status)
  if (leftStatus !== rightStatus) return leftStatus - rightStatus

  const leftPlanning = planningWeight(left)
  const rightPlanning = planningWeight(right)
  if (leftPlanning !== rightPlanning) return leftPlanning - rightPlanning

  const leftDue = toTime(left.dueDate)
  const rightDue = toTime(right.dueDate)
  if (leftDue !== rightDue) return rightDue - leftDue

  const leftCreated = toTime(left.createdAt)
  const rightCreated = toTime(right.createdAt)
  if (leftCreated !== rightCreated) return rightCreated - leftCreated

  const leftUpdated = toTime(left.updatedAt)
  const rightUpdated = toTime(right.updatedAt)
  if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated

  return right.id.localeCompare(left.id)
}

export function getCanonicalLabOrders<T extends LabOrder>(orders: T[], context?: LabOrderIdentityContext) {
  const firstIndexById = new Map(orders.map((order, index) => [order.id, index]))
  const parent = orders.map((_, index) => index)
  const baseIdentityByIndex = new Map<number, ReturnType<typeof baseProductionIdentity>>()
  const baseAliasOwner = new Map<string, number>()
  const bestByKey = new Map<string, T>()

  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index])
    return parent[index]
  }

  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  orders.forEach((order, index) => {
    const identity = baseProductionIdentity(order, context)
    if (!identity) return
    baseIdentityByIndex.set(index, identity)
    identity.aliases.forEach((alias) => {
      const aliasKey = ['base-production', identity.product, alias].join('|')
      const owner = baseAliasOwner.get(aliasKey)
      if (owner === undefined) {
        baseAliasOwner.set(aliasKey, index)
        return
      }
      union(owner, index)
    })
  })

  orders.forEach((order, index) => {
    const identity = baseIdentityByIndex.get(index)
    const key = identity ? `base-production-group:${find(index)}` : canonicalOrderKey(order)
    const current = bestByKey.get(key)
    if (!current || compareCanonicalOrders(order, current) > 0) {
      bestByKey.set(key, order)
    }
  })

  return [...bestByKey.values()].sort(
    (left, right) => (firstIndexById.get(left.id) ?? 0) - (firstIndexById.get(right.id) ?? 0),
  )
}

export function enrichLabOrder(order: LabOrder, todayIso = nowIsoDate()): LabPipelineItem {
  const stage = order.stage ?? LabStage.fromOrder(order).value
  const sla = order.sla ?? LabSLAService.evaluate(order)
  const alerts = [...new Set([...(order.sla?.alerts ?? []), ...sla.alerts])]
  const overdue = stage !== 'delivered' && order.dueDate < todayIso
  const priorityScore = priorityWeight(order.priority) + stageWeight(stage) + (sla.status === 'overdue' ? 60 : sla.status === 'warning' ? 30 : 0) + (overdue ? 20 : 0)

  return {
    ...order,
    stage,
    sla,
    alerts,
    priorityScore,
  }
}

export function isLabOrderOverdue(order: Pick<LabOrder, 'dueDate' | 'status' | 'stage' | 'sla'>, todayIso = nowIsoDate()) {
  if ((order.stage ?? null) === 'delivered') return false
  if (order.sla?.status === 'overdue') return true
  if (order.status === 'prontas') return false
  return order.dueDate < todayIso
}

export function isLabOrderDeliveredToProfessional(
  order: Pick<LabOrder, 'caseId' | 'status' | 'requestKind' | 'requestCode' | 'trayNumber' | 'deliveredToProfessionalAt' | 'stage'>,
  caseById: Map<string, Pick<Case, 'deliveryLots' | 'trays'>>,
) {
  if ((order.stage ?? null) === 'delivered') return true
  if (order.deliveredToProfessionalAt) return true
  if (!order.caseId) return false
  if (order.status !== 'prontas') return false
  const caseItem = caseById.get(order.caseId)
  const hasAnyDeliveryLot = (caseItem?.deliveryLots?.length ?? 0) > 0
  if ((order.requestKind ?? 'producao') === 'producao' && hasAnyDeliveryLot && !hasRevisionSuffix(order.requestCode)) {
    return true
  }
  const tray = caseItem?.trays?.find((current) => current.trayNumber === order.trayNumber)
  return tray?.state === 'entregue'
}

export function buildProductionQueue(
  orders: LabOrder[],
  caseById: Map<string, Pick<Case, 'deliveryLots' | 'trays' | 'treatmentCode'>>,
  todayIso = nowIsoDate(),
) {
  return getCanonicalLabOrders(orders, { caseById })
    .map((order) => enrichLabOrder(order, todayIso))
    .filter((order) => {
      if (order.stage === 'delivered') return false
      return !isLabOrderDeliveredToProfessional(order, caseById)
    })
    .sort((left, right) => right.priorityScore - left.priorityScore || left.dueDate.localeCompare(right.dueDate))
}

export function getPipelineOrders(
  orders: LabOrder[],
  caseById: Map<string, Pick<Case, 'deliveryLots' | 'trays' | 'treatmentCode'>>,
) {
  return buildProductionQueue(orders, caseById)
}

export function getQueueKpis(orders: LabOrder[]) {
  const enriched = getCanonicalLabOrders(orders).map((order) => enrichLabOrder(order))
  return {
    aguardando_iniciar: enriched.filter((order) => order.status === 'aguardando_iniciar').length,
    em_producao: enriched.filter((order) => order.stage === 'in_production').length,
    controle_qualidade: enriched.filter((order) => order.stage === 'qc' || order.stage === 'rework').length,
    prontas: enriched.filter((order) => order.stage === 'shipped').length,
    atrasados: enriched.filter((order) => isLabOrderOverdue(order)).length,
  }
}

export function getCasesWithReplenishmentAlerts(cases: Case[]) {
  return new Set(
    cases
      .filter((caseItem) => getReplenishmentAlerts(caseItem).length > 0)
      .map((caseItem) => caseItem.id),
  )
}

export function getReplenishmentAlertSummaries(cases: Case[]) {
  return cases
    .flatMap((caseItem) =>
      getReplenishmentAlerts(caseItem).map((alert) => ({
        caseId: caseItem.id,
        patientName: caseItem.patientName,
        dueDate: alert.dueDate,
        title: alert.title,
      })),
    )
    .slice(0, 3)
}

export function filterLabOrders(
  orders: LabOrder[],
  filters: LabQueueFilters,
  context: {
    caseById: Map<string, Case>
    patientOptionsById: Map<string, PatientSearchOption>
    clinicById: Map<string, Pick<Clinic, 'id' | 'tradeName'>>
    casesWithAlerts: Set<string>
  },
) {
  const query = filters.search.trim().toLowerCase()
  return orders.filter((order) => {
    const caseItem = order.caseId ? context.caseById.get(order.caseId) : undefined
    const matchSearch =
      query.length === 0 ||
      order.patientName.toLowerCase().includes(query) ||
      (order.patientId ? (context.patientOptionsById.get(order.patientId)?.shortId ?? '').toLowerCase().includes(query) : false) ||
      (order.caseId ? (context.caseById.get(order.caseId)?.shortId ?? '').toLowerCase().includes(query) : false) ||
      (order.requestCode ?? '').toLowerCase().includes(query) ||
      (order.caseId ?? '').toLowerCase().includes(query) ||
      `#${order.trayNumber}`.includes(query) ||
      String(order.trayNumber).includes(query)
    const matchPriority = filters.priority === 'todos' || order.priority.toLowerCase() === filters.priority
    const matchStatus = filters.status === 'todos' || order.status === filters.status
    const matchOverdue = !filters.overdueOnly || isLabOrderOverdue(order)
    const matchAlerts = !filters.alertsOnly || Boolean(order.sla?.alerts?.length) || (order.caseId ? context.casesWithAlerts.has(order.caseId) : false)
    const matchOrigin =
      filters.origin === 'todos'
      || resolveTreatmentOrigin(
        {
          treatmentOrigin: caseItem?.treatmentOrigin,
          clinicId: caseItem?.clinicId ?? order.clinicId,
          patientId: caseItem?.patientId ?? order.patientId,
        },
        {
          patientsById: context.patientOptionsById,
          clinicsById: context.clinicById,
        },
      ) === filters.origin
    return matchSearch && matchPriority && matchStatus && matchOverdue && matchAlerts && matchOrigin
  })
}

export function getReadyDeliveryOrders(
  orders: LabOrder[],
  caseById: Map<string, Pick<Case, 'deliveryLots' | 'trays' | 'treatmentCode'>>,
) {
  return getCanonicalLabOrders(orders, { caseById })
    .map((order) => enrichLabOrder(order))
    .filter((order) => {
      if (order.status !== 'prontas') return false
      return !isLabOrderDeliveredToProfessional(order, caseById)
    })
}

export function isCaseWithRemainingBank(caseItem?: Pick<Case, 'totalTrays' | 'totalTraysUpper' | 'totalTraysLower' | 'arch' | 'installation'> | null) {
  if (!caseItem) return false
  const treatmentArch = caseItem.arch ?? 'ambos'
  const totals = {
    upper: treatmentArch === 'inferior' ? 0 : toNonNegativeInt(caseItem.totalTraysUpper ?? caseItem.totalTrays),
    lower: treatmentArch === 'superior' ? 0 : toNonNegativeInt(caseItem.totalTraysLower ?? caseItem.totalTrays),
  }
  const delivered = {
    upper: treatmentArch === 'inferior' ? 0 : toNonNegativeInt(caseItem.installation?.deliveredUpper),
    lower: treatmentArch === 'superior' ? 0 : toNonNegativeInt(caseItem.installation?.deliveredLower),
  }
  return Math.max(0, totals.upper - delivered.upper) > 0 || Math.max(0, totals.lower - delivered.lower) > 0
}

export function getRemainingBankOrders(
  orders: LabOrder[],
  caseById: Map<string, Case>,
  deliveredToProfessional: (order: LabOrder) => boolean,
) {
  const raw = getCanonicalLabOrders(orders, { caseById })
    .map((order) => enrichLabOrder(order))
    .filter((order) => {
      const caseItem = order.caseId ? caseById.get(order.caseId) : undefined
      if (caseItem?.status === 'finalizado') return false
      if (caseItem && !isCaseWithRemainingBank(caseItem)) return false
      return (
        deliveredToProfessional(order) ||
        (isProgrammedReplenishmentOrder(order) && order.status === 'aguardando_iniciar') ||
        isReworkOrder(order) ||
        isReworkProductionOrder(order)
      )
    })

  const caseScoped = new Map<string, LabPipelineItem>()
  const explicitRework: LabPipelineItem[] = []
  const explicitReworkCaseIds = new Set<string>()
  const standalone: LabPipelineItem[] = []

  const score = (order: LabPipelineItem) => {
    if (order.stage === 'rework') return 5
    if (isProgrammedReplenishmentOrder(order) && order.status === 'aguardando_iniciar') return 4
    if ((order.requestKind ?? 'producao') === 'producao') return 3
    if (isReworkOrder(order)) return 2
    return 1
  }

  raw.forEach((order) => {
    if (isReworkOrder(order)) {
      explicitRework.push(order)
      if (order.caseId) explicitReworkCaseIds.add(order.caseId)
      return
    }
    if (!order.caseId) {
      standalone.push(order)
      return
    }
    const current = caseScoped.get(order.caseId)
    if (!current) {
      caseScoped.set(order.caseId, order)
      return
    }
    const better = score(order) > score(current) || (score(order) === score(current) && (order.updatedAt ?? '') > (current.updatedAt ?? ''))
    if (better) {
      caseScoped.set(order.caseId, order)
    }
  })

  const caseScopedWithoutExplicitRework = [...caseScoped.values()].filter(
    (order) => !(order.caseId && explicitReworkCaseIds.has(order.caseId)),
  )
  return [...explicitRework, ...caseScopedWithoutExplicitRework, ...standalone]
}

export function getInitialDeliveryQuantities(order?: Pick<LabOrder, 'arch' | 'plannedUpperQty' | 'plannedLowerQty'> | null) {
  if (!order) return { upper: 0, lower: 0 }
  return {
    upper: order.arch === 'inferior' ? 0 : toNonNegativeInt(order.plannedUpperQty),
    lower: order.arch === 'superior' ? 0 : toNonNegativeInt(order.plannedLowerQty),
  }
}

export class ProductionQueueService {
  static enrichOrder = enrichLabOrder
  static isOverdue = isLabOrderOverdue
  static isDeliveredToProfessional = isLabOrderDeliveredToProfessional
  static filter = filterLabOrders
  static buildQueue = buildProductionQueue
  static getPipelineOrders = getPipelineOrders
  static getCanonicalOrders = getCanonicalLabOrders
  static getKpis = getQueueKpis
  static getReadyDeliveryOrders = getReadyDeliveryOrders
  static getRemainingBankOrders = getRemainingBankOrders
  static getCasesWithReplenishmentAlerts = getCasesWithReplenishmentAlerts
  static getReplenishmentAlertSummaries = getReplenishmentAlertSummaries
  static getInitialDeliveryQuantities = getInitialDeliveryQuantities
}
