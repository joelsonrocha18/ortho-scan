import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { pushAudit } from './audit'
import { DATA_MODE } from './dataMode'
import { loadDb, saveDb } from './db'
import { getCurrentUser } from '../lib/auth'
import { db as firestoreDb } from '../lib/firebaseClient'
import { logger } from '../lib/logger'
import { uploadFileToStorage } from '../lib/storageUpload'
import { nextOrthTreatmentCode, normalizeOrthTreatmentCode } from '../lib/treatmentCode'
import {
  buildCaseFromScanDraft,
  resolveTreatmentOriginFromClinic,
} from '../modules/cases/domain/entities/Case'
import { CaseLifecycleService } from '../modules/cases/domain/services/CaseLifecycleService'
import { createLocalCaseRepository } from '../modules/cases/infra/local/LocalCaseRepository'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId, createExamCode } from '../shared/utils/id'
import { validateCreateCaseFromScanInput, validateCreateScanInput } from '../shared/validators'
import type { Case } from '../types/Case'
import type { Scan, ScanAttachment } from '../types/Scan'

type ScanDocument = Record<string, unknown>

function nowIso() {
  return nowIsoDateTime()
}

function nextExamCode() {
  return createExamCode()
}

function nextTreatmentCode(db: ReturnType<typeof loadDb>) {
  const existing = [
    ...db.cases.map((item) => item.treatmentCode ?? ''),
    ...db.scans.map((item) => item.serviceOrderCode ?? ''),
  ]
  return nextOrthTreatmentCode(existing)
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

function asScanStatus(value: unknown): Scan['status'] {
  if (value === 'pendente' || value === 'aprovado' || value === 'reprovado' || value === 'convertido') return value
  return 'pendente'
}

function asScanArch(value: unknown): Scan['arch'] {
  if (value === 'superior' || value === 'inferior' || value === 'ambos') return value
  return 'ambos'
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function mapScanDocument(id: string, row: ScanDocument): Scan {
  const data = asObject(row.data) ?? {}
  const now = nowIso()
  return {
    ...(data as Partial<Scan>),
    id: asText(data.id) ?? asText(row.id) ?? id,
    shortId: asText(data.shortId) ?? asText(row.short_id),
    serviceOrderCode: asText(data.serviceOrderCode),
    purposeProductId: asText(data.purposeProductId),
    purposeProductType: asText(data.purposeProductType),
    purposeLabel: asText(data.purposeLabel),
    patientName: asText(data.patientName) ?? 'Paciente sem nome',
    patientId: asText(data.patientId) ?? asText(row.patient_id),
    dentistId: asText(data.dentistId) ?? asText(row.dentist_id),
    requestedByDentistId: asText(data.requestedByDentistId) ?? asText(row.requested_by_dentist_id),
    clinicId: asText(data.clinicId) ?? asText(row.clinic_id),
    scanDate: asText(data.scanDate) ?? asText(row.created_at)?.slice(0, 10) ?? now.slice(0, 10),
    arch: asScanArch(data.arch ?? row.arch),
    complaint: asText(data.complaint) ?? asText(row.complaint),
    dentistGuidance: asText(data.dentistGuidance) ?? asText(row.dentist_guidance),
    notes: asText(data.notes),
    planningDetectedUpperTrays: asNumber(data.planningDetectedUpperTrays),
    planningDetectedLowerTrays: asNumber(data.planningDetectedLowerTrays),
    planningDetectedAt: asText(data.planningDetectedAt),
    planningDetectedSource: asText(data.planningDetectedSource) as Scan['planningDetectedSource'],
    attachments: asArray<ScanAttachment>(data.attachments),
    status: asScanStatus(data.status),
    linkedCaseId: asText(data.linkedCaseId),
    createdAt: asText(data.createdAt) ?? asText(row.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(row.updated_at) ?? now,
  }
}

function scanToFirestoreDocument(scan: Scan): ScanDocument {
  return {
    id: scan.id,
    clinic_id: scan.clinicId ?? null,
    patient_id: scan.patientId ?? null,
    dentist_id: scan.dentistId ?? null,
    requested_by_dentist_id: scan.requestedByDentistId ?? null,
    arch: scan.arch,
    complaint: scan.complaint ?? null,
    dentist_guidance: scan.dentistGuidance ?? null,
    created_at: scan.createdAt,
    updated_at: scan.updatedAt,
    deleted_at: null,
    data: scan,
  }
}

function caseToFirestoreDocument(caseItem: Case): ScanDocument {
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
    created_at: caseItem.createdAt,
    updated_at: caseItem.updatedAt,
    deleted_at: null,
    data: caseItem,
  }
}

async function readScanFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'scans', id))
  if (!snapshot.exists()) return null
  return mapScanDocument(snapshot.id, snapshot.data())
}

async function nextTreatmentCodeFirebase() {
  const [casesSnapshot, scansSnapshot] = await Promise.all([
    getDocs(collection(getFirestoreDb(), 'cases')),
    getDocs(collection(getFirestoreDb(), 'scans')),
  ])
  const existing = [
    ...casesSnapshot.docs.map((item) => {
      const data = asObject(item.data().data) ?? {}
      return asText(data.treatmentCode) ?? asText(item.data().id) ?? item.id
    }),
    ...scansSnapshot.docs.map((item) => {
      const data = asObject(item.data().data) ?? {}
      return asText(data.serviceOrderCode) ?? ''
    }),
  ]
  return nextOrthTreatmentCode(existing)
}

export function listScans() {
  return [...loadDb().scans].sort((a, b) => b.scanDate.localeCompare(a.scanDate))
}

export async function listScansFirebase() {
  const snapshot = await getDocs(collection(getFirestoreDb(), 'scans'))
  return snapshot.docs
    .filter((item) => !asText(item.data().deleted_at) && !asText(asObject(item.data().data)?.deletedAt))
    .map((item) => mapScanDocument(item.id, item.data()))
    .sort((a, b) => b.scanDate.localeCompare(a.scanDate))
}

export async function listScansAsync() {
  if (DATA_MODE === 'firebase') return listScansFirebase()
  return listScans()
}

export function getScan(id: string) {
  return loadDb().scans.find((item) => item.id === id) ?? null
}

export async function getScanFirebase(id: string) {
  return readScanFromFirestore(id)
}

export async function getScanAsync(id: string) {
  if (DATA_MODE === 'firebase') return getScanFirebase(id)
  return getScan(id)
}

async function fileFromAttachment(att: ScanAttachment) {
  if (!att.isLocal || !att.url?.startsWith('blob:')) return null
  try {
    const response = await fetch(att.url)
    const blob = await response.blob()
    return new File([blob], att.name, { type: att.mime || blob.type || 'application/octet-stream' })
  } catch (error) {
    logger.warn('Não foi possível reabrir o anexo local do exame antes do envio.', {
      flow: 'scan.attachment.rehydrate',
      attachmentId: att.id,
      attachmentName: att.name,
    })
    logger.error('Erro ao reidratar o anexo local do exame.', { flow: 'scan.attachment.rehydrate' }, error)
    return null
  }
}

export async function createScan(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  const validatedScan = validateCreateScanInput(scan)
  const db = loadDb()
  const serviceOrderCode = normalizeOrthTreatmentCode(validatedScan.serviceOrderCode) || nextTreatmentCode(db)
  const attachments: ScanAttachment[] = []

  for (const att of validatedScan.attachments) {
    const localFile = await fileFromAttachment(att)
    if (localFile) {
      const uploaded = await uploadFileToStorage(localFile, {
        scope: 'scans',
        clinicId: validatedScan.clinicId,
        ownerId: validatedScan.patientId ?? validatedScan.patientName.replace(/\s+/g, '_').toLowerCase(),
      })
      if (uploaded) {
        attachments.push({
          ...att,
          url: uploaded.url,
          isLocal: false,
          status: att.status ?? 'ok',
          attachedAt: att.attachedAt ?? att.createdAt ?? nowIso(),
        })
        continue
      }
    }
    attachments.push({
      ...att,
      status: att.status ?? 'ok',
      attachedAt: att.attachedAt ?? att.createdAt ?? nowIso(),
    })
  }

  const next: Scan = {
    ...validatedScan,
    shortId: validatedScan.shortId ?? nextExamCode(),
    serviceOrderCode,
    attachments,
    id: createEntityId('scan'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  db.scans = [next, ...db.scans]
  pushAudit(db, { entity: 'scan', entityId: next.id, action: 'scan.create', message: `Exame criado para ${next.patientName}.` })
  saveDb(db)
  logger.info('Exame criado no repositório local.', {
    flow: 'scan.create',
    scanId: next.id,
    patientId: next.patientId,
    clinicId: next.clinicId,
    attachments: next.attachments.length,
  })
  return next
}

export async function createScanFirebase(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  const validatedScan = validateCreateScanInput(scan)
  const serviceOrderCode = normalizeOrthTreatmentCode(validatedScan.serviceOrderCode) || await nextTreatmentCodeFirebase()
  const now = nowIso()
  const next: Scan = {
    ...validatedScan,
    shortId: validatedScan.shortId ?? nextExamCode(),
    serviceOrderCode,
    attachments: validatedScan.attachments.map((att) => ({
      ...att,
      status: att.status ?? 'ok',
      attachedAt: att.attachedAt ?? att.createdAt ?? now,
      createdAt: att.createdAt ?? now,
    })),
    id: createEntityId('scan'),
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(getFirestoreDb(), 'scans', next.id), scanToFirestoreDocument(next))
  logger.info('Exame criado no Firestore.', {
    flow: 'scan.firebase.create',
    scanId: next.id,
    patientId: next.patientId,
    clinicId: next.clinicId,
    attachments: next.attachments.length,
  })
  return next
}

export async function createScanAsync(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  if (DATA_MODE === 'firebase') return createScanFirebase(scan)
  return createScan(scan)
}

export function updateScan(id: string, patch: Partial<Scan>) {
  const db = loadDb()
  let updated: Scan | null = null
  db.scans = db.scans.map((item) => {
    if (item.id !== id) return item
    updated = { ...item, ...patch, updatedAt: nowIso() }
    return updated
  })
  if (updated) {
    pushAudit(db, { entity: 'scan', entityId: id, action: 'scan.update', message: 'Exame atualizado.' })
  }
  saveDb(db)
  return updated
}

export async function updateScanFirebase(id: string, patch: Partial<Scan>) {
  const current = await readScanFromFirestore(id)
  if (!current) return null
  const updated: Scan = { ...current, ...patch, updatedAt: nowIso() }
  await setDoc(doc(getFirestoreDb(), 'scans', id), scanToFirestoreDocument(updated), { merge: true })
  return updated
}

export async function updateScanAsync(id: string, patch: Partial<Scan>) {
  if (DATA_MODE === 'firebase') return updateScanFirebase(id, patch)
  return updateScan(id, patch)
}

export function addScanAttachment(
  scanId: string,
  attachment: Omit<ScanAttachment, 'id' | 'createdAt' | 'status'> & { id?: string; status?: 'ok' | 'erro'; file?: File },
) {
  return addScanAttachmentAsync(scanId, attachment)
}

export async function addScanAttachmentAsync(
  scanId: string,
  attachment: Omit<ScanAttachment, 'id' | 'createdAt' | 'status'> & { id?: string; status?: 'ok' | 'erro'; file?: File },
) {
  const scan = getScan(scanId)
  if (!scan) return null
  let nextUrl = attachment.url
  let nextIsLocal = attachment.isLocal

  if (attachment.file) {
    const uploaded = await uploadFileToStorage(attachment.file, {
      scope: 'scans',
      clinicId: scan.clinicId,
      ownerId: scan.patientId ?? scan.patientName.replace(/\s+/g, '_').toLowerCase(),
    })
    if (uploaded) {
      nextUrl = uploaded.url
      nextIsLocal = false
    }
  }

  const nextAttachment: ScanAttachment = {
    ...attachment,
    id: attachment.id ?? createEntityId('scan-file'),
    url: nextUrl,
    isLocal: nextIsLocal ?? true,
    status: attachment.status ?? 'ok',
    attachedAt: attachment.attachedAt ?? nowIso(),
    createdAt: nowIso(),
  }

  return updateScan(scanId, { attachments: [...scan.attachments, nextAttachment] })
}

export async function addScanAttachmentFirebase(
  scanId: string,
  attachment: Omit<ScanAttachment, 'id' | 'createdAt' | 'status'> & { id?: string; status?: 'ok' | 'erro'; file?: File },
) {
  const scan = await readScanFromFirestore(scanId)
  if (!scan) return null
  const now = nowIso()
  const nextAttachment: ScanAttachment = {
    ...attachment,
    id: attachment.id ?? createEntityId('scan-file'),
    isLocal: attachment.isLocal ?? true,
    status: attachment.status ?? 'ok',
    attachedAt: attachment.attachedAt ?? now,
    createdAt: now,
  }
  return updateScanFirebase(scanId, { attachments: [...scan.attachments, nextAttachment] })
}

export async function addScanAttachmentAsyncByMode(
  scanId: string,
  attachment: Omit<ScanAttachment, 'id' | 'createdAt' | 'status'> & { id?: string; status?: 'ok' | 'erro'; file?: File },
) {
  if (DATA_MODE === 'firebase') return addScanAttachmentFirebase(scanId, attachment)
  return addScanAttachmentAsync(scanId, attachment)
}

export function markScanAttachmentError(scanId: string, attachmentId: string, reason: string) {
  const scan = getScan(scanId)
  if (!scan) return null
  const trimmed = reason.trim()
  if (!trimmed) return null

  const nextAttachments = scan.attachments.map((item) =>
    item.id === attachmentId
      ? { ...item, status: 'erro' as const, flaggedAt: nowIso(), flaggedReason: trimmed }
      : item,
  )
  return updateScan(scanId, { attachments: nextAttachments })
}

export async function markScanAttachmentErrorFirebase(scanId: string, attachmentId: string, reason: string) {
  const scan = await readScanFromFirestore(scanId)
  if (!scan) return null
  const trimmed = reason.trim()
  if (!trimmed) return null
  const nextAttachments = scan.attachments.map((item) =>
    item.id === attachmentId
      ? { ...item, status: 'erro' as const, flaggedAt: nowIso(), flaggedReason: trimmed }
      : item,
  )
  return updateScanFirebase(scanId, { attachments: nextAttachments })
}

export function clearScanAttachmentError(scanId: string, attachmentId: string) {
  const scan = getScan(scanId)
  if (!scan) return null

  const nextAttachments = scan.attachments.map((item) =>
    item.id === attachmentId
      ? { ...item, status: 'ok' as const }
      : item,
  )
  return updateScan(scanId, { attachments: nextAttachments })
}

export async function clearScanAttachmentErrorFirebase(scanId: string, attachmentId: string) {
  const scan = await readScanFromFirestore(scanId)
  if (!scan) return null
  const nextAttachments = scan.attachments.map((item) =>
    item.id === attachmentId
      ? { ...item, status: 'ok' as const }
      : item,
  )
  return updateScanFirebase(scanId, { attachments: nextAttachments })
}

export function approveScan(id: string) {
  return updateScan(id, { status: 'aprovado' })
}

export async function approveScanFirebase(id: string) {
  return updateScanFirebase(id, { status: 'aprovado' })
}

export function rejectScan(id: string) {
  return updateScan(id, { status: 'reprovado' })
}

export async function rejectScanFirebase(id: string) {
  return updateScanFirebase(id, { status: 'reprovado' })
}

export function linkScanToCase(scanId: string, caseId: string) {
  return updateScan(scanId, { status: 'convertido', linkedCaseId: caseId })
}

export async function linkScanToCaseFirebase(scanId: string, caseId: string) {
  return updateScanFirebase(scanId, { status: 'convertido', linkedCaseId: caseId, serviceOrderCode: caseId })
}

export function deleteScan(id: string) {
  const db = loadDb()
  const target = db.scans.find((item) => item.id === id)
  if (!target) return
  const linkedCaseIds = new Set<string>()
  db.cases.forEach((item) => {
    if (item.sourceScanId === id || item.id === target.linkedCaseId) {
      linkedCaseIds.add(item.id)
    }
  })

  if (linkedCaseIds.size > 0) {
    db.labItems = db.labItems.filter((item) => !item.caseId || !linkedCaseIds.has(item.caseId))
    db.replacementBank = db.replacementBank.filter((entry) => !linkedCaseIds.has(entry.caseId))
    db.cases = db.cases.filter((item) => !linkedCaseIds.has(item.id))
  }
  db.scans = db.scans.filter((item) => item.id !== id)
  pushAudit(
    db,
    {
      entity: 'scan',
      entityId: id,
      action: 'scan.delete',
      message:
        linkedCaseIds.size > 0
          ? `Exame removido com cascata (${linkedCaseIds.size} pedido(s), OS e reposicoes vinculadas).`
          : 'Exame removido.',
    },
  )
  if (target.patientId) {
    pushAudit(db, {
      entity: 'patient',
      entityId: target.patientId,
      action: 'patient.history.scan_delete',
      message:
        linkedCaseIds.size > 0
          ? `Exame removido com cascata completa: ${target.serviceOrderCode ?? target.id}.`
          : `Exame removido: ${target.serviceOrderCode ?? target.id}.`,
    })
  }
  saveDb(db)
}

export async function deleteScanFirebase(id: string) {
  const current = await readScanFromFirestore(id)
  if (!current) return
  const deletedAt = nowIso()
  await setDoc(
    doc(getFirestoreDb(), 'scans', id),
    {
      deleted_at: deletedAt,
      updated_at: deletedAt,
      data: { ...current, deletedAt, updatedAt: deletedAt },
    },
    { merge: true },
  )
}

export async function deleteScanAsync(id: string) {
  if (DATA_MODE === 'firebase') return deleteScanFirebase(id)
  return deleteScan(id)
}

export function createCaseFromScan(
  scanId: string,
  payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  },
): { ok: true; caseId: string } | { ok: false; error: string } {
  const repository = createLocalCaseRepository(null)
  const actor = getCurrentUser()
  const result = repository.createFromScan(validateCreateCaseFromScanInput({ scanId, ...payload }))
  if (!result.ok) {
    logger.warn('Falha ao criar caso a partir do exame no modo local.', { flow: 'cases.create_from_scan', scanId, actorId: actor?.id, reason: result.error })
    return { ok: false, error: result.error }
  }
  logger.info('Caso criado a partir do exame no modo local.', { flow: 'cases.create_from_scan', scanId, caseId: result.data.caseId, actorId: actor?.id })
  return { ok: true, caseId: result.data.caseId }
}

export async function createCaseFromScanFirebase(
  scanId: string,
  payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  },
): Promise<{ ok: true; caseId: string } | { ok: false; error: string }> {
  try {
    const input = validateCreateCaseFromScanInput({ scanId, ...payload })
    const scan = await readScanFromFirestore(scanId)
    if (!scan) return { ok: false, error: 'Exame não encontrado.' }

    const treatmentCode = normalizeOrthTreatmentCode(scan.serviceOrderCode) || await nextTreatmentCodeFirebase()
    const clinicsSnapshot = await getDocs(collection(getFirestoreDb(), 'clinics'))
    const clinicsById = new Map(
      clinicsSnapshot.docs.map((item) => {
        const data = item.data()
        return [item.id, { tradeName: asText(data.trade_name) ?? asText(data.tradeName) }]
      }),
    )
    const caseItem = buildCaseFromScanDraft({
      ...input,
      scanId: scan.id,
      scan,
      treatmentCode,
      treatmentOrigin: resolveTreatmentOriginFromClinic(scan.clinicId, clinicsById),
    })
    const enrichedCase = CaseLifecycleService.refreshCase(caseItem, [])
    await Promise.all([
      setDoc(doc(getFirestoreDb(), 'cases', enrichedCase.id), caseToFirestoreDocument(enrichedCase)),
      setDoc(
        doc(getFirestoreDb(), 'scans', scan.id),
        scanToFirestoreDocument({
          ...scan,
          status: 'convertido',
          linkedCaseId: enrichedCase.id,
          serviceOrderCode: treatmentCode,
          updatedAt: nowIso(),
        }),
        { merge: true },
      ),
    ])
    return { ok: true, caseId: enrichedCase.id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Não foi possível criar o caso.' }
  }
}

export async function createCaseFromScanAsync(
  scanId: string,
  payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  },
) {
  if (DATA_MODE === 'firebase') return createCaseFromScanFirebase(scanId, payload)
  return createCaseFromScan(scanId, payload)
}
