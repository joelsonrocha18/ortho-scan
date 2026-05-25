import { pushAudit } from '../data/audit'
import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { getSessionProfile } from '../lib/auth'
import { logger } from '../lib/logger'
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'
import { nowIsoDateTime, toIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import { validatePatientDocumentInput } from '../shared/validators'
import type { PatientDocument } from '../types/PatientDocument'
import {
  buildPatientDocPath,
  createSignedUrl,
  deleteFromStorage,
  uploadToStorage,
  validatePatientDocFile,
} from './storageRepo'
import { uploadFileToStorage } from '../lib/storageUpload'

function nowIso() {
  return nowIsoDateTime()
}

function getFirestoreDb() {
  if (!firestoreDb) throw new Error('Firebase não configurado.')
  return firestoreDb
}

function mapRemoteDoc(id: string, row: Record<string, unknown>): PatientDocument {
  const note = typeof row.note === 'string' ? row.note : undefined
  const errorNote = typeof row.error_note === 'string' ? row.error_note : undefined
  const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {}
  return {
    id,
    patientId: String(row.patient_id ?? ''),
    caseId: typeof row.case_id === 'string' ? row.case_id : undefined,
    title: String(row.title ?? 'Documento'),
    category: (String(row.category ?? 'outro') as PatientDocument['category']) ?? 'outro',
    createdAt: String(row.created_at ?? nowIso()),
    note,
    isLocal: false,
    filePath: (row.file_path as string | null) ?? undefined,
    fileName: String(row.file_name ?? row.title ?? 'arquivo'),
    mimeType: (row.mime_type as string | null) ?? undefined,
    status: ((row.status as 'ok' | 'erro' | null) ?? 'ok') as 'ok' | 'erro',
    errorNote,
    metadata: {
      trayNumber: typeof data.trayNumber === 'number' ? data.trayNumber : undefined,
      capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : undefined,
      accessCode: typeof data.accessCode === 'string' ? data.accessCode : undefined,
      sentAt: typeof data.sentAt === 'string' ? data.sentAt : undefined,
      deviceLabel: typeof data.deviceLabel === 'string' ? data.deviceLabel : undefined,
      source:
        data.source === 'patient_portal' || data.source === 'internal'
          ? data.source
          : undefined,
      uploadedByPatient: typeof data.uploadedByPatient === 'boolean' ? data.uploadedByPatient : undefined,
    },
  }
}

function localListPatientDocs(patientId: string) {
  return loadDb()
    .patientDocuments.filter((doc) => doc.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function firebaseListPatientDocs(patientId: string) {
  const snapshot = await getDocs(
    query(collection(getFirestoreDb(), 'documents'), where('patient_id', '==', patientId)),
  )
  return snapshot.docs
    .filter((item) => !item.data().deleted_at && !item.data().deletedAt)
    .map((item) => mapRemoteDoc(item.id, item.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listPatientDocs(patientId: string) {
  if (DATA_MODE === 'firebase') {
    try {
      return await firebaseListPatientDocs(patientId)
    } catch {
      return []
    }
  }
  return localListPatientDocs(patientId)
}

export async function getPatientDoc(id: string) {
  if (DATA_MODE === 'firebase') {
    const snapshot = await getDoc(doc(getFirestoreDb(), 'documents', id))
    if (!snapshot.exists()) return null
    const data = snapshot.data()
    if (data.deleted_at || data.deletedAt) return null
    return mapRemoteDoc(snapshot.id, data)
  }
  return loadDb().patientDocuments.find((item) => item.id === id) ?? null
}

export async function resolvePatientDocUrl(doc: PatientDocument) {
  if (doc.filePath) return createSignedUrl(doc.filePath, 300)
  if (doc.url) return { ok: true as const, url: doc.url }
  return { ok: false as const, error: 'Documento sem caminho de arquivo.' }
}

export async function addPatientDoc(payload: {
  patientId: string
  caseId?: string
  clinicId?: string
  title: string
  category: PatientDocument['category']
  note?: string
  createdAt?: string
  file?: File
}) {
  const validated = validatePatientDocumentInput(payload)
  if (validated.file) {
    const fileValidation = validatePatientDocFile(validated.file)
    if (!fileValidation.ok) return fileValidation
  }

  if (DATA_MODE === 'firebase') {
    const profile = getSessionProfile()
    if (!profile?.id) return { ok: false as const, error: 'Sessão inválida. Faça login novamente.' }
    const clinicId = profile.clinicId ?? validated.clinicId
    if (!clinicId) return { ok: false as const, error: 'Sessão sem clinicId e paciente sem clínica vinculada.' }

    let filePath: string | undefined
    if (validated.file) {
      filePath = buildPatientDocPath({
        clinicId,
        patientId: validated.patientId,
        fileName: validated.file.name,
      })
      const upload = await uploadToStorage(filePath, validated.file)
      if (!upload.ok) return upload
    }

    const createdAt = validated.createdAt ? toIsoDateTime(validated.createdAt) : nowIso()
    const documentId = createEntityId('doc')
    const record = {
      clinic_id: clinicId,
      clinicId,
      patient_id: validated.patientId,
      patientId: validated.patientId,
      case_id: payload.caseId ?? null,
      caseId: payload.caseId ?? null,
      category: validated.category,
      title: validated.title,
      file_path: filePath ?? null,
      filePath: filePath ?? null,
      file_name: validated.file?.name ?? validated.title,
      fileName: validated.file?.name ?? validated.title,
      mime_type: validated.file?.type ?? null,
      mimeType: validated.file?.type ?? null,
      status: 'ok',
      note: validated.note ?? null,
      data: {},
      created_by: profile.id,
      createdBy: profile.id,
      created_at: createdAt,
      createdAt,
      deleted_at: null,
      deletedAt: null,
    }
    await setDoc(doc(getFirestoreDb(), 'documents', documentId), record)
    const createdDoc = mapRemoteDoc(documentId, record)
    logger.info('Documento do paciente criado no Firestore.', {
      flow: 'documents.create',
      patientId: validated.patientId,
      documentId: createdDoc.id,
      actorId: profile.id,
    })
    return { ok: true as const, doc: createdDoc }
  }

  const db = loadDb()
  let uploadedUrl: string | undefined
  let isLocal = Boolean(validated.file)

  if (validated.file) {
    const uploaded = await uploadFileToStorage(validated.file, {
      scope: 'patient-docs',
      clinicId: validated.clinicId,
      ownerId: validated.patientId,
    })
    if (uploaded) {
      uploadedUrl = uploaded.url
      isLocal = false
    }
  }

  const localDoc: PatientDocument = {
    id: createEntityId('pat-doc'),
    patientId: validated.patientId,
    caseId: payload.caseId,
    title: validated.title,
    category: validated.category,
    createdAt: validated.createdAt ? toIsoDateTime(validated.createdAt) : nowIso(),
    note: validated.note,
    isLocal,
    url: validated.file ? (uploadedUrl ?? URL.createObjectURL(validated.file)) : undefined,
    fileName: validated.file?.name ?? validated.title,
    mimeType: validated.file?.type,
    status: 'ok',
  }

  db.patientDocuments = [localDoc, ...db.patientDocuments]
  pushAudit(db, {
    entity: 'document',
    entityId: localDoc.id,
    action: 'document.create',
    message: `Documento ${localDoc.title} registrado para o paciente ${localDoc.patientId}.`,
  })
  saveDb(db)
  logger.info('Documento do paciente criado no modo local.', {
    flow: 'documents.create',
    patientId: validated.patientId,
      documentId: localDoc.id,
  })
  return { ok: true as const, doc: localDoc }
}

export async function updatePatientDoc(id: string, patch: Partial<Pick<PatientDocument, 'title' | 'category' | 'note' | 'createdAt'>>) {
  if (DATA_MODE === 'firebase') {
    const current = await getPatientDoc(id)
    if (!current) return { ok: false as const, error: 'Documento não encontrado.' }
    const createdAt = patch.createdAt ? toIsoDateTime(patch.createdAt) : current.createdAt
    await updateDoc(doc(getFirestoreDb(), 'documents', id), {
      ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.note !== undefined ? { note: patch.note.trim() || null } : {}),
      ...(patch.createdAt !== undefined ? { created_at: createdAt, createdAt } : {}),
    })
    return { ok: true as const, doc: { ...current, ...patch, createdAt } }
  }

  const db = loadDb()
  const current = db.patientDocuments.find((doc) => doc.id === id)
  if (!current) return { ok: false as const, error: 'Documento não encontrado.' }

  const next: PatientDocument = {
    ...current,
    ...patch,
    title: patch.title !== undefined ? patch.title.trim() || current.title : current.title,
    category: patch.category ?? current.category,
    note: patch.note !== undefined ? patch.note.trim() || undefined : current.note,
    createdAt: patch.createdAt ? toIsoDateTime(patch.createdAt) : current.createdAt,
  }

  db.patientDocuments = db.patientDocuments.map((doc) => (doc.id === id ? next : doc))
  pushAudit(db, {
    entity: 'document',
    entityId: next.id,
    action: 'document.update',
    message: `Documento ${next.title} atualizado.`,
  })
  saveDb(db)
  return { ok: true as const, doc: next }
}

export async function deletePatientDoc(id: string) {
  if (DATA_MODE === 'firebase') {
    const existing = await getPatientDoc(id)
    if (!existing) return { ok: false as const, error: 'Documento não encontrado.' }
    const deletedAt = nowIso()
    await updateDoc(doc(getFirestoreDb(), 'documents', id), { deleted_at: deletedAt, deletedAt })
    if (existing.filePath) {
      await deleteFromStorage(existing.filePath)
    }
    logger.info('Documento do paciente removido no Firestore.', {
      flow: 'documents.delete',
      documentId: id,
      patientId: existing.patientId,
    })
    return { ok: true as const }
  }

  const db = loadDb()
  const current = db.patientDocuments.find((doc) => doc.id === id)
  if (!current) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.filter((doc) => doc.id !== id)
  pushAudit(db, {
    entity: 'document',
    entityId: id,
    action: 'document.delete',
    message: `Documento ${current.title} removido.`,
  })
  saveDb(db)
  return { ok: true as const }
}

export async function markPatientDocAsError(id: string, errorNote: string) {
  const trimmed = errorNote.trim()
  if (!trimmed) return { ok: false as const, error: 'Informe o motivo da falha do documento.' }

  if (DATA_MODE === 'firebase') {
    await updateDoc(doc(getFirestoreDb(), 'documents', id), { status: 'erro', error_note: trimmed, errorNote: trimmed })
    return { ok: true as const }
  }

  const db = loadDb()
  const target = db.patientDocuments.find((doc) => doc.id === id)
  if (!target) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.map((doc) =>
    doc.id === id ? { ...doc, status: 'erro', errorNote: trimmed } : doc,
  )
  pushAudit(db, {
    entity: 'document',
    entityId: id,
    action: 'document.mark_error',
    message: `Documento ${target.title} marcado com erro.`,
  })
  saveDb(db)
  return { ok: true as const }
}

export async function restoreDocStatus(id: string) {
  if (DATA_MODE === 'firebase') {
    await updateDoc(doc(getFirestoreDb(), 'documents', id), { status: 'ok', error_note: null, errorNote: null })
    return { ok: true as const }
  }

  const db = loadDb()
  const target = db.patientDocuments.find((doc) => doc.id === id)
  if (!target) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.map((doc) =>
    doc.id === id ? { ...doc, status: 'ok', errorNote: undefined } : doc,
  )
  pushAudit(db, {
    entity: 'document',
    entityId: id,
    action: 'document.restore',
    message: `Documento ${target.title} restaurado para OK.`,
  })
  saveDb(db)
  return { ok: true as const }
}
