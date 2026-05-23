import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'

export type AgendaManualEventType = 'escaneamento' | 'planejamento'

export type AgendaManualEventRow = {
  id: string
  clinic_id?: string | null
  titulo: string
  tipo: AgendaManualEventType
  inicio: string
  fim: string
  id_profissional?: string | null
  id_paciente?: string | null
  observacoes?: string | null
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
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

function asManualEventType(value: unknown): AgendaManualEventType {
  return value === 'planejamento' ? 'planejamento' : 'escaneamento'
}

function mapAgendaEventDocument(id: string, data: Record<string, unknown>): AgendaManualEventRow | null {
  const titulo = asText(data.titulo) ?? asText(data.title)
  const inicio = asText(data.inicio) ?? asText(data.start)
  const fim = asText(data.fim) ?? asText(data.end)
  if (!titulo || !inicio || !fim) return null
  return {
    id: asText(data.id) ?? id,
    clinic_id: asText(data.clinic_id) ?? asText(data.clinicId) ?? null,
    titulo,
    tipo: asManualEventType(data.tipo ?? data.type),
    inicio,
    fim,
    id_profissional: asText(data.id_profissional) ?? asText(data.professionalId) ?? null,
    id_paciente: asText(data.id_paciente) ?? asText(data.patientId) ?? null,
    observacoes: asText(data.observacoes) ?? asText(data.notes) ?? null,
    created_at: asText(data.created_at) ?? asText(data.createdAt),
    updated_at: asText(data.updated_at) ?? asText(data.updatedAt),
    deleted_at: asText(data.deleted_at) ?? asText(data.deletedAt) ?? null,
  }
}

function agendaEventToFirestoreDocument(row: AgendaManualEventRow) {
  return {
    id: row.id,
    clinic_id: row.clinic_id ?? null,
    titulo: row.titulo,
    tipo: row.tipo,
    inicio: row.inicio,
    fim: row.fim,
    id_profissional: row.id_profissional ?? null,
    id_paciente: row.id_paciente ?? null,
    observacoes: row.observacoes ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
    deleted_at: row.deleted_at ?? null,
  }
}

export async function listAgendaManualEventsFirebase(rangeStartIso: string, rangeEndIso: string) {
  const snapshot = await getDocs(
    query(
      collection(getFirestoreDb(), 'agenda_eventos'),
      where('inicio', '<=', rangeEndIso),
    ),
  )
  return snapshot.docs
    .map((item) => mapAgendaEventDocument(item.id, item.data()))
    .filter((row): row is AgendaManualEventRow => Boolean(row))
    .filter((row) => !row.deleted_at && row.fim >= rangeStartIso)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
}

export async function createAgendaManualEventFirebase(row: AgendaManualEventRow) {
  await setDoc(doc(getFirestoreDb(), 'agenda_eventos', row.id), agendaEventToFirestoreDocument(row), { merge: true })
}
