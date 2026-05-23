import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { db as firestoreDb } from '../lib/firebaseClient'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import { normalizeText } from '../shared/validators'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { Clinic } from '../types/Clinic'

type ClinicPayload = Omit<Clinic, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
type ClinicDocument = Record<string, unknown>
type ClinicMutationResult = { ok: true; clinic: Clinic } | { ok: false; error: string }
type ClinicVoidResult = { ok: true } | { ok: false; error: string }

function matchesQuery(value: string | undefined, query: string) {
  if (!value) return false
  return value.toLowerCase().includes(query)
}

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asBoolean(value: unknown, fallback = true) {
  return typeof value === 'boolean' ? value : fallback
}

function mapClinicDocument(id: string, data: ClinicDocument): Clinic {
  const now = nowIsoDateTime()
  return {
    id: asText(data.id) ?? id,
    shortId: asText(data.shortId) ?? asText(data.short_id),
    tradeName: asText(data.tradeName) ?? asText(data.trade_name) ?? asText(data.name) ?? 'Clinica sem nome',
    legalName: asText(data.legalName) ?? asText(data.legal_name),
    cnpj: asText(data.cnpj),
    phone: asText(data.phone),
    whatsapp: asText(data.whatsapp),
    email: asText(data.email),
    address: asObject(data.address) as Clinic['address'],
    notes: asText(data.notes),
    isActive: asBoolean(data.isActive, asBoolean(data.is_active, true)),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    deletedAt: asText(data.deletedAt) ?? asText(data.deleted_at),
  }
}

function clinicToFirestoreDocument(clinic: Clinic): ClinicDocument {
  return {
    id: clinic.id,
    short_id: clinic.shortId ?? null,
    trade_name: clinic.tradeName,
    legal_name: clinic.legalName ?? null,
    cnpj: clinic.cnpj ?? null,
    phone: clinic.phone ?? null,
    whatsapp: clinic.whatsapp ?? null,
    email: clinic.email ?? null,
    address: clinic.address ?? null,
    notes: clinic.notes ?? null,
    is_active: clinic.isActive,
    created_at: clinic.createdAt,
    updated_at: clinic.updatedAt,
    deleted_at: clinic.deletedAt ?? null,
  }
}

async function readClinicFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'clinics', id))
  if (!snapshot.exists()) return null
  return mapClinicDocument(snapshot.id, snapshot.data())
}

function validateClinicPayload(payload: Pick<Clinic, 'tradeName' | 'cnpj'>): string | null {
  if (!payload.tradeName.trim()) return 'Nome fantasia é obrigatório.'
  if (payload.cnpj && !isValidCnpj(payload.cnpj)) return 'CNPJ inválido.'
  return null
}

export function listClinics(options?: { query?: string; includeDeleted?: boolean }) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const includeDeleted = options?.includeDeleted ?? false
  return loadDb()
    .clinics.filter((clinic) => (includeDeleted ? true : !clinic.deletedAt))
    .filter((clinic) => {
      if (!query) return true
      return (
        matchesQuery(clinic.tradeName, query) ||
        matchesQuery(clinic.legalName, query) ||
        matchesQuery(clinic.cnpj, query) ||
        matchesQuery(clinic.phone, query)
      )
    })
    .sort((a, b) => a.tradeName.localeCompare(b.tradeName))
}

export async function listClinicsFirebase(options?: { query?: string; includeDeleted?: boolean }) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const includeDeleted = options?.includeDeleted ?? false
  const snapshot = await getDocs(collection(getFirestoreDb(), 'clinics'))
  return snapshot.docs
    .map((item) => mapClinicDocument(item.id, item.data()))
    .filter((clinic) => (includeDeleted ? true : !clinic.deletedAt))
    .filter((clinic) => {
      if (!query) return true
      return (
        matchesQuery(clinic.tradeName, query) ||
        matchesQuery(clinic.legalName, query) ||
        matchesQuery(clinic.cnpj, query) ||
        matchesQuery(clinic.phone, query) ||
        matchesQuery(clinic.whatsapp, query)
      )
    })
    .sort((a, b) => a.tradeName.localeCompare(b.tradeName))
}

export async function listClinicsAsync(options?: { query?: string; includeDeleted?: boolean }) {
  if (DATA_MODE === 'firebase') return listClinicsFirebase(options)
  return listClinics(options)
}

export function getClinic(id: string) {
  return loadDb().clinics.find((clinic) => clinic.id === id) ?? null
}

export async function getClinicFirebase(id: string) {
  return readClinicFromFirestore(id)
}

export async function getClinicAsync(id: string) {
  if (DATA_MODE === 'firebase') return getClinicFirebase(id)
  return getClinic(id)
}

export function createClinic(payload: ClinicPayload) {
  const db = loadDb()
  const tradeName = payload.tradeName.trim()
  const validationError = validateClinicPayload({ tradeName, cnpj: payload.cnpj })
  if (validationError) return { ok: false as const, error: validationError }

  const now = nowIsoDateTime()
  const clinic: Clinic = {
    id: createEntityId('clinic'),
    tradeName,
    legalName: normalizeText(payload.legalName),
    cnpj: payload.cnpj ? formatCnpj(payload.cnpj) : undefined,
    phone: normalizeText(payload.phone),
    whatsapp: normalizeText(payload.whatsapp),
    email: normalizeText(payload.email),
    address: payload.address,
    notes: normalizeText(payload.notes),
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  }

  db.clinics = [clinic, ...db.clinics]
  saveDb(db)
  return { ok: true as const, clinic }
}

export async function createClinicFirebase(payload: ClinicPayload): Promise<ClinicMutationResult> {
  const tradeName = payload.tradeName.trim()
  const validationError = validateClinicPayload({ tradeName, cnpj: payload.cnpj })
  if (validationError) return { ok: false, error: validationError }

  const now = nowIsoDateTime()
  const clinic: Clinic = {
    id: createEntityId('clinic'),
    tradeName,
    legalName: normalizeText(payload.legalName),
    cnpj: payload.cnpj ? formatCnpj(payload.cnpj) : undefined,
    phone: normalizeText(payload.phone),
    whatsapp: normalizeText(payload.whatsapp),
    email: normalizeText(payload.email),
    address: payload.address,
    notes: normalizeText(payload.notes),
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(getFirestoreDb(), 'clinics', clinic.id), clinicToFirestoreDocument(clinic))
  return { ok: true, clinic }
}

export async function createClinicAsync(payload: ClinicPayload): Promise<ClinicMutationResult> {
  if (DATA_MODE === 'firebase') return createClinicFirebase(payload)
  return createClinic(payload)
}

export function updateClinic(id: string, patch: Partial<Clinic>) {
  const db = loadDb()
  const current = db.clinics.find((clinic) => clinic.id === id)
  if (!current) return { ok: false as const, error: 'Clínica não encontrada.' }
  if (patch.cnpj && !isValidCnpj(patch.cnpj)) return { ok: false as const, error: 'CNPJ inválido.' }

  const next: Clinic = {
    ...current,
    ...patch,
    tradeName: patch.tradeName ? patch.tradeName.trim() : current.tradeName,
    legalName: patch.legalName !== undefined ? normalizeText(patch.legalName) : current.legalName,
    cnpj: patch.cnpj ? formatCnpj(patch.cnpj) : patch.cnpj === '' ? undefined : current.cnpj,
    phone: patch.phone !== undefined ? normalizeText(patch.phone) : current.phone,
    whatsapp: patch.whatsapp !== undefined ? normalizeText(patch.whatsapp) : current.whatsapp,
    email: patch.email !== undefined ? normalizeText(patch.email) : current.email,
    notes: patch.notes !== undefined ? normalizeText(patch.notes) : current.notes,
    updatedAt: nowIsoDateTime(),
  }

  db.clinics = db.clinics.map((clinic) => (clinic.id === id ? next : clinic))
  saveDb(db)
  return { ok: true as const, clinic: next }
}

export async function updateClinicFirebase(id: string, patch: Partial<Clinic>): Promise<ClinicMutationResult> {
  const current = await readClinicFromFirestore(id)
  if (!current) return { ok: false, error: 'Clínica não encontrada.' }
  if (patch.cnpj && !isValidCnpj(patch.cnpj)) return { ok: false, error: 'CNPJ inválido.' }

  const next: Clinic = {
    ...current,
    ...patch,
    tradeName: patch.tradeName ? patch.tradeName.trim() : current.tradeName,
    legalName: patch.legalName !== undefined ? normalizeText(patch.legalName) : current.legalName,
    cnpj: patch.cnpj ? formatCnpj(patch.cnpj) : patch.cnpj === '' ? undefined : current.cnpj,
    phone: patch.phone !== undefined ? normalizeText(patch.phone) : current.phone,
    whatsapp: patch.whatsapp !== undefined ? normalizeText(patch.whatsapp) : current.whatsapp,
    email: patch.email !== undefined ? normalizeText(patch.email) : current.email,
    notes: patch.notes !== undefined ? normalizeText(patch.notes) : current.notes,
    updatedAt: nowIsoDateTime(),
  }

  await setDoc(doc(getFirestoreDb(), 'clinics', id), clinicToFirestoreDocument(next), { merge: true })
  return { ok: true, clinic: next }
}

export async function updateClinicAsync(id: string, patch: Partial<Clinic>): Promise<ClinicMutationResult> {
  if (DATA_MODE === 'firebase') return updateClinicFirebase(id, patch)
  return updateClinic(id, patch)
}

export function softDeleteClinic(id: string) {
  const db = loadDb()
  const current = db.clinics.find((clinic) => clinic.id === id)
  if (!current) return { ok: false as const, error: 'Clínica não encontrada.' }
  db.clinics = db.clinics.map((clinic) =>
    clinic.id === id ? { ...clinic, deletedAt: nowIsoDateTime(), isActive: false, updatedAt: nowIsoDateTime() } : clinic,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function softDeleteClinicFirebase(id: string): Promise<ClinicVoidResult> {
  const current = await readClinicFromFirestore(id)
  if (!current) return { ok: false, error: 'Clínica não encontrada.' }
  await setDoc(
    doc(getFirestoreDb(), 'clinics', id),
    clinicToFirestoreDocument({ ...current, deletedAt: nowIsoDateTime(), isActive: false, updatedAt: nowIsoDateTime() }),
    { merge: true },
  )
  return { ok: true }
}

export async function softDeleteClinicAsync(id: string): Promise<ClinicVoidResult> {
  if (DATA_MODE === 'firebase') return softDeleteClinicFirebase(id)
  return softDeleteClinic(id)
}

export function restoreClinic(id: string) {
  const db = loadDb()
  const current = db.clinics.find((clinic) => clinic.id === id)
  if (!current) return { ok: false as const, error: 'Clínica não encontrada.' }
  db.clinics = db.clinics.map((clinic) =>
    clinic.id === id ? { ...clinic, deletedAt: undefined, isActive: true, updatedAt: nowIsoDateTime() } : clinic,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function restoreClinicFirebase(id: string): Promise<ClinicVoidResult> {
  const current = await readClinicFromFirestore(id)
  if (!current) return { ok: false, error: 'Clínica não encontrada.' }
  await setDoc(
    doc(getFirestoreDb(), 'clinics', id),
    clinicToFirestoreDocument({ ...current, deletedAt: undefined, isActive: true, updatedAt: nowIsoDateTime() }),
    { merge: true },
  )
  return { ok: true }
}

export async function restoreClinicAsync(id: string): Promise<ClinicVoidResult> {
  if (DATA_MODE === 'firebase') return restoreClinicFirebase(id)
  return restoreClinic(id)
}
