import { createValidationError } from '../../../../shared/errors'
import { createOrthoDomainEvent } from '../../../../shared/domain'
import { addDaysToIsoDate, nowIsoDateTime, toIsoDate } from '../../../../shared/utils/date'
import type { Case } from '../../../../types/Case'
import type { LabItem, LabPriority, LabStatus } from '../../../../types/Lab'
import type { ProductType } from '../../../../types/Product'
import { isAlignerProductType, normalizeProductType } from '../../../../types/Product'
import { LabStage } from '../valueObjects/LabStage'

export type LabOrderStage = LabStatus
export type LabOrderPriority = LabPriority
export type LabOrderKind = NonNullable<LabItem['requestKind']> | 'producao'
export type LabOrderArch = LabItem['arch']

export type LabOrder = LabItem

export type CreateLabOrderInput = Omit<LabItem, 'id' | 'createdAt' | 'updatedAt' | 'requestKind'> & {
  requestKind?: LabOrderKind
}

export type UpdateLabOrderInput = Partial<LabItem>

export const LAB_ORDER_STAGE_FLOW: LabOrderStage[] = [
  'aguardando_iniciar',
  'em_producao',
  'controle_qualidade',
  'prontas',
]

function toNonNegativeInt(value?: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value ?? 0))
}

export function toLabOrder(item: LabItem): LabOrder {
  return {
    ...item,
    requestKind: item.requestKind ?? 'producao',
    stage: item.stage ?? LabStage.fromOrder(item).value,
  }
}

export function createLabOrderDraft(input: CreateLabOrderInput, nowIso = nowIsoDateTime()): CreateLabOrderInput {
  const normalizedStatus = input.status
  const stage = LabStage.fromLegacyStatus(normalizedStatus).value
  return {
    ...input,
    requestKind: input.requestKind ?? 'producao',
    expectedReplacementDate: input.expectedReplacementDate ?? input.dueDate,
    arch: input.arch ?? 'ambos',
    plannedUpperQty: toNonNegativeInt(input.plannedUpperQty),
    plannedLowerQty: toNonNegativeInt(input.plannedLowerQty),
    plannedDate: input.plannedDate ? toIsoDate(input.plannedDate) : nowIso.slice(0, 10),
    dueDate: toIsoDate(input.dueDate),
    status: normalizedStatus,
    stage,
    stageTimeline: input.stageTimeline ?? [{ stage, at: nowIso }],
    domainEvents: input.domainEvents ?? ((normalizedStatus === 'em_producao' || normalizedStatus === 'prontas')
      ? [createOrthoDomainEvent(
        normalizedStatus === 'prontas' ? 'LabShipped' : 'LabStarted',
        input.caseId ?? input.requestCode ?? input.patientName,
        input.caseId ? 'case' : 'lab',
        {
          caseId: input.caseId,
          requestCode: input.requestCode,
          trayNumber: input.trayNumber,
          stage,
        },
        nowIso,
      )]
      : []),
  }
}

export function getPreviousLabOrderStage(stage: LabOrderStage) {
  const index = LAB_ORDER_STAGE_FLOW.indexOf(stage)
  if (index <= 0) return null
  return LAB_ORDER_STAGE_FLOW[index - 1]
}

export function getNextLabOrderStage(stage: LabOrderStage) {
  const index = LAB_ORDER_STAGE_FLOW.indexOf(stage)
  if (index < 0 || index >= LAB_ORDER_STAGE_FLOW.length - 1) return null
  return LAB_ORDER_STAGE_FLOW[index + 1]
}

export function canTransitionLabOrderStage(current: LabOrderStage, next: LabOrderStage) {
  const currentIndex = LAB_ORDER_STAGE_FLOW.indexOf(current)
  const nextIndex = LAB_ORDER_STAGE_FLOW.indexOf(next)
  return currentIndex >= 0 && nextIndex >= 0 && Math.abs(nextIndex - currentIndex) <= 1
}

export function hasProductionPlan(order: Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty'>) {
  const upper = toNonNegativeInt(order.plannedUpperQty)
  const lower = toNonNegativeInt(order.plannedLowerQty)
  return upper + lower > 0
}

export function isReworkOrder(order: Pick<LabOrder, 'requestKind'>) {
  return (order.requestKind ?? 'producao') === 'reconfeccao'
}

export function isReworkProductionOrder(order: Pick<LabOrder, 'requestKind' | 'notes' | 'reworkOfCaseId' | 'reworkOfLabOrderId' | 'reworkOfTrayNumber'>) {
  const notes = (order.notes ?? '').toLowerCase()
  return (order.requestKind ?? 'producao') === 'producao' && (
    Boolean(order.reworkOfCaseId || order.reworkOfLabOrderId || order.reworkOfTrayNumber) ||
    notes.includes('rework') ||
    notes.includes('reconfec')
  )
}

export function isProgrammedReplenishmentOrder(order: Pick<LabOrder, 'requestKind'>) {
  return (order.requestKind ?? 'producao') === 'reposicao_programada'
}

export function resolveLabOrderProductType(
  order: Pick<LabOrder, 'productId' | 'productType'>,
  linkedCase?: Pick<Case, 'productId' | 'productType'> | null,
) {
  return normalizeProductType(order.productId ?? order.productType ?? linkedCase?.productId ?? linkedCase?.productType)
}

export function requiresLabPlan(
  order: Pick<LabOrder, 'productId' | 'productType'>,
  linkedCase?: Pick<Case, 'productId' | 'productType'> | null,
) {
  return isAlignerProductType(resolveLabOrderProductType(order, linkedCase))
}

export function validatePlanForCase(
  caseItem: Pick<Case, 'totalTrays' | 'totalTraysUpper' | 'totalTraysLower'>,
  order: Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty'>,
) {
  const upper = toNonNegativeInt(order.plannedUpperQty)
  const lower = toNonNegativeInt(order.plannedLowerQty)
  const maxUpper = toNonNegativeInt(caseItem.totalTraysUpper ?? caseItem.totalTrays)
  const maxLower = toNonNegativeInt(caseItem.totalTraysLower ?? caseItem.totalTrays)
  if (upper > maxUpper) return `Quantidade superior excede o planejamento do caso (${maxUpper}).`
  if (lower > maxLower) return `Quantidade inferior excede o planejamento do caso (${maxLower}).`
  return null
}

export function resolveAutomaticLabOrderStage(
  stage: LabOrderStage,
  order: Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty' | 'productId' | 'productType'>,
  linkedCase?: Pick<Case, 'productId' | 'productType'> | null,
) {
  if (!requiresLabPlan(order, linkedCase)) {
    return stage
  }
  return hasProductionPlan(order) ? 'em_producao' : 'aguardando_iniciar'
}

export function assertReadyToStartProduction(
  order: Pick<LabOrder, 'arch' | 'plannedUpperQty' | 'plannedLowerQty' | 'productId' | 'productType'>,
  linkedCase?: Pick<Case, 'productId' | 'productType'> | null,
) {
  if (!order.arch) {
    throw createValidationError('Defina a arcada do produto antes de iniciar produção.')
  }
  if (requiresLabPlan(order, linkedCase) && !hasProductionPlan(order as Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty'>)) {
    throw createValidationError('Defina quantidades por arcada antes de iniciar produção.')
  }
}

export function buildStandaloneLabDueDate(baseDate: string, leadDays = 7) {
  return addDaysToIsoDate(baseDate, leadDays)
}

export function normalizeLabPriority(priority?: string): LabOrderPriority {
  if (priority === 'Baixo' || priority === 'Medio' || priority === 'Urgente') {
    return priority
  }
  return 'Medio'
}

export function normalizeLabArch(arch?: string): LabOrderArch {
  if (arch === 'superior' || arch === 'inferior' || arch === 'ambos') {
    return arch
  }
  return 'ambos'
}

export function buildLabOrderNotesWithReason(prefix: string, trayNumber: number, reason: string) {
  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    throw createValidationError('Motivo da reconfecção é obrigatório.')
  }
  return `${prefix} da placa #${trayNumber}. Motivo: ${trimmedReason}`
}

export function normalizeProductForLabOrder(
  productType?: ProductType,
  fallback?: ProductType,
) {
  return normalizeProductType(productType ?? fallback)
}
