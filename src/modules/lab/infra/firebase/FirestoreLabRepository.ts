import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db as firestoreDb } from '../../../../lib/firebaseClient'
import { ok, err, type Result } from '../../../../shared/errors'
import { nowIsoDate, nowIsoDateTime, toIsoDate } from '../../../../shared/utils/date'
import { createEntityId } from '../../../../shared/utils/id'
import { listCasesFirebase, updateCaseFirebase } from '../../../../data/caseRepo'
import { listDentistsFirebase } from '../../../../data/dentistRepo'
import { listPatientsFirebase } from '../../../../repo/patientRepo'
import { listClinicsFirebase } from '../../../../repo/clinicRepo'
import { listScansFirebase } from '../../../../data/scanRepo'
import type { Case } from '../../../../types/Case'
import type { LabItem, LabStage, StageEvent } from '../../../../types/Lab'
import type { Patient } from '../../../../types/Patient'
import { normalizeProductType } from '../../../../types/Product'
import type { User } from '../../../../types/User'
import type {
  CreateAdvanceLabOrderInput,
  LabOverview,
  LabPatientOption,
  LabRepository,
  RegisterLabOrderInput,
  RegisterReworkInput,
  RegisterReworkOutput,
  RegisterShipmentInput,
  RegisterShipmentOutput,
  UpdateLabOrderInput,
  UpdateLabStageInput,
} from '../../application/ports/LabRepository'
import type { LabOrder } from '../../domain/entities/LabOrder'
import {
  assertReadyToStartProduction,
  canTransitionLabOrderStage,
  createLabOrderDraft,
  hasProductionPlan,
  requiresLabPlan,
  resolveAutomaticLabOrderStage,
  resolveLabOrderProductType,
  validatePlanForCase,
} from '../../domain/entities/LabOrder'
import { getCanonicalLabOrders, getLabOrderDuplicateGroupIds } from '../../domain/services/ProductionQueueService'
import {
  asDateText,
  asObject,
  asText,
  labOrderToFirestoreDocument,
  mapFirestoreLabRow,
  normalizeLabPriority,
} from './firestoreLabMappers'

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

function caseCode(caseItem: Pick<Case, 'treatmentCode' | 'id'>) {
  return caseItem.treatmentCode ?? caseItem.id
}

function nextRequestRevisionFromCodes(baseCode: string, codes: string[]) {
  const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escapedBase}/(\\d+)$`)
  const max = codes.reduce((acc, code) => {
    const match = code.match(regex)
    if (!match) return acc
    return Math.max(acc, Number(match[1]))
  }, 0)
  return max + 1
}

function scopedCollections(
  currentUser: User | null,
  input: {
    cases: Case[]
    patients: Patient[]
    labOrders: LabOrder[]
    dentists: Array<{ id: string; name: string; clinicId?: string; gender?: 'masculino' | 'feminino' }>
  },
) {
  if (!currentUser) return { cases: [], patients: [], labOrders: [] }
  if (currentUser.role === 'master_admin') {
    return { cases: input.cases, patients: input.patients, labOrders: input.labOrders }
  }

  const clinicId = currentUser.linkedClinicId
  const dentistIdsInClinic = new Set(
    clinicId ? input.dentists.filter((dentist) => dentist.clinicId === clinicId).map((dentist) => dentist.id) : [],
  )

  const patients = currentUser.role === 'dentist_client'
    ? input.patients.filter((patient) => patient.primaryDentistId === currentUser.linkedDentistId)
    : clinicId
      ? input.patients.filter((patient) => patient.clinicId === clinicId || (patient.primaryDentistId && dentistIdsInClinic.has(patient.primaryDentistId)))
      : input.patients
  const patientIds = new Set(patients.map((patient) => patient.id))

  const cases = currentUser.role === 'dentist_client'
    ? input.cases.filter((caseItem) =>
        (caseItem.patientId && patientIds.has(caseItem.patientId)) ||
        caseItem.dentistId === currentUser.linkedDentistId ||
        caseItem.requestedByDentistId === currentUser.linkedDentistId,
      )
    : clinicId
      ? input.cases.filter((caseItem) => caseItem.clinicId === clinicId || (caseItem.patientId && patientIds.has(caseItem.patientId)))
      : input.cases
  const caseIds = new Set(cases.map((caseItem) => caseItem.id))

  const labOrders = input.labOrders.filter((order) =>
    (order.caseId && caseIds.has(order.caseId)) ||
    (order.patientId && patientIds.has(order.patientId)) ||
    (currentUser.role === 'dentist_client' && (order.dentistId === currentUser.linkedDentistId)) ||
    (clinicId && order.clinicId === clinicId),
  )

  return { cases, patients, labOrders }
}

function normalizePatientOptions(
  patients: Patient[],
  dentistsById: Map<string, string>,
  clinicsById: Map<string, string>,
): LabPatientOption[] {
  return patients.map((patient) => ({
    id: patient.id,
    shortId: patient.shortId,
    name: patient.name,
    birthDate: patient.birthDate,
    clinicId: patient.clinicId,
    dentistId: patient.primaryDentistId,
    clinicName: patient.clinicId ? clinicsById.get(patient.clinicId) : undefined,
    dentistName: patient.primaryDentistId ? dentistsById.get(patient.primaryDentistId) : undefined,
  }))
}

function buildLabOrderFromInput(input: RegisterLabOrderInput, linkedCase: Case | null, existingCodes: string[]): LabOrder {
  const now = nowIsoDateTime()
  const normalizedDraft = createLabOrderDraft({
    ...input,
    priority: normalizeLabPriority(input.priority),
    requestKind: input.requestKind ?? 'producao',
    plannedDate: input.plannedDate ?? nowIsoDate(),
    dueDate: input.dueDate,
  })
  const resolvedProductType = resolveLabOrderProductType(normalizedDraft, linkedCase)
  const resolvedStatus = requiresLabPlan(normalizedDraft, linkedCase)
    ? resolveAutomaticLabOrderStage(normalizedDraft.status, normalizedDraft, linkedCase)
    : normalizedDraft.status
  const requestCode = input.requestCode?.trim()
    || (linkedCase
      ? ((normalizedDraft.requestKind ?? 'producao') === 'producao' && !existingCodes.includes(caseCode(linkedCase))
        ? caseCode(linkedCase)
        : `${caseCode(linkedCase)}/${nextRequestRevisionFromCodes(caseCode(linkedCase), existingCodes)}`)
      : undefined)

  return {
    ...normalizedDraft,
    id: createEntityId('lab'),
    productType: resolvedProductType,
    productId: normalizeProductType(input.productId ?? input.productType ?? linkedCase?.productId ?? linkedCase?.productType),
    requestedProductId: input.requestedProductId ?? linkedCase?.requestedProductId,
    requestedProductLabel: input.requestedProductLabel ?? linkedCase?.requestedProductLabel,
    clinicId: input.clinicId ?? linkedCase?.clinicId,
    patientId: input.patientId ?? linkedCase?.patientId,
    dentistId: input.dentistId ?? linkedCase?.dentistId,
    requestCode,
    status: resolvedStatus,
    planningDefinedAt: hasProductionPlan(normalizedDraft) ? now : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export async function listLabOrdersFirebase() {
  const snapshot = await getDocs(collection(getFirestoreDb(), 'lab_items'))
  return snapshot.docs
    .filter((item) => !asText(item.data().deleted_at) && !asText(asObject(item.data().data).deletedAt))
    .map((item) => mapFirestoreLabRow(item.id, item.data()))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function subscribeToLabKanban(
  clinicId: string,
  onUpdate: (items: LabItem[]) => void,
): () => void {
  const q = query(
    collection(getFirestoreDb(), 'lab_items'),
    where('clinic_id', '==', clinicId),
    where('stage', 'in', ['queued', 'in_production', 'qc']),
  )

  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }) as LabItem)
    onUpdate(items)
  })
}

export async function moveLabItemStage(params: {
  labItemId: string
  toSubStatusId: string
  toStage: LabStage
  currentSubStatusId: string
  currentStage: LabStage
  movedByUid: string
  note?: string
}): Promise<void> {
  const stageEvent: StageEvent = {
    from_sub_status_id: params.currentSubStatusId,
    to_sub_status_id: params.toSubStatusId,
    from_stage: params.currentStage,
    to_stage: params.toStage,
    moved_by_uid: params.movedByUid,
    moved_at: Timestamp.now(),
    ...(params.note ? { note: params.note } : {}),
  }

  await updateDoc(doc(getFirestoreDb(), 'lab_items', params.labItemId), {
    stage: params.toStage,
    sub_status_id: params.toSubStatusId,
    stage_history: arrayUnion(stageEvent),
    updated_at: serverTimestamp(),
  })
}

export class FirestoreLabRepository implements LabRepository {
  private readonly currentUser: User | null

  constructor(currentUser: User | null) {
    this.currentUser = currentUser
  }

  private async findCase(caseId: string) {
    const cases = await listCasesFirebase()
    return cases.find((caseItem) => caseItem.id === caseId) ?? null
  }

  private async listCaseOrderCodes(caseId: string) {
    const orders = await listLabOrdersFirebase()
    return orders.filter((order) => order.caseId === caseId).map((order) => order.requestCode).filter((code): code is string => Boolean(code))
  }

  async loadOverview(): Promise<Result<LabOverview, string>> {
    try {
      const [cases, patients, dentistsRows, clinics, scans, labOrders] = await Promise.all([
        listCasesFirebase(),
        listPatientsFirebase({ includeDeleted: false }),
        listDentistsFirebase({ includeDeleted: false, includeInactive: false }),
        listClinicsFirebase({ includeDeleted: false }),
        listScansFirebase(),
        listLabOrdersFirebase(),
      ])
      const dentists = dentistsRows.map((dentist) => ({
        id: dentist.id,
        name: dentist.name ?? '-',
        gender: dentist.gender,
        clinicId: dentist.clinicId,
      }))
      const scoped = scopedCollections(this.currentUser, { cases, patients, labOrders, dentists })
      const dentistsById = new Map(dentists.map((dentist) => [dentist.id, dentist.name]))
      const clinicsById = new Map(clinics.map((clinic) => [clinic.id, clinic.tradeName ?? '-']))
      const scanDataById = new Map(scans.map((scan) => [scan.id, scan as unknown as Record<string, unknown>]))
      const casePrintFallbackByCaseId: LabOverview['casePrintFallbackByCaseId'] = {}

      scoped.cases.forEach((caseItem) => {
        const sourceScanData = caseItem.sourceScanId ? scanDataById.get(caseItem.sourceScanId) ?? {} : {}
        const patient = caseItem.patientId ? patients.find((item) => item.id === caseItem.patientId) : undefined
        casePrintFallbackByCaseId[caseItem.id] = {
          clinicName: caseItem.clinicId ? clinicsById.get(caseItem.clinicId) : undefined,
          dentistName: caseItem.dentistId ? dentistsById.get(caseItem.dentistId) : undefined,
          requesterName: caseItem.requestedByDentistId ? dentistsById.get(caseItem.requestedByDentistId) : undefined,
          patientBirthDate: patient?.birthDate ?? (asDateText(sourceScanData.patientBirthDate, asDateText(sourceScanData.birthDate)) || undefined),
        }
      })

      const caseById = new Map(scoped.cases.map((item): [string, Case] => [item.id, item]))
      return ok({
        items: getCanonicalLabOrders(scoped.labOrders, { caseById }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
        cases: scoped.cases,
        patientOptions: normalizePatientOptions(scoped.patients, dentistsById, clinicsById),
        dentists,
        clinics,
        casePrintFallbackByCaseId,
      })
    } catch (error) {
      return err(error instanceof Error ? error.message : 'Falha ao carregar laboratorio no Firebase.')
    }
  }

  async listOrders() {
    const overview = await this.loadOverview()
    if (!overview.ok) return overview
    return ok(overview.data.items)
  }

  async findById(id: string) {
    const snapshot = await getDoc(doc(getFirestoreDb(), 'lab_items', id))
    if (!snapshot.exists() || asText(snapshot.data().deleted_at)) return null
    return mapFirestoreLabRow(snapshot.id, snapshot.data())
  }

  async createOrder(input: RegisterLabOrderInput) {
    try {
      const linkedCase = input.caseId ? await this.findCase(input.caseId) : null
      if (input.caseId && !linkedCase) return err('Caso vinculado não encontrado.')
      if (linkedCase?.contract?.status !== 'aprovado') return err('Contrato não aprovado. Não é possível gerar OS para o laboratório.')

      const order = buildLabOrderFromInput(input, linkedCase, input.caseId ? await this.listCaseOrderCodes(input.caseId) : [])
      if (linkedCase) {
        const invalidPlan = validatePlanForCase(linkedCase, order)
        if (invalidPlan) return err(invalidPlan)
      }
      if (order.status === 'em_producao') {
        try {
          assertReadyToStartProduction(order, linkedCase)
        } catch (cause) {
          return err(cause instanceof Error ? cause.message : 'Não foi possível iniciar produção.')
        }
      }

      await setDoc(doc(getFirestoreDb(), 'lab_items', order.id), labOrderToFirestoreDocument(order))
      if (order.caseId && order.status !== 'aguardando_iniciar') {
        await updateCaseFirebase(order.caseId, { status: 'em_producao', phase: 'em_producao' })
      }
      return ok({ order })
    } catch (error) {
      return err(error instanceof Error ? error.message : 'Não foi possível criar a OS.')
    }
  }

  async updateOrder(id: string, input: UpdateLabOrderInput) {
    const current = await this.findById(id)
    if (!current) return err('Item LAB não encontrado.')
    const linkedCase = input.caseId || current.caseId ? await this.findCase(input.caseId ?? current.caseId ?? '') : null
    if ((input.caseId || current.caseId) && !linkedCase) return err('Caso vinculado inválido.')

    const plannedUpperQty = Math.max(0, Math.trunc(input.plannedUpperQty ?? current.plannedUpperQty ?? 0))
    const plannedLowerQty = Math.max(0, Math.trunc(input.plannedLowerQty ?? current.plannedLowerQty ?? 0))
    const productType = normalizeProductType(input.productType ?? input.productId ?? current.productId ?? current.productType)
    const requestedStatus = input.status ?? current.status
    const nextStatus = current.status === 'aguardando_iniciar'
      ? resolveAutomaticLabOrderStage(requestedStatus, { ...current, ...input, productType, productId: productType, plannedUpperQty, plannedLowerQty }, linkedCase)
      : requestedStatus

    if (!canTransitionLabOrderStage(current.status, nextStatus)) return err('Transição de status inválida para este item.')
    if (linkedCase) {
      const invalidPlan = validatePlanForCase(linkedCase, { plannedUpperQty, plannedLowerQty } as LabOrder)
      if (invalidPlan) return err(invalidPlan)
    }
    if (nextStatus === 'em_producao') {
      try {
        assertReadyToStartProduction({ ...current, ...input, productType, productId: productType, plannedUpperQty, plannedLowerQty }, linkedCase)
      } catch (cause) {
        return err(cause instanceof Error ? cause.message : 'Não foi possível iniciar produção.')
      }
    }

    const now = nowIsoDateTime()
    const next: LabOrder = {
      ...current,
      ...input,
      status: nextStatus,
      productType,
      productId: productType,
      priority: normalizeLabPriority(input.priority ?? current.priority),
      plannedUpperQty,
      plannedLowerQty,
      planningDefinedAt: plannedUpperQty + plannedLowerQty > 0 ? current.planningDefinedAt ?? now : undefined,
      plannedDate: input.plannedDate ? toIsoDate(input.plannedDate) : current.plannedDate,
      dueDate: input.dueDate ? toIsoDate(input.dueDate) : current.dueDate,
      updatedAt: now,
    }
    await setDoc(doc(getFirestoreDb(), 'lab_items', id), labOrderToFirestoreDocument(next), { merge: true })
    if (next.caseId && next.status !== 'aguardando_iniciar') {
      await updateCaseFirebase(next.caseId, { status: 'em_producao', phase: 'em_producao' })
    }
    return ok({ order: next })
  }

  async moveOrderToStage(input: UpdateLabStageInput) {
    return this.updateOrder(input.id, { status: input.nextStage })
  }

  async deleteOrder(id: string) {
    const orders = await listLabOrdersFirebase()
    const cases = await listCasesFirebase()
    const caseById = new Map(cases.map((item): [string, Case] => [item.id, item]))
    const idsToDelete = getLabOrderDuplicateGroupIds(id, orders, { caseById })
    const now = nowIsoDateTime()
    await Promise.all(idsToDelete.map((orderId) =>
      updateDoc(doc(getFirestoreDb(), 'lab_items', orderId), {
        deleted_at: now,
        updated_at: now,
        'data.deletedAt': now,
        'data.updatedAt': now,
      }),
    ))
    return ok(null)
  }

  async createAdvanceOrder(input: CreateAdvanceLabOrderInput) {
    const source = await this.findById(input.sourceLabItemId)
    if (!source) return err('OS de origem não encontrada.')
    if (!source.caseId) return err('OS sem caso vinculado.')
    const linkedCase = await this.findCase(source.caseId)
    if (!linkedCase) return err('Caso vinculado não encontrado.')
    if (linkedCase.contract?.status !== 'aprovado') return err('Contrato não aprovado para gerar reposição.')

    const pendingTrays = linkedCase.trays.filter((tray) => tray.state === 'pendente').map((tray) => tray.trayNumber).sort((a, b) => a - b)
    const nextTrayNumber = pendingTrays[0]
    if (!nextTrayNumber) return err('Não há placas pendentes para gerar reposição.')

    return this.createOrder({
      ...source,
      requestKind: 'producao',
      requestCode: undefined,
      trayNumber: nextTrayNumber,
      plannedUpperQty: Math.max(0, Math.trunc(input.plannedUpperQty)),
      plannedLowerQty: Math.max(0, Math.trunc(input.plannedLowerQty)),
      plannedDate: nowIsoDate(),
      dueDate: input.dueDate ?? source.expectedReplacementDate ?? source.dueDate,
      status: 'aguardando_iniciar',
      priority: 'Urgente',
      notes: `Reposição solicitada manualmente a partir de ${source.requestCode ?? source.id}.`,
    })
  }

  async registerShipment(input: RegisterShipmentInput): Promise<Result<RegisterShipmentOutput, string>> {
    const order = await this.findById(input.labOrderId)
    if (!order) return err('Selecione uma OS pronta válida.')
    const deliveredToDoctorAt = toIsoDate(input.deliveredToDoctorAt)
    const updated = await this.updateOrder(order.id, {
      deliveredToProfessionalAt: deliveredToDoctorAt,
      notes: input.note ?? order.notes,
    })
    if (!updated.ok) return updated

    if (!order.caseId) return ok({ order: updated.data.order, deliveredUpperQty: 0, deliveredLowerQty: 0 })
    const caseItem = await this.findCase(order.caseId)
    if (!caseItem) return ok({ order: updated.data.order, deliveredUpperQty: 0, deliveredLowerQty: 0 })

    const upperQty = Math.max(0, Math.trunc(input.upperQty))
    const lowerQty = Math.max(0, Math.trunc(input.lowerQty))
    const deliveredUpperQty = order.arch === 'inferior' ? 0 : upperQty
    const deliveredLowerQty = order.arch === 'superior' ? 0 : lowerQty
    const nextCase: Partial<Case> = {
      status: 'em_entrega',
      phase: 'em_producao',
      deliveryLots: [
        ...(caseItem.deliveryLots ?? []),
        ...(deliveredUpperQty > 0 ? [{
          id: createEntityId('lot'),
          arch: 'superior' as const,
          fromTray: order.trayNumber,
          toTray: order.trayNumber + deliveredUpperQty - 1,
          quantity: deliveredUpperQty,
          deliveredToDoctorAt,
          note: input.note?.trim() || undefined,
          createdAt: nowIsoDateTime(),
        }] : []),
        ...(deliveredLowerQty > 0 ? [{
          id: createEntityId('lot'),
          arch: 'inferior' as const,
          fromTray: order.trayNumber,
          toTray: order.trayNumber + deliveredLowerQty - 1,
          quantity: deliveredLowerQty,
          deliveredToDoctorAt,
          note: input.note?.trim() || undefined,
          createdAt: nowIsoDateTime(),
        }] : []),
      ],
      trays: caseItem.trays.map((tray) =>
        tray.trayNumber >= order.trayNumber && tray.trayNumber < order.trayNumber + Math.max(deliveredUpperQty, deliveredLowerQty)
          ? { ...tray, state: 'entregue' as const, deliveredAt: deliveredToDoctorAt }
          : tray,
      ),
    }
    await updateCaseFirebase(caseItem.id, nextCase)
    return ok({ order: updated.data.order, deliveredUpperQty, deliveredLowerQty })
  }

  async registerRework(input: RegisterReworkInput): Promise<Result<RegisterReworkOutput, string>> {
    const linkedCase = await this.findCase(input.caseId)
    if (!linkedCase) return err('Caso não encontrado.')
    const tray = linkedCase.trays.find((item) => item.trayNumber === input.trayNumber)
    if (!tray) return err('Placa não encontrada no caso.')

    await updateCaseFirebase(input.caseId, {
      trays: linkedCase.trays.map((item) =>
        item.trayNumber === input.trayNumber ? { ...item, state: 'rework' as const, notes: input.reason.trim() || undefined } : item,
      ),
    })
    const created = await this.createOrder({
      caseId: input.caseId,
      productType: linkedCase.productType ?? 'alinhador_12m',
      productId: linkedCase.productId ?? linkedCase.productType ?? 'alinhador_12m',
      requestKind: 'reconfeccao',
      arch: input.arch,
      plannedUpperQty: 0,
      plannedLowerQty: 0,
      patientName: linkedCase.patientName,
      patientId: linkedCase.patientId,
      dentistId: linkedCase.dentistId,
      clinicId: linkedCase.clinicId,
      trayNumber: input.trayNumber,
      plannedDate: nowIsoDate(),
      dueDate: tray.dueDate ?? nowIsoDate(),
      status: 'aguardando_iniciar',
      priority: 'Urgente',
      notes: `Reconfeccao da placa #${input.trayNumber}. Motivo: ${input.reason.trim()}`,
    })
    if (!created.ok) return created
    return ok({ caseId: input.caseId, trayNumber: input.trayNumber, createdReworkOrder: created.data.order })
  }
}

export function createFirestoreLabRepository(currentUser: User | null) {
  return new FirestoreLabRepository(currentUser)
}
