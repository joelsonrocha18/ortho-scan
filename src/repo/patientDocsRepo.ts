import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { getSessionProfile } from '../lib/auth'
import { supabase } from '../lib/supabaseClient'
import type { PatientDocument } from '../types/PatientDocument'
import { buildPatientDocPath, createSignedUrl, deleteFromStorage, uploadToStorage } from './storageRepo'
import { uploadFileToStorage } from '../lib/storageUpload'

function nowIso() {
  return new Date().toISOString()
}

function mapSupabaseDoc(row: Record<string, unknown>): PatientDocument {
  const note = typeof row.note === 'string' ? row.note : undefined
  const errorNote = typeof row.error_note === 'string' ? row.error_note : undefined
  return {
    id: String(row.id ?? ''),
    patientId: String(row.patient_id ?? ''),
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
  }
}

function localListPatientDocs(patientId: string) {
  return loadDb()
    .patientDocuments.filter((doc) => doc.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function supabaseListPatientDocs(patientId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('documents')
    .select('id, patient_id, category, title, file_path, file_name, mime_type, status, note, error_note, created_at')
    .eq('patient_id', patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []).map((row) => mapSupabaseDoc(row as Record<string, unknown>))
}

export async function listPatientDocs(patientId: string) {
  if (DATA_MODE === 'supabase') return supabaseListPatientDocs(patientId)
  return localListPatientDocs(patientId)
}

export async function getPatientDoc(id: string) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return null
    const { data, error } = await supabase
      .from('documents')
      .select('id, patient_id, category, title, file_path, file_name, mime_type, status, note, error_note, created_at')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    return mapSupabaseDoc(data as Record<string, unknown>)
  }
  return loadDb().patientDocuments.find((doc) => doc.id === id) ?? null
}

export async function resolvePatientDocUrl(doc: PatientDocument) {
  if (doc.filePath) return createSignedUrl(doc.filePath, 300)
  if (doc.url) return { ok: true as const, url: doc.url }
  return { ok: false as const, error: 'Documento sem caminho de arquivo.' }
}
export async function addPatientDoc(payload: {
  patientId: string
  clinicId?: string
  title: string
  category: PatientDocument['category']
  note?: string
  createdAt?: string
  file?: File
}) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const profile = getSessionProfile()
    if (!profile?.id) return { ok: false as const, error: 'Sessao invalida. Faca login novamente.' }
    const clinicId = profile?.clinicId ?? payload.clinicId
    if (!clinicId) return { ok: false as const, error: 'Sessao sem clinicId e paciente sem clinica vinculada.' }

    let filePath: string | undefined
    if (payload.file) {
      filePath = buildPatientDocPath({
        clinicId,
        patientId: payload.patientId,
        fileName: payload.file.name,
      })
      const upload = await uploadToStorage(filePath, payload.file)
      if (!upload.ok) return upload
    }

    const { data, error } = await supabase
      .from('documents')
      .insert({
        clinic_id: clinicId,
        patient_id: payload.patientId,
        category: payload.category,
        title: payload.title.trim() || 'Documento',
        file_path: filePath ?? null,
        file_name: payload.file?.name ?? (payload.title.trim() || 'arquivo'),
        mime_type: payload.file?.type ?? null,
        status: 'ok',
        note: payload.note?.trim() || null,
        created_by: profile.id,
        created_at: payload.createdAt ? new Date(payload.createdAt).toISOString() : nowIso(),
      })
      .select('id, patient_id, category, title, file_path, file_name, mime_type, status, note, error_note, created_at')
      .single()
    if (error || !data) return { ok: false as const, error: error?.message ?? 'Falha ao criar documento.' }
    return { ok: true as const, doc: mapSupabaseDoc(data as Record<string, unknown>) }
  }

  const db = loadDb()
  let uploadedUrl: string | undefined
  let isLocal = Boolean(payload.file)

  if (payload.file) {
    const uploaded = await uploadFileToStorage(payload.file, {
      scope: 'patient-docs',
      clinicId: payload.clinicId,
      ownerId: payload.patientId,
    })
    if (uploaded) {
      uploadedUrl = uploaded.url
      isLocal = false
    }
  }

  const doc: PatientDocument = {
    id: `pat_doc_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    patientId: payload.patientId,
    title: payload.title.trim() || 'Documento',
    category: payload.category,
    createdAt: payload.createdAt ? new Date(payload.createdAt).toISOString() : nowIso(),
    note: payload.note?.trim() || undefined,
    isLocal,
    url: payload.file ? (uploadedUrl ?? URL.createObjectURL(payload.file)) : undefined,
    fileName: payload.file?.name ?? (payload.title.trim() || 'arquivo'),
    mimeType: payload.file?.type,
    status: 'ok',
  }

  db.patientDocuments = [doc, ...db.patientDocuments]
  saveDb(db)
  return { ok: true as const, doc }
}

export async function updatePatientDoc(id: string, patch: Partial<Pick<PatientDocument, 'title' | 'category' | 'note' | 'createdAt'>>) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { data, error } = await supabase
      .from('documents')
      .update({
        title: patch.title,
        category: patch.category,
        note: patch.note,
        created_at: patch.createdAt ? new Date(patch.createdAt).toISOString() : undefined,
      })
      .eq('id', id)
      .select('id, patient_id, category, title, file_path, file_name, mime_type, status, note, error_note, created_at')
      .single()
    if (error || !data) return { ok: false as const, error: error?.message ?? 'Documento não encontrado.' }
    return { ok: true as const, doc: mapSupabaseDoc(data as Record<string, unknown>) }
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
    createdAt: patch.createdAt ? new Date(patch.createdAt).toISOString() : current.createdAt,
  }

  db.patientDocuments = db.patientDocuments.map((doc) => (doc.id === id ? next : doc))
  saveDb(db)
  return { ok: true as const, doc: next }
}

export async function deletePatientDoc(id: string) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const existing = await getPatientDoc(id)
    if (!existing) return { ok: false as const, error: 'Documento não encontrado.' }
    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: nowIso() })
      .eq('id', id)
    if (error) return { ok: false as const, error: error.message }
    if (existing.filePath) {
      await deleteFromStorage(existing.filePath)
    }
    return { ok: true as const }
  }

  const db = loadDb()
  const current = db.patientDocuments.find((doc) => doc.id === id)
  if (!current) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.filter((doc) => doc.id !== id)
  saveDb(db)
  return { ok: true as const }
}

export async function markPatientDocAsError(id: string, errorNote: string) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { error } = await supabase
      .from('documents')
      .update({ status: 'erro', error_note: errorNote.trim() })
      .eq('id', id)
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  }

  const db = loadDb()
  const target = db.patientDocuments.find((doc) => doc.id === id)
  if (!target) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.map((doc) =>
    doc.id === id ? { ...doc, status: 'erro', errorNote: errorNote.trim() } : doc,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function restoreDocStatus(id: string) {
  if (DATA_MODE === 'supabase') {
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { error } = await supabase
      .from('documents')
      .update({ status: 'ok', error_note: null })
      .eq('id', id)
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  }

  const db = loadDb()
  const target = db.patientDocuments.find((doc) => doc.id === id)
  if (!target) return { ok: false as const, error: 'Documento não encontrado.' }

  db.patientDocuments = db.patientDocuments.map((doc) =>
    doc.id === id ? { ...doc, status: 'ok', errorNote: undefined } : doc,
  )
  saveDb(db)
  return { ok: true as const }
}

