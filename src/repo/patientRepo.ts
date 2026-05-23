import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { db as firestoreDb } from '../lib/firebaseClient'
import { normalizeText } from '../shared/validators'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { Patient } from '../types/Patient'

type PatientPayload = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
type PatientDocument = Record<string, unknown>
type PatientMutationResult = { ok: true; patient: Patient } | { ok: false; error: string }
type PatientVoidResult = { ok: true } | { ok: false; error: string }

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

function asGender(value: unknown): Patient['gender'] {
  if (value === 'masculino' || value === 'feminino' || value === 'outro') return value
  return undefined
}

function mapPatientDocument(id: string, data: PatientDocument): Patient {
  const now = nowIsoDateTime()
  const address = asObject(data.address)
  const firstName = asText(data.firstName) ?? asText(data.first_name)
  const lastName = asText(data.lastName) ?? asText(data.last_name)
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const name = asText(data.name) ?? (fallbackName || 'Paciente sem nome')

  return {
    id: asText(data.id) ?? id,
    shortId: asText(data.shortId) ?? asText(data.short_id),
    name,
    firstName,
    lastName,
    cpf: asText(data.cpf),
    gender: asGender(data.gender),
    phone: asText(data.phone),
    whatsapp: asText(data.whatsapp),
    email: asText(data.email),
    birthDate: asText(data.birthDate) ?? asText(data.birth_date),
    address: address as Patient['address'],
    primaryDentistId: asText(data.primaryDentistId) ?? asText(data.primary_dentist_id),
    clinicId: asText(data.clinicId) ?? asText(data.clinic_id),
    notes: asText(data.notes),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    deletedAt: asText(data.deletedAt) ?? asText(data.deleted_at),
  }
}

function patientToFirestoreDocument(patient: Patient): PatientDocument {
  return {
    id: patient.id,
    short_id: patient.shortId ?? null,
    name: patient.name,
    first_name: patient.firstName ?? null,
    last_name: patient.lastName ?? null,
    cpf: patient.cpf ?? null,
    birth_date: patient.birthDate ?? null,
    gender: patient.gender ?? null,
    phone: patient.phone ?? null,
    whatsapp: patient.whatsapp ?? null,
    email: patient.email ?? null,
    address: patient.address ?? null,
    notes: patient.notes ?? null,
    clinic_id: patient.clinicId ?? null,
    primary_dentist_id: patient.primaryDentistId ?? null,
    created_at: patient.createdAt,
    updated_at: patient.updatedAt,
    deleted_at: patient.deletedAt ?? null,
  }
}

async function readPatientFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'patients', id))
  if (!snapshot.exists()) return null
  return mapPatientDocument(snapshot.id, snapshot.data())
}

export function listPatients(options?: { query?: string; includeDeleted?: boolean }) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const includeDeleted = options?.includeDeleted ?? false
  return loadDb()
    .patients.filter((item) => (includeDeleted ? true : !item.deletedAt))
    .filter((item) => {
      if (!query) return true
      return (
        matchesQuery(item.name, query) ||
        matchesQuery(item.cpf, query) ||
        matchesQuery(item.phone, query) ||
        matchesQuery(item.whatsapp, query)
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listPatientsFirebase(options?: { query?: string; includeDeleted?: boolean }) {
  const query = options?.query?.trim().toLowerCase() ?? ''
  const includeDeleted = options?.includeDeleted ?? false
  const snapshot = await getDocs(collection(getFirestoreDb(), 'patients'))

  return snapshot.docs
    .map((item) => mapPatientDocument(item.id, item.data()))
    .filter((item) => (includeDeleted ? true : !item.deletedAt))
    .filter((item) => {
      if (!query) return true
      return (
        matchesQuery(item.name, query) ||
        matchesQuery(item.cpf, query) ||
        matchesQuery(item.phone, query) ||
        matchesQuery(item.whatsapp, query)
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listPatientsAsync(options?: { query?: string; includeDeleted?: boolean }) {
  if (DATA_MODE === 'firebase') return listPatientsFirebase(options)
  return listPatients(options)
}

export function getPatient(id: string) {
  return loadDb().patients.find((item) => item.id === id) ?? null
}

export async function getPatientFirebase(id: string) {
  return readPatientFromFirestore(id)
}

export async function getPatientAsync(id: string) {
  if (DATA_MODE === 'firebase') return getPatientFirebase(id)
  return getPatient(id)
}

export function createPatient(payload: PatientPayload) {
  const db = loadDb()
  const name = normalizeText(payload.name) ?? ''
  if (!name) return { ok: false as const, error: 'Nome é obrigatório.' }
  if (!payload.birthDate) return { ok: false as const, error: 'Data de nascimento é obrigatória.' }

  const now = nowIsoDateTime()
  const next: Patient = {
    id: createEntityId('pat'),
    name,
    firstName: payload.firstName,
    lastName: payload.lastName,
    cpf: payload.cpf,
    gender: payload.gender,
    phone: payload.phone,
    whatsapp: payload.whatsapp,
    email: payload.email,
    birthDate: payload.birthDate,
    address: payload.address,
    primaryDentistId: payload.primaryDentistId,
    clinicId: payload.clinicId,
    notes: payload.notes,
    createdAt: now,
    updatedAt: now,
  }

  db.patients = [next, ...db.patients]
  saveDb(db)
  return { ok: true as const, patient: next }
}

export async function createPatientFirebase(payload: PatientPayload): Promise<PatientMutationResult> {
  const name = normalizeText(payload.name) ?? ''
  if (!name) return { ok: false, error: 'Nome é obrigatório.' }
  if (!payload.birthDate) return { ok: false, error: 'Data de nascimento é obrigatória.' }

  const now = nowIsoDateTime()
  const next: Patient = {
    id: createEntityId('pat'),
    name,
    firstName: payload.firstName,
    lastName: payload.lastName,
    cpf: payload.cpf,
    gender: payload.gender,
    phone: payload.phone,
    whatsapp: payload.whatsapp,
    email: payload.email,
    birthDate: payload.birthDate,
    address: payload.address,
    primaryDentistId: payload.primaryDentistId,
    clinicId: payload.clinicId,
    notes: payload.notes,
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(getFirestoreDb(), 'patients', next.id), patientToFirestoreDocument(next))
  return { ok: true, patient: next }
}

export async function createPatientAsync(payload: PatientPayload): Promise<PatientMutationResult> {
  if (DATA_MODE === 'firebase') return createPatientFirebase(payload)
  return createPatient(payload)
}

export function updatePatient(id: string, patch: Partial<Patient>) {
  const db = loadDb()
  const current = db.patients.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Paciente não encontrado.' }
  const nextBirthDate = patch.birthDate ?? current.birthDate
  if (!nextBirthDate) return { ok: false as const, error: 'Data de nascimento é obrigatória.' }

  const next: Patient = {
    ...current,
    ...patch,
    name: patch.name ? (normalizeText(patch.name) ?? current.name) : current.name,
    firstName: patch.firstName !== undefined ? patch.firstName?.trim() || undefined : current.firstName,
    lastName: patch.lastName !== undefined ? patch.lastName?.trim() || undefined : current.lastName,
    updatedAt: nowIsoDateTime(),
  }

  db.patients = db.patients.map((item) => (item.id === id ? next : item))
  saveDb(db)
  return { ok: true as const, patient: next }
}

export async function updatePatientFirebase(id: string, patch: Partial<Patient>): Promise<PatientMutationResult> {
  const current = await readPatientFromFirestore(id)
  if (!current) return { ok: false, error: 'Paciente não encontrado.' }
  const nextBirthDate = patch.birthDate ?? current.birthDate
  if (!nextBirthDate) return { ok: false, error: 'Data de nascimento é obrigatória.' }

  const next: Patient = {
    ...current,
    ...patch,
    name: patch.name ? (normalizeText(patch.name) ?? current.name) : current.name,
    firstName: patch.firstName !== undefined ? patch.firstName?.trim() || undefined : current.firstName,
    lastName: patch.lastName !== undefined ? patch.lastName?.trim() || undefined : current.lastName,
    updatedAt: nowIsoDateTime(),
  }

  await setDoc(doc(getFirestoreDb(), 'patients', id), patientToFirestoreDocument(next), { merge: true })
  return { ok: true, patient: next }
}

export async function updatePatientAsync(id: string, patch: Partial<Patient>): Promise<PatientMutationResult> {
  if (DATA_MODE === 'firebase') return updatePatientFirebase(id, patch)
  return updatePatient(id, patch)
}

export function softDeletePatient(id: string) {
  const db = loadDb()
  const current = db.patients.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Paciente não encontrado.' }

  db.patients = db.patients.map((item) =>
    item.id === id ? { ...item, deletedAt: nowIsoDateTime(), updatedAt: nowIsoDateTime() } : item,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function softDeletePatientFirebase(id: string): Promise<PatientVoidResult> {
  const current = await readPatientFromFirestore(id)
  if (!current) return { ok: false, error: 'Paciente não encontrado.' }

  await setDoc(
    doc(getFirestoreDb(), 'patients', id),
    patientToFirestoreDocument({ ...current, deletedAt: nowIsoDateTime(), updatedAt: nowIsoDateTime() }),
    { merge: true },
  )
  return { ok: true }
}

export async function softDeletePatientAsync(id: string): Promise<PatientVoidResult> {
  if (DATA_MODE === 'firebase') return softDeletePatientFirebase(id)
  return softDeletePatient(id)
}

export function restorePatient(id: string) {
  const db = loadDb()
  const current = db.patients.find((item) => item.id === id)
  if (!current) return { ok: false as const, error: 'Paciente não encontrado.' }

  db.patients = db.patients.map((item) =>
    item.id === id ? { ...item, deletedAt: undefined, updatedAt: nowIsoDateTime() } : item,
  )
  saveDb(db)
  return { ok: true as const }
}

export async function restorePatientFirebase(id: string): Promise<PatientVoidResult> {
  const current = await readPatientFromFirestore(id)
  if (!current) return { ok: false, error: 'Paciente não encontrado.' }

  await setDoc(
    doc(getFirestoreDb(), 'patients', id),
    patientToFirestoreDocument({ ...current, deletedAt: undefined, updatedAt: nowIsoDateTime() }),
    { merge: true },
  )
  return { ok: true }
}

export async function restorePatientAsync(id: string): Promise<PatientVoidResult> {
  if (DATA_MODE === 'firebase') return restorePatientFirebase(id)
  return restorePatient(id)
}
