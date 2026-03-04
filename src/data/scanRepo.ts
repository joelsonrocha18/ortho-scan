import { loadDb, saveDb } from './db'
import { pushAudit } from './audit'
import type { Case, CaseTray } from '../types/Case'
import type { Scan, ScanAttachment } from '../types/Scan'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import { uploadFileToStorage } from '../lib/storageUpload'
import { nextOrthTreatmentCode, normalizeOrthTreatmentCode } from '../lib/treatmentCode'

function nowIso() {
  return new Date().toISOString()
}

function nextExamCode() {
  const stamp = Date.now().toString().slice(-6)
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `EXM-${stamp}${rand}`
}

function buildPendingTrays(totalTrays: number, scanDate: string, changeEveryDays: number) {
  const trays: CaseTray[] = []
  const base = new Date(`${scanDate}T00:00:00`)
  for (let tray = 1; tray <= totalTrays; tray += 1) {
    const due = new Date(base)
    due.setDate(due.getDate() + changeEveryDays * tray)
    trays.push({ trayNumber: tray, state: 'pendente', dueDate: due.toISOString().slice(0, 10) })
  }
  return trays
}

function isInternalClinic(db: ReturnType<typeof loadDb>, clinicId?: string) {
  if (!clinicId) return false
  const clinic = db.clinics.find((item) => item.id === clinicId)
  if (!clinic) return false
  return clinic.id === 'clinic_arrimo' || clinic.tradeName.trim().toUpperCase() === 'ARRIMO'
}

function nextTreatmentCode(db: ReturnType<typeof loadDb>) {
  const existing = [
    ...db.cases.map((item) => item.treatmentCode ?? ''),
    ...db.scans.map((item) => item.serviceOrderCode ?? ''),
  ]
  return nextOrthTreatmentCode(existing)
}

export function listScans() {
  return [...loadDb().scans].sort((a, b) => b.scanDate.localeCompare(a.scanDate))
}

export function getScan(id: string) {
  return loadDb().scans.find((item) => item.id === id) ?? null
}

async function fileFromAttachment(att: ScanAttachment) {
  if (!att.isLocal || !att.url?.startsWith('blob:')) return null
  try {
    const response = await fetch(att.url)
    const blob = await response.blob()
    return new File([blob], att.name, { type: att.mime || blob.type || 'application/octet-stream' })
  } catch {
    return null
  }
}

export async function createScan(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = loadDb()
  const serviceOrderCode = normalizeOrthTreatmentCode(scan.serviceOrderCode) || nextTreatmentCode(db)
  const attachments: ScanAttachment[] = []

  for (const att of scan.attachments) {
    const localFile = await fileFromAttachment(att)
    if (localFile) {
      const uploaded = await uploadFileToStorage(localFile, {
        scope: 'scans',
        clinicId: scan.clinicId,
        ownerId: scan.patientId ?? scan.patientName.replace(/\s+/g, '_').toLowerCase(),
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
    ...scan,
    shortId: scan.shortId ?? nextExamCode(),
    serviceOrderCode,
    attachments,
    id: `scan_${Date.now()}`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  db.scans = [next, ...db.scans]
  pushAudit(db, { entity: 'scan', entityId: next.id, action: 'scan.create', message: `Exame criado para ${next.patientName}.` })
  saveDb(db)
  return next
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
    id: attachment.id ?? `scan_file_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    url: nextUrl,
    isLocal: nextIsLocal ?? true,
    status: attachment.status ?? 'ok',
    attachedAt: attachment.attachedAt ?? nowIso(),
    createdAt: nowIso(),
  }

  return updateScan(scanId, { attachments: [...scan.attachments, nextAttachment] })
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

export function approveScan(id: string) {
  return updateScan(id, { status: 'aprovado' })
}

export function rejectScan(id: string) {
  return updateScan(id, { status: 'reprovado' })
}

export function linkScanToCase(scanId: string, caseId: string) {
  return updateScan(scanId, { status: 'convertido', linkedCaseId: caseId })
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
  const db = loadDb()
  const scan = db.scans.find((item) => item.id === scanId)
  if (!scan) return { ok: false, error: 'Scan nao encontrado.' }
  if (scan.status !== 'aprovado') return { ok: false, error: 'Apenas scans aprovados podem gerar caso.' }
  if (scan.linkedCaseId) return { ok: false, error: 'Este scan ja foi convertido em caso.' }
  const selectedProductType = normalizeProductType(scan.purposeProductType, 'alinhador_12m')
  const isAlignerFlow = isAlignerProductType(selectedProductType)
  const upper = payload.totalTraysUpper ?? 0
  const lower = payload.totalTraysLower ?? 0
  const normalizedUpper = isAlignerFlow ? (scan.arch === 'inferior' ? 0 : upper) : 0
  const normalizedLower = isAlignerFlow ? (scan.arch === 'superior' ? 0 : lower) : 0
  const fallback = Math.max(normalizedUpper, normalizedLower)
  if (isAlignerFlow && fallback <= 0) return { ok: false, error: 'Informe total de placas superior e/ou inferior.' }

  const internal = isInternalClinic(db, scan.clinicId)
  const treatmentCode = normalizeOrthTreatmentCode(scan.serviceOrderCode) || nextTreatmentCode(db)
  const caseId = treatmentCode
  if (db.cases.some((item) => item.id === caseId)) {
    return { ok: false, error: `Ja existe um caso com o codigo ${caseId}.` }
  }
  const scanFiles = scan.attachments.map((att: ScanAttachment) => ({
    id: att.id,
    name: att.name,
    kind: att.kind,
    slotId: att.slotId,
    rxType: att.rxType,
    arch: att.arch,
    isLocal: att.isLocal,
    url: att.url,
    filePath: att.filePath,
    status: att.status ?? 'ok',
    attachedAt: att.attachedAt ?? att.createdAt,
    note: att.note,
    flaggedAt: att.flaggedAt,
    flaggedReason: att.flaggedReason,
    createdAt: att.createdAt,
  }))

  const newCase: Case = {
    id: caseId,
    productType: selectedProductType,
    productId: selectedProductType,
    treatmentCode,
    treatmentOrigin: internal ? 'interno' : 'externo',
    patientName: scan.patientName,
    patientId: scan.patientId,
    dentistId: scan.dentistId,
    requestedByDentistId: scan.requestedByDentistId,
    clinicId: scan.clinicId,
    scanDate: scan.scanDate,
    totalTrays: isAlignerFlow ? fallback : 0,
    totalTraysUpper: normalizedUpper || undefined,
    totalTraysLower: normalizedLower || undefined,
    changeEveryDays: isAlignerFlow ? payload.changeEveryDays : 0,
    attachmentBondingTray: isAlignerFlow ? payload.attachmentBondingTray : false,
    status: 'planejamento',
    phase: 'planejamento',
    budget: undefined,
    contract: { status: 'pendente' },
    deliveryLots: [],
    installation: undefined,
    trays: isAlignerFlow ? buildPendingTrays(fallback, scan.scanDate, payload.changeEveryDays) : [],
    attachments: [],
    sourceScanId: scan.id,
    sourceExamCode: scan.shortId,
    arch: scan.arch,
    complaint: scan.complaint,
    dentistGuidance: scan.dentistGuidance,
    scanFiles,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  db.cases = [newCase, ...db.cases]
  db.scans = db.scans.map((item) =>
    item.id === scan.id
      ? { ...item, status: 'convertido', linkedCaseId: caseId, serviceOrderCode: treatmentCode, updatedAt: nowIso() }
      : item,
  )
  pushAudit(db, {
    entity: 'case',
    entityId: newCase.id,
    action: 'case.create_from_scan',
    message: `Caso ${newCase.treatmentCode ?? newCase.id} criado a partir do scan ${scan.id}.`,
  })
  saveDb(db)
  return { ok: true, caseId }
}
