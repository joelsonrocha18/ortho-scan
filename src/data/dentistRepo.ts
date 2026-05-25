import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { DATA_MODE } from './dataMode'
import { loadDb, saveDb } from './db'
import { db as firestoreDb } from '../lib/firebaseClient'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import type { DentistClinic } from '../types/DentistClinic'
import { createInviteFirebase } from '../repo/inviteRepo'

type DentistPayload = Omit<DentistClinic, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
type DentistDocument = Record<string, unknown>
type DentistMutationResult = { ok: true; dentist: DentistClinic } | { ok: false; error: string }
type DentistVoidResult = { ok: true } | { ok: false; error: string }

function nowIso() {
  return new Date().toISOString()
}

function normalizeText(value?: string) {
  return value?.trim() || undefined
}

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
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asBoolean(value: unknown, fallback = true) {
  return typeof value === 'boolean' ? value : fallback
}

function asGender(value: unknown): DentistClinic['gender'] {
  if (value === 'feminino' || value === 'masculino') return value
  return undefined
}

function asDentistType(value: unknown): DentistClinic['type'] {
  return value === 'clinica' ? 'clinica' : 'dentista'
}

function mapDentistDocument(id: string, data: DentistDocument): DentistClinic {
  const now = nowIso()
  const firstName = asText(data.firstName) ?? asText(data.first_name)
  const lastName = asText(data.lastName) ?? asText(data.last_name)
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return {
    id: asText(data.id) ?? id,
    shortId: asText(data.shortId) ?? asText(data.short_id),
    name: asText(data.name) ?? (fallbackName || 'Dentista sem nome'),
    firstName,
    lastName,
    type: asDentistType(data.type),
    cnpj: asText(data.cnpj),
    cro: asText(data.cro),
    gender: asGender(data.gender) ?? 'masculino',
    cpf: asText(data.cpf),
    birthDate: asText(data.birthDate) ?? asText(data.birth_date),
    clinicId: asText(data.clinicId) ?? asText(data.clinic_id),
    phone: asText(data.phone),
    whatsapp: asText(data.whatsapp),
    email: asText(data.email),
    address: asObject(data.address) as DentistClinic['address'],
    notes: asText(data.notes),
    isActive: asBoolean(data.isActive, asBoolean(data.is_active, true)),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    deletedAt: asText(data.deletedAt) ?? asText(data.deleted_at),
  }
}

function dentistToFirestoreDocument(dentist: DentistClinic): DentistDocument {
  return {
    id: dentist.id,
    short_id: dentist.shortId ?? null,
    name: dentist.name,
    first_name: dentist.firstName ?? null,
    last_name: dentist.lastName ?? null,
    type: dentist.type,
    cnpj: dentist.cnpj ?? null,
    cro: dentist.cro ?? null,
    gender: dentist.gender ?? null,
    cpf: dentist.cpf ?? null,
    birth_date: dentist.birthDate ?? null,
    clinic_id: dentist.clinicId ?? null,
    phone: dentist.phone ?? null,
    whatsapp: dentist.whatsapp ?? null,
    email: dentist.email ?? null,
    address: dentist.address ?? null,
    notes: dentist.notes ?? null,
    is_active: dentist.isActive,
    created_at: dentist.createdAt,
    updated_at: dentist.updatedAt,
    deleted_at: dentist.deletedAt ?? null,
  }
}

async function readDentistFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'dentists', id))
  if (!snapshot.exists()) return null
  return mapDentistDocument(snapshot.id, snapshot.data())
}

function validateDentistPayload(payload: Pick<DentistClinic, 'name' | 'type' | 'cnpj'>) {
  const name = payload.name.trim()
  if (!name) return 'Nome é obrigatório.'
  const cnpj = normalizeText(payload.cnpj)
  if (payload.type === 'clinica') {
    if (!cnpj) return 'CNPJ é obrigatório para clínica.'
    if (!isValidCnpj(cnpj)) return 'CNPJ inválido.'
  }
  return null
}

export function listDentists(options?: {
  query?: string
  includeDeleted?: boolean
  includeInactive?: boolean
}) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const { includeDeleted = false, includeInactive = true } = options ?? {}
  return loadDb()
    .dentists.filter((item) => (includeDeleted ? true : !item.deletedAt))
    .filter((item) => (includeInactive ? true : item.isActive))
    .filter((item) => {
      if (!query) return true
      return (
        matchesQuery(item.name, query) ||
        matchesQuery(item.cnpj, query) ||
        matchesQuery(item.cro, query) ||
        matchesQuery(item.phone, query) ||
        matchesQuery(item.whatsapp, query) ||
        matchesQuery(item.email, query)
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listDentistsFirebase(options?: {
  query?: string
  includeDeleted?: boolean
  includeInactive?: boolean
}) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const { includeDeleted = false, includeInactive = true } = options ?? {}
  const snapshot = await getDocs(collection(getFirestoreDb(), 'dentists'))
  return snapshot.docs
    .map((item) => mapDentistDocument(item.id, item.data()))
    .filter((item) => (includeDeleted ? true : !item.deletedAt))
    .filter((item) => (includeInactive ? true : item.isActive))
    .filter((item) => {
      if (!query) return true
      return (
        matchesQuery(item.name, query) ||
        matchesQuery(item.cnpj, query) ||
        matchesQuery(item.cro, query) ||
        matchesQuery(item.phone, query) ||
        matchesQuery(item.whatsapp, query) ||
        matchesQuery(item.email, query)
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listDentistsAsync(options?: {
  query?: string
  includeDeleted?: boolean
  includeInactive?: boolean
}) {
  if (DATA_MODE === 'firebase') return listDentistsFirebase(options)
  return listDentists(options)
}

export function getDentist(id: string) {
  return loadDb().dentists.find((item) => item.id === id) ?? null
}

export async function getDentistFirebase(id: string) {
  return readDentistFromFirestore(id)
}

export async function getDentistAsync(id: string) {
  if (DATA_MODE === 'firebase') return getDentistFirebase(id)
  return getDentist(id)
}

export function createDentist(payload: DentistPayload) {
  const db = loadDb()
  const name = payload.name.trim()
  const validationError = validateDentistPayload({ name, type: payload.type, cnpj: payload.cnpj })
  if (validationError) return { ok: false as const, error: validationError }

  const cnpj = normalizeText(payload.cnpj)
  const now = nowIso()
  const next: DentistClinic = {
    id: `dent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name,
    firstName: normalizeText(payload.firstName),
    lastName: normalizeText(payload.lastName),
    type: payload.type,
    cnpj: cnpj ? formatCnpj(cnpj) : undefined,
    cro: normalizeText(payload.cro),
    gender: payload.gender ?? 'masculino',
    cpf: normalizeText(payload.cpf),
    birthDate: normalizeText(payload.birthDate),
    clinicId: payload.clinicId,
    phone: normalizeText(payload.phone),
    whatsapp: normalizeText(payload.whatsapp),
    email: normalizeText(payload.email),
    address: payload.address,
    notes: normalizeText(payload.notes),
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  }

  db.dentists = [next, ...db.dentists]
  saveDb(db)
  return { ok: true as const, dentist: next }
}

export async function createDentistFirebase(payload: DentistPayload): Promise<DentistMutationResult> {
  const name = payload.name.trim()
  const validationError = validateDentistPayload({ name, type: payload.type, cnpj: payload.cnpj })
  if (validationError) return { ok: false, error: validationError }

  const cnpj = normalizeText(payload.cnpj)
  const now = nowIso()
  const next: DentistClinic = {
    id: `dent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name,
    firstName: normalizeText(payload.firstName),
    lastName: normalizeText(payload.lastName),
    type: payload.type,
    cnpj: cnpj ? formatCnpj(cnpj) : undefined,
    cro: normalizeText(payload.cro),
    gender: payload.gender ?? 'masculino',
    cpf: normalizeText(payload.cpf),
    birthDate: normalizeText(payload.birthDate),
    clinicId: payload.clinicId,
    phone: normalizeText(payload.phone),
    whatsapp: normalizeText(payload.whatsapp),
    email: normalizeText(payload.email),
    address: payload.address,
    notes: normalizeText(payload.notes),
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  }

  const dentistRef = doc(getFirestoreDb(), 'dentists', next.id)
  await setDoc(dentistRef, dentistToFirestoreDocument(next))

  const role = next.type === 'clinica' ? 'clinic_client' : 'dentist_client'
  await createInviteFirebase({
    role,
    entityType: 'dentist',
    entityId: next.id,
    fullName: next.name,
    clinicId: next.clinicId,
    dentistId: next.id,
    expiresInDays: 14,
  })

  return { ok: true, dentist: next }
}

export async function createDentistAsync(payload: DentistPayload): Promise<DentistMutationResult> {
  if (DATA_MODE === 'firebase') return createDentistFirebase(payload)
  return createDentist(payload)
}

export function updateDentist(id: string, patch: Partial<DentistClinic>) {
  const db = loadDb()
  const current = db.dentists.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Registro não encontrado.' }

  const nextType = patch.type ?? current.type
  const cnpjValue = patch.cnpj ?? current.cnpj
  if (nextType === 'clinica') {
    if (!cnpjValue) return { ok: false as const, error: 'CNPJ é obrigatório para clínica.' }
    if (!isValidCnpj(cnpjValue)) return { ok: false as const, error: 'CNPJ inválido.' }
  }

  const next: DentistClinic = {
    ...current,
    ...patch,
    name: patch.name ? patch.name.trim() : current.name,
    firstName: patch.firstName !== undefined ? normalizeText(patch.firstName) : current.firstName,
    lastName: patch.lastName !== undefined ? normalizeText(patch.lastName) : current.lastName,
    cnpj: cnpjValue ? formatCnpj(cnpjValue) : undefined,
    cro: patch.cro !== undefined ? normalizeText(patch.cro) : current.cro,
    gender: patch.gender ?? current.gender ?? 'masculino',
    cpf: patch.cpf !== undefined ? normalizeText(patch.cpf) : current.cpf,
    birthDate: patch.birthDate !== undefined ? normalizeText(patch.birthDate) : current.birthDate,
    clinicId: patch.clinicId ?? current.clinicId,
    phone: patch.phone !== undefined ? normalizeText(patch.phone) : current.phone,
    whatsapp: patch.whatsapp !== undefined ? normalizeText(patch.whatsapp) : current.whatsapp,
    email: patch.email !== undefined ? normalizeText(patch.email) : current.email,
    notes: patch.notes !== undefined ? normalizeText(patch.notes) : current.notes,
    updatedAt: nowIso(),
  }

  db.dentists = db.dentists.map((item) => (item.id === id ? next : item))
  saveDb(db)
  return { ok: true as const, dentist: next }
}

export async function updateDentistFirebase(id: string, patch: Partial<DentistClinic>): Promise<DentistMutationResult> {
  const current = await readDentistFromFirestore(id)
  if (!current) return { ok: false, error: 'Registro não encontrado.' }

  const nextType = patch.type ?? current.type
  const cnpjValue = patch.cnpj ?? current.cnpj
  if (nextType === 'clinica') {
    if (!cnpjValue) return { ok: false, error: 'CNPJ é obrigatório para clínica.' }
    if (!isValidCnpj(cnpjValue)) return { ok: false, error: 'CNPJ inválido.' }
  }

  const next: DentistClinic = {
    ...current,
    ...patch,
    name: patch.name ? patch.name.trim() : current.name,
    firstName: patch.firstName !== undefined ? normalizeText(patch.firstName) : current.firstName,
    lastName: patch.lastName !== undefined ? normalizeText(patch.lastName) : current.lastName,
    cnpj: cnpjValue ? formatCnpj(cnpjValue) : undefined,
    cro: patch.cro !== undefined ? normalizeText(patch.cro) : current.cro,
    gender: patch.gender ?? current.gender ?? 'masculino',
    cpf: patch.cpf !== undefined ? normalizeText(patch.cpf) : current.cpf,
    birthDate: patch.birthDate !== undefined ? normalizeText(patch.birthDate) : current.birthDate,
    clinicId: patch.clinicId ?? current.clinicId,
    phone: patch.phone !== undefined ? normalizeText(patch.phone) : current.phone,
    whatsapp: patch.whatsapp !== undefined ? normalizeText(patch.whatsapp) : current.whatsapp,
    email: patch.email !== undefined ? normalizeText(patch.email) : current.email,
    notes: patch.notes !== undefined ? normalizeText(patch.notes) : current.notes,
    updatedAt: nowIso(),
  }

  await setDoc(doc(getFirestoreDb(), 'dentists', id), dentistToFirestoreDocument(next), { merge: true })
  return { ok: true, dentist: next }
}

export async function updateDentistAsync(id: string, patch: Partial<DentistClinic>): Promise<DentistMutationResult> {
  if (DATA_MODE === 'firebase') return updateDentistFirebase(id, patch)
  return updateDentist(id, patch)
}

export function softDeleteDentist(id: string) {
  const db = loadDb()
  const current = db.dentists.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Registro não encontrado.' }

  db.dentists = db.dentists.map((item) =>
    item.id === id
      ? { ...item, deletedAt: nowIso(), isActive: false, updatedAt: nowIso() }
      : item,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function softDeleteDentistFirebase(id: string): Promise<DentistVoidResult> {
  const current = await readDentistFromFirestore(id)
  if (!current) return { ok: false, error: 'Registro não encontrado.' }
  await setDoc(
    doc(getFirestoreDb(), 'dentists', id),
    dentistToFirestoreDocument({ ...current, deletedAt: nowIso(), isActive: false, updatedAt: nowIso() }),
    { merge: true },
  )
  return { ok: true }
}

export async function softDeleteDentistAsync(id: string): Promise<DentistVoidResult> {
  if (DATA_MODE === 'firebase') return softDeleteDentistFirebase(id)
  return softDeleteDentist(id)
}

export function restoreDentist(id: string) {
  const db = loadDb()
  const current = db.dentists.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Registro não encontrado.' }

  db.dentists = db.dentists.map((item) =>
    item.id === id
      ? { ...item, deletedAt: undefined, isActive: true, updatedAt: nowIso() }
      : item,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function restoreDentistFirebase(id: string): Promise<DentistVoidResult> {
  const current = await readDentistFromFirestore(id)
  if (!current) return { ok: false, error: 'Registro não encontrado.' }
  await setDoc(
    doc(getFirestoreDb(), 'dentists', id),
    dentistToFirestoreDocument({ ...current, deletedAt: undefined, isActive: true, updatedAt: nowIso() }),
    { merge: true },
  )
  return { ok: true }
}

export async function restoreDentistAsync(id: string): Promise<DentistVoidResult> {
  if (DATA_MODE === 'firebase') return restoreDentistFirebase(id)
  return restoreDentist(id)
}
