import type { Case } from '../../../../types/Case'
import type { ProductType } from '../../../../types/Product'
import { normalizeProductType } from '../../../../types/Product'
import type { LabOrder } from '../../domain/entities/LabOrder'
import type { LabCasePrintFallback } from '../../application/ports/LabRepository'
import { ProductionQueueService } from '../../domain/services/ProductionQueueService'

export type FirestoreDocument = Record<string, unknown>

function isFirestoreTimestamp(value: unknown): value is { toDate: () => Date } {
  return Boolean(value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function')
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function asText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (isFirestoreTimestamp(value)) return value.toDate().toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

export function asDateText(value: unknown, fallback = '') {
  const text = asText(value, fallback)
  return text.length >= 10 ? text.slice(0, 10) : text
}

export function asNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function asOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function asProductType(value: unknown, fallback: ProductType = 'alinhador_12m') {
  return normalizeProductType(value, fallback)
}

export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return null as T
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date || isFirestoreTimestamp(value)) return value
  if (Array.isArray(value)) return value.map((entry) => stripUndefinedDeep(entry)) as T

  const output: Record<string, unknown> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (entry !== undefined) {
      output[key] = stripUndefinedDeep(entry)
    }
  })
  return output as T
}

export function normalizeLabStatus(value: unknown): LabOrder['status'] {
  const normalized = asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  if (normalized === 'aguardando_iniciar' || normalized === 'queued' || normalized === 'triagem') return 'aguardando_iniciar'
  if (normalized === 'em_producao' || normalized === 'in_production' || normalized === 'producao') return 'em_producao'
  if (normalized === 'controle_qualidade' || normalized === 'qc' || normalized === 'rework') return 'controle_qualidade'
  if (normalized === 'prontas' || normalized === 'pronta' || normalized === 'shipped' || normalized === 'entregue') return 'prontas'
  return 'aguardando_iniciar'
}

export function normalizeLabPriority(value: unknown): LabOrder['priority'] {
  const normalized = asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  if (normalized === 'urgente' || normalized === 'alta') return 'Urgente'
  if (normalized === 'baixo' || normalized === 'baixa') return 'Baixo'
  return 'Medio'
}

export function mapFirestoreLabRow(id: string, row: FirestoreDocument): LabOrder {
  const data = asObject(row.data)
  const createdAt = asText(data.createdAt, asText(row.created_at, new Date().toISOString()))
  const updatedAt = asText(data.updatedAt, asText(row.updated_at, createdAt))
  const status = normalizeLabStatus(row.status ?? data.status)
  const order: LabOrder = {
    id: asText(data.id, asText(row.id, id)),
    productType: normalizeProductType(row.product_type ?? data.productType ?? data.productId),
    productId: normalizeProductType(row.product_id ?? data.productId ?? data.productType),
    requestedProductId: asText(data.requestedProductId) || undefined,
    requestedProductLabel: asText(data.requestedProductLabel) || undefined,
    patientId: asText(data.patientId, asText(row.patient_id)) || undefined,
    dentistId: asText(data.dentistId, asText(row.dentist_id)) || undefined,
    clinicId: asText(row.clinic_id, asText(data.clinicId)) || undefined,
    requestCode: asText(data.requestCode) || undefined,
    requestKind: asText(data.requestKind, 'producao') as LabOrder['requestKind'],
    expectedReplacementDate: asDateText(data.expectedReplacementDate) || undefined,
    deliveredToProfessionalAt: asDateText(data.deliveredToProfessionalAt) || undefined,
    caseId: asText(row.case_id, asText(data.caseId)) || undefined,
    arch: (asText(data.arch, 'ambos') as LabOrder['arch']) || 'ambos',
    plannedUpperQty: asNumber(data.plannedUpperQty, 0),
    plannedLowerQty: asNumber(data.plannedLowerQty, 0),
    planningDefinedAt: asText(data.planningDefinedAt) || undefined,
    trayNumber: asNumber(row.tray_number, asNumber(data.trayNumber, 1)),
    patientName: asText(data.patientName, '-'),
    plannedDate: asDateText(data.plannedDate, createdAt.slice(0, 10)),
    dueDate: asDateText(data.dueDate, createdAt.slice(0, 10)),
    status,
    stage: asText(data.stage) as LabOrder['stage'] | undefined,
    stageTimeline: Array.isArray(data.stageTimeline) ? data.stageTimeline as LabOrder['stageTimeline'] : [],
    sla: asObject(data.sla) as LabOrder['sla'],
    productionChecklist: asObject(data.productionChecklist) as LabOrder['productionChecklist'],
    reworkOfCaseId: asText(data.reworkOfCaseId) || undefined,
    reworkOfLabOrderId: asText(data.reworkOfLabOrderId) || undefined,
    reworkOfTrayNumber: asOptionalNumber(data.reworkOfTrayNumber),
    financialImpact: asObject(data.financialImpact) as LabOrder['financialImpact'],
    domainEvents: Array.isArray(data.domainEvents) ? data.domainEvents as LabOrder['domainEvents'] : [],
    priority: normalizeLabPriority(row.priority ?? data.priority),
    notes: asText(row.notes, asText(data.notes)) || undefined,
    createdAt,
    updatedAt,
  }

  return ProductionQueueService.enrichOrder(order)
}

export function labOrderToFirestoreDocument(order: LabOrder): FirestoreDocument {
  return stripUndefinedDeep({
    id: order.id,
    clinic_id: order.clinicId ?? null,
    patient_id: order.patientId ?? null,
    dentist_id: order.dentistId ?? null,
    case_id: order.caseId ?? null,
    tray_number: order.trayNumber,
    status: order.status,
    priority: order.priority,
    notes: order.notes ?? null,
    product_type: order.productType ?? order.productId ?? null,
    product_id: order.productId ?? order.productType ?? null,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    deleted_at: null,
    data: order,
  })
}

export function buildCasePrintFallbackFromFirestore(caseItem: Case, sourceScanData: Record<string, unknown>): LabCasePrintFallback {
  return {
    clinicName: asText((caseItem as unknown as Record<string, unknown>).clinicName, asText(sourceScanData.clinicName)) || undefined,
    dentistName: asText((caseItem as unknown as Record<string, unknown>).dentistName, asText(sourceScanData.dentistName)) || undefined,
    requesterName: asText(
      (caseItem as unknown as Record<string, unknown>).requestedByDentistName,
      asText(sourceScanData.requestedByDentistName, asText(sourceScanData.requesterName, asText(sourceScanData.dentistName))),
    ) || undefined,
    patientBirthDate: asText(sourceScanData.patientBirthDate, asText(sourceScanData.birthDate)) || undefined,
  }
}
