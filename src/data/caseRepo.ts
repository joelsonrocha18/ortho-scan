import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { DATA_MODE } from './dataMode'
import { loadDb, saveDb } from './db'
import { pushAudit } from './audit'
import { handleRework as handleReplacementRework, markReplacementBankDeliveredByLot } from './replacementBankRepo'
import { db as firestoreDb } from '../lib/firebaseClient'
import type { Case, CaseAttachment, CaseTray, TrayState } from '../types/Case'
import type { Patient } from '../types/Patient'
import { createEntityId } from '../shared/utils/id'
import { appendCaseTimelineEntry, createCaseTimelineEntry } from '../modules/cases/domain/entities/Case'
import { CaseLifecycleService } from '../modules/cases/domain/services/CaseLifecycleService'

type RepoResult<T> = { ok: true; data: T } | { ok: false; error: string }
type CaseDocument = Record<string, unknown>
type FirestoreDentistSummary = { id: string; name?: string; email?: string; clinicId?: string }
type FirestoreClinicSummary = { id: string; name?: string; tradeName?: string; legalName?: string }

export type CaseWithFirestoreRelations = Case & {
  patient?: Patient | null
  dentist?: FirestoreDentistSummary | null
  clinic?: FirestoreClinicSummary | null
}

const trayTransitionMap: Record<TrayState, TrayState[]> = {
  pendente: ['pendente', 'em_producao'],
  em_producao: ['em_producao', 'pronta', 'rework'],
  pronta: ['pronta', 'entregue', 'rework'],
  entregue: ['entregue', 'rework'],
  rework: ['rework', 'em_producao', 'pronta'],
}

function nowIso() {
  return new Date().toISOString()
}

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

function asText(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  return undefined
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return null as T
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T
  }

  const output: Record<string, unknown> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (entry !== undefined) {
      output[key] = stripUndefinedDeep(entry)
    }
  })
  return output as T
}

function asCaseStatus(value: unknown): Case['status'] {
  const status = asText(value)
  if (
    status === 'planejamento' ||
    status === 'em_producao' ||
    status === 'em_entrega' ||
    status === 'em_tratamento' ||
    status === 'aguardando_reposicao' ||
    status === 'finalizado'
  ) {
    return status
  }
  return 'planejamento'
}

function asCasePhase(value: unknown): Case['phase'] {
  const phase = asText(value)
  if (
    phase === 'planejamento' ||
    phase === 'orçamento' ||
    phase === 'orcamento' ||
    phase === 'contrato_pendente' ||
    phase === 'contrato_aprovado' ||
    phase === 'em_producao' ||
    phase === 'finalizado'
  ) {
    return phase === 'orcamento' ? 'orçamento' : phase
  }
  return 'planejamento'
}

function asArch(value: unknown): Case['arch'] {
  if (value === 'superior' || value === 'inferior' || value === 'ambos') return value
  return undefined
}

function asTreatmentOrigin(value: unknown): Case['treatmentOrigin'] {
  if (value === 'interno' || value === 'externo') return value
  return undefined
}

function mapFirestorePatient(id: string, data: CaseDocument): Patient {
  const now = nowIso()
  const firstName = asText(data.firstName) ?? asText(data.first_name)
  const lastName = asText(data.lastName) ?? asText(data.last_name)
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return {
    id: asText(data.id) ?? id,
    shortId: asText(data.shortId) ?? asText(data.short_id),
    name: asText(data.name) ?? (fallbackName || 'Paciente sem nome'),
    firstName,
    lastName,
    cpf: asText(data.cpf),
    phone: asText(data.phone),
    whatsapp: asText(data.whatsapp),
    email: asText(data.email),
    birthDate: asText(data.birthDate) ?? asText(data.birth_date),
    gender: data.gender === 'masculino' || data.gender === 'feminino' || data.gender === 'outro' ? data.gender : undefined,
    address: asObject(data.address) as Patient['address'],
    clinicId: asText(data.clinicId) ?? asText(data.clinic_id),
    primaryDentistId: asText(data.primaryDentistId) ?? asText(data.primary_dentist_id),
    notes: asText(data.notes),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    deletedAt: asText(data.deletedAt) ?? asText(data.deleted_at),
  }
}

function mapFirestoreDentist(id: string, data: CaseDocument): FirestoreDentistSummary {
  const firstName = asText(data.firstName) ?? asText(data.first_name)
  const lastName = asText(data.lastName) ?? asText(data.last_name)
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return {
    id: asText(data.id) ?? id,
    name: asText(data.name) ?? asText(data.full_name) ?? fallbackName,
    email: asText(data.email),
    clinicId: asText(data.clinicId) ?? asText(data.clinic_id),
  }
}

function mapFirestoreClinic(id: string, data: CaseDocument): FirestoreClinicSummary {
  return {
    id: asText(data.id) ?? id,
    name: asText(data.name) ?? asText(data.trade_name) ?? asText(data.legal_name),
    tradeName: asText(data.tradeName) ?? asText(data.trade_name),
    legalName: asText(data.legalName) ?? asText(data.legal_name),
  }
}

async function readRelatedDocument(collectionName: string, id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), collectionName, id))
  return snapshot.exists() ? snapshot.data() : null
}

function mapCaseDocument(id: string, row: CaseDocument): Case {
  const data = asObject(row.data) ?? {}
  const now = nowIso()
  const totalTraysUpper = asNumber(data.totalTraysUpper) ?? asNumber(row.total_trays_upper)
  const totalTraysLower = asNumber(data.totalTraysLower) ?? asNumber(row.total_trays_lower)
  const totalTraysFallback = Math.max(totalTraysUpper ?? 0, totalTraysLower ?? 0)
  const patientId = asText(data.patientId) ?? asText(row.patient_id)
  const dentistId = asText(data.dentistId) ?? asText(row.dentist_id)
  const clinicId = asText(data.clinicId) ?? asText(row.clinic_id)

  return {
    ...(data as Partial<Case>),
    id: asText(data.id) ?? asText(row.id) ?? id,
    shortId: asText(data.shortId) ?? asText(row.short_id),
    productType: (asText(data.productType) ?? asText(row.product_type)) as Case['productType'],
    productId: (asText(data.productId) ?? asText(row.product_id)) as Case['productId'],
    requestedProductId: asText(data.requestedProductId),
    requestedProductLabel: asText(data.requestedProductLabel),
    treatmentCode: asText(data.treatmentCode),
    treatmentOrigin: asTreatmentOrigin(data.treatmentOrigin),
    patientName: asText(data.patientName) ?? 'Paciente sem nome',
    patientId,
    dentistId,
    requestedByDentistId: asText(data.requestedByDentistId) ?? asText(row.requested_by_dentist_id),
    clinicId,
    sourceScanId: asText(data.sourceScanId) ?? asText(row.scan_id),
    sourceExamCode: asText(data.sourceExamCode),
    arch: asArch(data.arch),
    scanDate: asText(data.scanDate) ?? asText(row.created_at)?.slice(0, 10) ?? now.slice(0, 10),
    totalTrays: asNumber(data.totalTrays) ?? totalTraysFallback,
    changeEveryDays: asNumber(data.changeEveryDays) ?? asNumber(row.change_every_days) ?? 7,
    totalTraysUpper,
    totalTraysLower,
    attachmentBondingTray: asBoolean(data.attachmentBondingTray) ?? asBoolean(row.attachments_tray),
    status: asCaseStatus(data.status ?? row.status),
    phase: asCasePhase(data.phase),
    budget: asObject(data.budget) as Case['budget'],
    contract: asObject(data.contract) as Case['contract'],
    deliveryLots: asArray<NonNullable<Case['deliveryLots']>[number]>(data.deliveryLots),
    installation: asObject(data.installation) as Case['installation'],
    trays: asArray<CaseTray>(data.trays),
    attachments: asArray<CaseAttachment>(data.attachments),
    planningVersions: asArray<NonNullable<Case['planningVersions']>[number]>(data.planningVersions),
    stageApprovals: asArray<NonNullable<Case['stageApprovals']>[number]>(data.stageApprovals),
    financial: asObject(data.financial) as Case['financial'],
    lifecycleStatus: asText(data.lifecycleStatus) as Case['lifecycleStatus'],
    sla: asObject(data.sla) as Case['sla'],
    reworkSummary: asObject(data.reworkSummary) as Case['reworkSummary'],
    domainEvents: asArray<NonNullable<Case['domainEvents']>[number]>(data.domainEvents),
    timelineEntries: asArray<NonNullable<Case['timelineEntries']>[number]>(data.timelineEntries),
    scanFiles: asArray<NonNullable<Case['scanFiles']>[number]>(data.scanFiles),
    planningNote: asText(data.planningNote),
    complaint: asText(data.complaint),
    dentistGuidance: asText(data.dentistGuidance),
    createdAt: asText(data.createdAt) ?? asText(row.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(row.updated_at) ?? now,
  }
}

function caseToFirestorePatch(caseItem: Case): CaseDocument {
  const sanitizedCase = stripUndefinedDeep(caseItem)

  return {
    id: caseItem.id,
    clinic_id: caseItem.clinicId ?? null,
    patient_id: caseItem.patientId ?? null,
    dentist_id: caseItem.dentistId ?? null,
    requested_by_dentist_id: caseItem.requestedByDentistId ?? null,
    scan_id: caseItem.sourceScanId ?? null,
    status: caseItem.status,
    change_every_days: caseItem.changeEveryDays,
    total_trays_upper: caseItem.totalTraysUpper ?? null,
    total_trays_lower: caseItem.totalTraysLower ?? null,
    attachments_tray: caseItem.attachmentBondingTray ?? null,
    product_type: caseItem.productType ?? null,
    product_id: caseItem.productId ?? null,
    short_id: caseItem.shortId ?? null,
    updated_at: caseItem.updatedAt,
    data: sanitizedCase,
  }
}

async function readCaseFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'cases', id))
  if (!snapshot.exists()) return null
  return mapCaseDocument(snapshot.id, snapshot.data())
}

async function hydrateCaseRelations(caseItem: Case): Promise<CaseWithFirestoreRelations> {
  const [patientRow, dentistRow, clinicRow] = await Promise.all([
    caseItem.patientId ? readRelatedDocument('patients', caseItem.patientId) : Promise.resolve(null),
    caseItem.dentistId ? readRelatedDocument('dentists', caseItem.dentistId) : Promise.resolve(null),
    caseItem.clinicId ? readRelatedDocument('clinics', caseItem.clinicId) : Promise.resolve(null),
  ])

  const patient = patientRow && caseItem.patientId ? mapFirestorePatient(caseItem.patientId, patientRow) : null
  const dentist = dentistRow && caseItem.dentistId ? mapFirestoreDentist(caseItem.dentistId, dentistRow) : null
  const clinic = clinicRow && caseItem.clinicId ? mapFirestoreClinic(caseItem.clinicId, clinicRow) : null

  return {
    ...caseItem,
    patientName: caseItem.patientName || patient?.name || 'Paciente sem nome',
    patient,
    dentist,
    clinic,
  }
}

function removeTrayFromDeliveryLots(
  lots: NonNullable<Case['deliveryLots']>,
  trayNumber: number,
  reworkArc: 'superior' | 'inferior' | 'ambos',
) {
  const shouldAffect = (arch: 'superior' | 'inferior' | 'ambos') => {
    if (reworkArc === 'ambos') return true
    if (arch === 'ambos') return false
    return arch === reworkArc
  }
  const next: NonNullable<Case['deliveryLots']> = []
  lots.forEach((lot) => {
    if (!shouldAffect(lot.arch) || trayNumber < lot.fromTray || trayNumber > lot.toTray) {
      next.push(lot)
      return
    }
    const leftQty = Math.max(0, trayNumber - lot.fromTray)
    const rightQty = Math.max(0, lot.toTray - trayNumber)
    if (leftQty > 0) {
      next.push({
        ...lot,
        id: `${lot.id}_l_${trayNumber}`,
        fromTray: lot.fromTray,
        toTray: trayNumber - 1,
        quantity: leftQty,
      })
    }
    if (rightQty > 0) {
      next.push({
        ...lot,
        id: `${lot.id}_r_${trayNumber}`,
        fromTray: trayNumber + 1,
        toTray: lot.toTray,
        quantity: rightQty,
      })
    }
  })
  return next
}

function deriveCaseLifecycle(caseItem: Case, nextTrays: CaseTray[]): Pick<Case, 'status' | 'phase'> {
  return CaseLifecycleService.deriveLifecycleFromTrays(caseItem, nextTrays)
}

export function listCases() {
  return loadDb().cases
}

export async function listCasesFirebase(options?: { hydrateRelations?: boolean }) {
  const snapshot = await getDocs(collection(getFirestoreDb(), 'cases'))
  const items = snapshot.docs
    .filter((item) => !asText(item.data().deleted_at) && !asText(asObject(item.data().data)?.deletedAt))
    .map((item) => mapCaseDocument(item.id, item.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (!options?.hydrateRelations) return items
  return Promise.all(items.map((item) => hydrateCaseRelations(item)))
}

export async function listCasesAsync(options?: { hydrateRelations?: boolean }) {
  if (DATA_MODE === 'firebase') return listCasesFirebase(options)
  return listCases()
}

export function getCase(id: string) {
  return loadDb().cases.find((item) => item.id === id) ?? null
}

export async function createCaseFirebase(payload: Omit<Case, 'id' | 'createdAt' | 'updatedAt'>): Promise<Case> {
  const now = nowIso()
  const next: Case = {
    ...payload,
    id: createEntityId('case'),
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(getFirestoreDb(), 'cases', next.id), {
    ...caseToFirestorePatch(next),
    created_at: next.createdAt,
    deleted_at: null,
  })
  return next
}

export async function createCaseAsync(payload: Omit<Case, 'id' | 'createdAt' | 'updatedAt'>) {
  if (DATA_MODE === 'firebase') return createCaseFirebase(payload)
  throw new Error('Criacao direta de caso so esta implementada para Firebase neste repositorio.')
}

export async function getCaseFirebase(id: string, options?: { hydrateRelations?: boolean }) {
  const caseItem = await readCaseFromFirestore(id)
  if (!caseItem) return null
  return options?.hydrateRelations ? hydrateCaseRelations(caseItem) : caseItem
}

export async function getCaseAsync(id: string, options?: { hydrateRelations?: boolean }) {
  if (DATA_MODE === 'firebase') return getCaseFirebase(id, options)
  return getCase(id)
}

export function updateCase(id: string, patch: Partial<Case>): Case | null {
  const db = loadDb()
  let updated: Case | null = null

  db.cases = db.cases.map((item) => {
    if (item.id !== id) {
      return item
    }
    updated = {
      ...item,
      ...patch,
      updatedAt: nowIso(),
    }
    return updated
  })

  const updatedCase = db.cases.find((item) => item.id === id) ?? null
  if (updatedCase) {
    pushAudit(db, {
      entity: 'case',
      entityId: id,
      action: 'case.update',
      message: `Caso ${updatedCase.treatmentCode ?? updatedCase.id} atualizado.`,
    })
  }
  saveDb(db)
  return updatedCase
}

export async function updateCaseFirebase(id: string, patch: Partial<Case>): Promise<Case | null> {
  const current = await readCaseFromFirestore(id)
  if (!current) return null

  const updated: Case = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  }
  await updateDoc(doc(getFirestoreDb(), 'cases', id), caseToFirestorePatch(updated))
  return updated
}

export async function updateCaseAsync(id: string, patch: Partial<Case>) {
  if (DATA_MODE === 'firebase') return updateCaseFirebase(id, patch)
  return updateCase(id, patch)
}

export function deleteCase(id: string): RepoResult<null> {
  const db = loadDb()
  const target = db.cases.find((item) => item.id === id)
  if (!target) {
    return { ok: false, error: 'Caso não encontrado.' }
  }

  db.cases = db.cases.filter((item) => item.id !== id)
  db.labItems = db.labItems.filter((item) => item.caseId !== id)
  db.replacementBank = db.replacementBank.filter((entry) => entry.caseId !== id)
  db.scans = db.scans.map((item) =>
    item.linkedCaseId === id
      ? { ...item, linkedCaseId: undefined, status: 'aprovado', updatedAt: nowIso() }
      : item,
  )

  pushAudit(db, {
    entity: 'case',
    entityId: id,
    action: 'case.delete',
    message: `Caso ${target.treatmentCode ?? target.id} excluido com itens LAB vinculados.`,
  })
  if (target.patientId) {
    pushAudit(db, {
      entity: 'patient',
      entityId: target.patientId,
      action: 'patient.history.case_delete',
      message: `Pedido ${target.treatmentCode ?? target.id} excluido com OS vinculadas.`,
    })
  }
  saveDb(db)
  return { ok: true, data: null }
}

export async function deleteCaseFirebase(id: string): Promise<RepoResult<null>> {
  const target = await readCaseFromFirestore(id)
  if (!target) {
    return { ok: false, error: 'Caso nao encontrado.' }
  }

  const deletedAt = nowIso()
  await updateDoc(doc(getFirestoreDb(), 'cases', id), {
    deleted_at: deletedAt,
    updated_at: deletedAt,
    'data.deletedAt': deletedAt,
    'data.updatedAt': deletedAt,
  })
  return { ok: true, data: null }
}

export async function deleteCaseAsync(id: string): Promise<RepoResult<null>> {
  if (DATA_MODE === 'firebase') return deleteCaseFirebase(id)
  return deleteCase(id)
}

export function setTrayState(caseId: string, trayNumber: number, newState: TrayState): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }

  const tray = targetCase.trays.find((item) => item.trayNumber === trayNumber)
  if (!tray) {
    return { ok: false, error: 'Placa não encontrada.' }
  }

  const allowed = trayTransitionMap[tray.state]
  if (!allowed.includes(newState)) {
    return { ok: false, error: 'Transição de estado inválida para esta placa.' }
  }
  if (tray.state === 'entregue' && newState !== 'entregue' && newState !== 'rework') {
    return { ok: false, error: 'Não é permitido regredir uma placa já entregue ao dentista.' }
  }

  const nextTrays: CaseTray[] = targetCase.trays.map((item) => {
    if (item.trayNumber !== trayNumber) {
      return item
    }
    return {
      ...item,
      state: newState,
      deliveredAt: newState === 'entregue' ? nowIso() : item.deliveredAt,
    }
  })

  const lifecycle = deriveCaseLifecycle(targetCase, nextTrays)
  const updated = updateCase(caseId, {
    trays: nextTrays,
    ...lifecycle,
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'tray_updated',
      title: 'Placa atualizada',
      description: `Placa #${trayNumber} alterada para ${newState}.`,
      metadata: {
        trayNumber,
        status: lifecycle.status,
        phase: lifecycle.phase,
      },
    })),
  })
  if (!updated) {
    return { ok: false, error: 'Não foi possível atualizar a placa.' }
  }
  const db = loadDb()
  pushAudit(db, {
    entity: 'case',
    entityId: caseId,
    action: 'case.tray_state',
    message: `Placa #${trayNumber} alterada para ${newState}.`,
  })
  saveDb(db)

  return { ok: true, data: updated }
}

export async function setTrayStateFirebase(
  caseId: string,
  trayNumber: number,
  newState: TrayState,
): Promise<RepoResult<Case>> {
  const targetCase = await readCaseFromFirestore(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso nao encontrado.' }
  }

  const tray = targetCase.trays.find((item) => item.trayNumber === trayNumber)
  if (!tray) {
    return { ok: false, error: 'Placa nao encontrada.' }
  }

  const allowed = trayTransitionMap[tray.state]
  if (!allowed.includes(newState)) {
    return { ok: false, error: 'Transicao de estado invalida para esta placa.' }
  }
  if (tray.state === 'entregue' && newState !== 'entregue' && newState !== 'rework') {
    return { ok: false, error: 'Nao e permitido regredir uma placa ja entregue ao dentista.' }
  }

  const nextTrays: CaseTray[] = targetCase.trays.map((item) => {
    if (item.trayNumber !== trayNumber) {
      return item
    }
    return {
      ...item,
      state: newState,
      deliveredAt: newState === 'entregue' ? nowIso() : item.deliveredAt,
    }
  })

  const lifecycle = deriveCaseLifecycle(targetCase, nextTrays)
  const updated = await updateCaseFirebase(caseId, {
    trays: nextTrays,
    ...lifecycle,
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'tray_updated',
      title: 'Placa atualizada',
      description: `Placa #${trayNumber} alterada para ${newState}.`,
      metadata: {
        trayNumber,
        status: lifecycle.status,
        phase: lifecycle.phase,
      },
    })),
  })
  if (!updated) {
    return { ok: false, error: 'Nao foi possivel atualizar a placa.' }
  }

  return { ok: true, data: updated }
}

export async function setTrayStateAsync(
  caseId: string,
  trayNumber: number,
  newState: TrayState,
): Promise<RepoResult<Case>> {
  if (DATA_MODE === 'firebase') return setTrayStateFirebase(caseId, trayNumber, newState)
  return setTrayState(caseId, trayNumber, newState)
}

export function addAttachment(
  caseId: string,
  attachment: Omit<CaseAttachment, 'id' | 'createdAt'>,
): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }

  const nextAttachment: CaseAttachment = {
    ...attachment,
    id: `att_${Date.now()}`,
    createdAt: nowIso(),
  }

  const updated = updateCase(caseId, { attachments: [nextAttachment, ...targetCase.attachments] })
  if (!updated) {
    return { ok: false, error: 'Não foi possível adicionar o anexo.' }
  }

  return { ok: true, data: updated }
}

export function createDeliveryBatch(
  caseId: string,
  fromTray: number,
  toTray: number,
  deliveredAt: string,
): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }

  if (fromTray > toTray) {
    return { ok: false, error: 'Intervalo inválido. O valor "De" deve ser menor ou igual a "Até".' }
  }

  const range = targetCase.trays.filter((item) => item.trayNumber >= fromTray && item.trayNumber <= toTray)
  if (range.length === 0) {
    return { ok: false, error: 'Nenhuma placa encontrada neste intervalo.' }
  }

  const invalid = range.find((item) => item.state !== 'pronta')
  if (invalid) {
    return { ok: false, error: `A placa #${invalid.trayNumber} não está pronta para entrega.` }
  }

  const nextTrays = targetCase.trays.map((item) =>
    item.trayNumber >= fromTray && item.trayNumber <= toTray
      ? { ...item, state: 'entregue' as const, deliveredAt }
      : item,
  )

  const lifecycle = deriveCaseLifecycle(targetCase, nextTrays)
  const updated = updateCase(caseId, {
    trays: nextTrays,
    ...lifecycle,
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'delivery_registered',
      title: 'Entrega por lote registrada',
      description: `Lote de placas #${fromTray} a #${toTray} entregue.`,
      metadata: {
        status: lifecycle.status,
        phase: lifecycle.phase,
      },
    })),
  })
  if (!updated) {
    return { ok: false, error: 'Não foi possível registrar a entrega por lote.' }
  }

  return { ok: true, data: updated }
}

export function markCaseScanFileError(caseId: string, scanFileId: string, reason: string): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, error: 'Motivo do erro é obrigatório.' }
  }

  const nextScanFiles = (targetCase.scanFiles ?? []).map((item) =>
    item.id === scanFileId
      ? { ...item, status: 'erro' as const, flaggedAt: nowIso(), flaggedReason: trimmed }
      : item,
  )

  const updated = updateCase(caseId, { scanFiles: nextScanFiles })
  if (!updated) {
    return { ok: false, error: 'Não foi possível atualizar o anexo.' }
  }
  return { ok: true, data: updated }
}

export function clearCaseScanFileError(caseId: string, scanFileId: string): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }

  const nextScanFiles = (targetCase.scanFiles ?? []).map((item) =>
    item.id === scanFileId
      ? { ...item, status: 'ok' as const }
      : item,
  )

  const updated = updateCase(caseId, { scanFiles: nextScanFiles })
  if (!updated) {
    return { ok: false, error: 'Não foi possível atualizar o anexo.' }
  }
  return { ok: true, data: updated }
}

export function registerCaseInstallation(
  caseId: string,
  payload: { installedAt: string; note?: string; deliveredUpper?: number; deliveredLower?: number },
): RepoResult<Case> {
  const db = loadDb()
  const targetCase = db.cases.find((item) => item.id === caseId) ?? null
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }
  const hasProductionOrder = db.labItems.some((item) => item.caseId === caseId && (item.requestKind ?? 'producao') === 'producao')
  if (!hasProductionOrder) {
    return { ok: false, error: 'Ordem de serviço do LAB ainda não foi gerada para este caso.' }
  }
  const deliveryLots = targetCase.deliveryLots ?? []
  if (deliveryLots.length === 0) {
    return { ok: false, error: 'Registre antes a entrega ao dentista para iniciar entrega ao paciente.' }
  }
  const currentInstallation = targetCase.installation
  const isFirstInstallation = !currentInstallation?.installedAt
  if (isFirstInstallation && !payload.installedAt) {
    return { ok: false, error: 'Data de instalação é obrigatória.' }
  }
  const upperTotal = targetCase.totalTraysUpper ?? targetCase.totalTrays
  const lowerTotal = targetCase.totalTraysLower ?? targetCase.totalTrays
  const currentDeliveredUpper = currentInstallation?.deliveredUpper ?? 0
  const currentDeliveredLower = currentInstallation?.deliveredLower ?? 0
  const inputUpper = payload.deliveredUpper ?? 0
  const inputLower = payload.deliveredLower ?? 0
  if (isFirstInstallation && Math.trunc(inputUpper + inputLower) <= 0) {
    return { ok: false, error: 'Na primeira instalação, informe ao menos 1 alinhador entregue ao paciente.' }
  }
  if (!Number.isFinite(inputUpper) || inputUpper < 0) {
    return { ok: false, error: `Quantidade superior inválida. Informe entre 0 e ${upperTotal}.` }
  }
  if (!Number.isFinite(inputLower) || inputLower < 0) {
    return { ok: false, error: `Quantidade inferior inválida. Informe entre 0 e ${lowerTotal}.` }
  }
  const deliveredUpper = Math.trunc(currentDeliveredUpper + inputUpper)
  const deliveredLower = Math.trunc(currentDeliveredLower + inputLower)
  if (deliveredUpper > upperTotal) {
    return { ok: false, error: `Quantidade superior inválida. Informe entre 0 e ${upperTotal}.` }
  }
  if (deliveredLower > lowerTotal) {
    return { ok: false, error: `Quantidade inferior inválida. Informe entre 0 e ${lowerTotal}.` }
  }
  const deliveredToDentist = deliveryLots.reduce(
    (acc, lot) => {
      if (lot.arch === 'superior') acc.upper += lot.quantity
      if (lot.arch === 'inferior') acc.lower += lot.quantity
      if (lot.arch === 'ambos') {
        acc.upper += lot.quantity
        acc.lower += lot.quantity
      }
      return acc
    },
    { upper: 0, lower: 0 },
  )
  if (Math.trunc(deliveredUpper) > deliveredToDentist.upper) {
    return {
      ok: false,
      error: `Entrega ao paciente superior excede o entregue ao dentista (${deliveredToDentist.upper}).`,
    }
  }
  if (Math.trunc(deliveredLower) > deliveredToDentist.lower) {
    return {
      ok: false,
      error: `Entrega ao paciente inferior excede o entregue ao dentista (${deliveredToDentist.lower}).`,
    }
  }

  const normalizedDeliveredUpper = deliveredUpper
  const normalizedDeliveredLower = deliveredLower
  const currentPairDelivered = Math.max(0, Math.min(currentDeliveredUpper, currentDeliveredLower))
  const nextPairDelivered = Math.max(0, Math.min(normalizedDeliveredUpper, normalizedDeliveredLower))
  const newPairQty = Math.max(0, nextPairDelivered - currentPairDelivered)
  if (newPairQty > 0 && !payload.installedAt) {
    return { ok: false, error: 'Data da entrega ao paciente é obrigatória.' }
  }
  const patientDeliveryLots = [...(currentInstallation?.patientDeliveryLots ?? [])]
  if (newPairQty > 0) {
    const fromTray = currentPairDelivered + 1
    const toTray = fromTray + newPairQty - 1
    patientDeliveryLots.push({
      id: `patient_lot_${Date.now()}`,
      fromTray,
      toTray,
      quantity: newPairQty,
      deliveredAt: payload.installedAt,
      note: payload.note?.trim() || undefined,
      createdAt: nowIso(),
    })
  }
  const updated = updateCase(caseId, {
    installation: {
      installedAt: currentInstallation?.installedAt ?? payload.installedAt,
      note: payload.note?.trim() || currentInstallation?.note,
      deliveredUpper: normalizedDeliveredUpper,
      deliveredLower: normalizedDeliveredLower,
      patientDeliveryLots,
      actualChangeDates: currentInstallation?.actualChangeDates,
    },
    status: targetCase.status === 'finalizado' ? 'finalizado' : 'em_tratamento',
    phase: targetCase.phase === 'finalizado' ? 'finalizado' : 'em_producao',
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'installation_registered',
      title: currentInstallation?.installedAt ? 'Reposição ao paciente registrada' : 'Instalação inicial registrada',
      description: payload.note?.trim() || undefined,
      metadata: {
        status: targetCase.status === 'finalizado' ? 'finalizado' : 'em_tratamento',
        phase: targetCase.phase === 'finalizado' ? 'finalizado' : 'em_producao',
      },
    })),
  })
  if (!updated) {
    return { ok: false, error: 'Não foi possível registrar a instalação.' }
  }
  return { ok: true, data: updated }
}

export function registerCaseDeliveryLot(
  caseId: string,
  payload: {
    arch: 'superior' | 'inferior' | 'ambos'
    fromTray: number
    toTray: number
    deliveredToDoctorAt: string
    note?: string
  },
): RepoResult<Case> {
  const db = loadDb()
  const targetCase = db.cases.find((item) => item.id === caseId) ?? null
  if (!targetCase) {
    return { ok: false, error: 'Caso não encontrado.' }
  }
  if (targetCase.contract?.status !== 'aprovado') {
    return { ok: false, error: 'Contrato não aprovado para registrar entrega ao dentista.' }
  }
  const hasProductionOrder = db.labItems.some((item) => item.caseId === caseId && (item.requestKind ?? 'producao') === 'producao')
  if (!hasProductionOrder) {
    return { ok: false, error: 'Ordem de serviço do LAB ainda não foi gerada para este caso.' }
  }

  const total = targetCase.totalTrays
  if (!Number.isFinite(payload.fromTray) || payload.fromTray < 1) {
    return { ok: false, error: 'Placa inicial deve ser maior ou igual a 1.' }
  }
  if (!Number.isFinite(payload.toTray) || payload.toTray < payload.fromTray) {
    return { ok: false, error: 'Intervalo de placas inválido.' }
  }
  if (payload.toTray > total) {
    return { ok: false, error: `Intervalo excede o total do caso (${total}).` }
  }
  if (!payload.deliveredToDoctorAt) {
    return { ok: false, error: 'Data da entrega é obrigatória.' }
  }

  const existing = targetCase.deliveryLots ?? []
  const overlaps = existing.some((lot) => {
    const sameArch = lot.arch === payload.arch
    const sameRange = lot.fromTray === payload.fromTray && lot.toTray === payload.toTray
    const sameDate = lot.deliveredToDoctorAt === payload.deliveredToDoctorAt
    return sameArch && sameRange && sameDate
  })
  if (overlaps) {
    return { ok: false, error: 'Lote duplicado para mesma arcada/intervalo/data.' }
  }
  const inRange = targetCase.trays.filter((item) => item.trayNumber >= payload.fromTray && item.trayNumber <= payload.toTray)
  if (inRange.length === 0) {
    return { ok: false, error: 'Nenhuma placa encontrada neste intervalo.' }
  }
  const notReady = inRange.find((item) => item.state !== 'pronta' && item.state !== 'entregue' && item.state !== 'rework')
  if (notReady) {
    return { ok: false, error: `A placa #${notReady.trayNumber} não está pronta para entrega.` }
  }
  const nextTrays = targetCase.trays.map((item) =>
    item.trayNumber >= payload.fromTray && item.trayNumber <= payload.toTray
      ? { ...item, state: 'entregue' as const, deliveredAt: payload.deliveredToDoctorAt }
      : item,
  )

  const newLot = {
    id: `lot_${Date.now()}`,
    arch: payload.arch,
    fromTray: payload.fromTray,
    toTray: payload.toTray,
    quantity: payload.toTray - payload.fromTray + 1,
    deliveredToDoctorAt: payload.deliveredToDoctorAt,
    note: payload.note?.trim() || undefined,
    createdAt: nowIso(),
  }

  const updated = updateCase(caseId, {
    trays: nextTrays,
    deliveryLots: [...existing, newLot],
    status: 'em_entrega',
    phase: 'em_producao',
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'delivery_registered',
      title: 'Entrega ao profissional registrada',
      description: `Arcada ${payload.arch}, placas #${payload.fromTray} a #${payload.toTray}.`,
      metadata: {
        status: 'em_entrega',
        phase: 'em_producao',
      },
    })),
  })
  if (!updated) {
    return { ok: false, error: 'Não foi possível registrar o lote.' }
  }
  markReplacementBankDeliveredByLot({ id: caseId }, payload)
  return { ok: true, data: updated }
}

export function handleRework(
  caseId: string,
  payload: {
    trayNumber: number
    arch: 'superior' | 'inferior' | 'ambos'
    sourceLabItemId?: string
  },
): RepoResult<Case> {
  const targetCase = getCase(caseId)
  if (!targetCase) return { ok: false, error: 'Caso não encontrado.' }

  const tray = targetCase.trays.find((item) => item.trayNumber === payload.trayNumber)
  if (!tray) return { ok: false, error: 'Placa não encontrada no caso.' }

  const nextLots = removeTrayFromDeliveryLots(targetCase.deliveryLots ?? [], payload.trayNumber, payload.arch)
  let nextInstallation = targetCase.installation
  if (targetCase.installation) {
    const currentUpper = targetCase.installation.deliveredUpper ?? 0
    const currentLower = targetCase.installation.deliveredLower ?? 0
    const affectUpper = (payload.arch === 'superior' || payload.arch === 'ambos') && payload.trayNumber <= currentUpper
    const affectLower = (payload.arch === 'inferior' || payload.arch === 'ambos') && payload.trayNumber <= currentLower
    nextInstallation = {
      ...targetCase.installation,
      deliveredUpper: Math.max(0, currentUpper - (affectUpper ? 1 : 0)),
      deliveredLower: Math.max(0, currentLower - (affectLower ? 1 : 0)),
    }
  }

  const updated = updateCase(caseId, {
    deliveryLots: nextLots,
    installation: nextInstallation,
    timelineEntries: appendCaseTimelineEntry(targetCase, createCaseTimelineEntry({
      at: nowIso(),
      type: 'tray_updated',
      title: 'Reconfecção registrada',
      description: `Placa #${payload.trayNumber} marcada para reconfecção (${payload.arch}).`,
      metadata: {
        trayNumber: payload.trayNumber,
        status: targetCase.status,
        phase: targetCase.phase,
      },
    })),
  })
  if (!updated) return { ok: false, error: 'Não foi possível ajustar dados da reconfecção.' }

  handleReplacementRework(caseId, payload.trayNumber, payload.arch, payload.sourceLabItemId)
  return { ok: true, data: updated }
}

