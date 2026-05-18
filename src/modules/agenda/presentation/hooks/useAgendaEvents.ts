import { useCallback, useEffect, useMemo, useState } from 'react'
import { listCasesForUser, listPatientsForUser } from '../../../../auth/scope'
import { DATA_MODE } from '../../../../data/dataMode'
import { buildActualChangeDateMap, buildAlignerWhatsappHref, buildChangeSchedule, resolveAlignerArchTotals, resolveDeliveredToPatient } from '../../../../lib/alignerChange'
import { getCurrentUser } from '../../../../lib/auth'
import { supabase } from '../../../../lib/supabaseClient'
import { useDb } from '../../../../lib/useDb'
import { useSupabaseSyncTick } from '../../../../lib/useSupabaseSyncTick'
import { isAlignerProductType } from '../../../../types/Product'
import type { Case } from '../../../../types/Case'
import { mapSupabaseCaseRow } from '../../../cases/infra/supabase/supabaseCaseMappers'

export type AgendaManualEventType = 'escaneamento' | 'planejamento'
export type AgendaEventType = AgendaManualEventType | 'troca_alinhador'

export type AgendaPersonOption = {
  id: string
  name: string
  clinicId?: string
  whatsapp?: string
}

export type AgendaCalendarEvent = {
  id: string
  source: 'manual' | 'aligner_reminder'
  type: AgendaEventType
  title: string
  start: string
  end: string
  date: string
  readonly: boolean
  patientId?: string
  patientName?: string
  patientWhatsapp?: string
  professionalId?: string
  professionalName?: string
  caseId?: string
  trayLabel?: string
  notes?: string
  whatsappHref?: string
}

export type CreateAgendaManualEventInput = {
  title: string
  type: AgendaManualEventType
  startIso: string
  endIso: string
  professionalId?: string
  patientId?: string
  notes?: string
}

type AgendaManualEventRow = {
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

type SupabaseCaseRow = {
  id: string
  product_type?: string | null
  product_id?: string | null
  scan_id?: string | null
  clinic_id?: string | null
  patient_id?: string | null
  dentist_id?: string | null
  requested_by_dentist_id?: string | null
  data?: Record<string, unknown>
}

type SupabasePatientRow = {
  id: string
  name?: string | null
  whatsapp?: string | null
  clinic_id?: string | null
}

type SupabaseDentistRow = {
  id: string
  name?: string | null
  clinic_id?: string | null
}

const LOCAL_AGENDA_KEY = 'arrimo_orthoscan_agenda_eventos_v1'

export const agendaEventTypeLabels: Record<AgendaEventType, string> = {
  escaneamento: 'Escaneamento',
  planejamento: 'Planejamento',
  troca_alinhador: 'Troca de alinhador',
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateKeyFromIso(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return toLocalDateKey(parsed)
}

function isoAtLocalTime(dateKey: string, hour: number, minute: number) {
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).toISOString()
}

function overlapsRange(row: Pick<AgendaManualEventRow, 'inicio' | 'fim'>, rangeStartIso: string, rangeEndIso: string) {
  return row.inicio <= rangeEndIso && row.fim >= rangeStartIso
}

function readLocalManualEvents(): AgendaManualEventRow[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(LOCAL_AGENDA_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AgendaManualEventRow => {
      if (!item || typeof item !== 'object') return false
      const row = item as Partial<AgendaManualEventRow>
      return Boolean(row.id && row.titulo && row.inicio && row.fim && (row.tipo === 'escaneamento' || row.tipo === 'planejamento'))
    })
  } catch {
    return []
  }
}

function writeLocalManualEvents(rows: AgendaManualEventRow[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCAL_AGENDA_KEY, JSON.stringify(rows))
}

function sortEvents(left: AgendaCalendarEvent, right: AgendaCalendarEvent) {
  return left.start.localeCompare(right.start) || left.title.localeCompare(right.title)
}

function toManualCalendarEvent(
  row: AgendaManualEventRow,
  patientsById: Map<string, AgendaPersonOption>,
  professionalsById: Map<string, AgendaPersonOption>,
): AgendaCalendarEvent {
  const patient = row.id_paciente ? patientsById.get(row.id_paciente) : undefined
  const professional = row.id_profissional ? professionalsById.get(row.id_profissional) : undefined
  return {
    id: `manual:${row.id}`,
    source: 'manual',
    type: row.tipo,
    title: row.titulo || agendaEventTypeLabels[row.tipo],
    start: row.inicio,
    end: row.fim,
    date: dateKeyFromIso(row.inicio),
    readonly: false,
    patientId: row.id_paciente ?? undefined,
    patientName: patient?.name,
    patientWhatsapp: patient?.whatsapp,
    professionalId: row.id_profissional ?? undefined,
    professionalName: professional?.name,
    notes: row.observacoes ?? undefined,
  }
}

function numberLabel(values: number[]) {
  return values.length === 1 ? String(values[0]) : values.join('/')
}

function formatTrayLabel(upper: number[], lower: number[]) {
  if (upper.length > 0 && lower.length > 0 && numberLabel(upper) === numberLabel(lower)) {
    return `alinhador ${numberLabel(upper)} sup/inf`
  }
  const parts = []
  if (upper.length > 0) parts.push(`sup ${numberLabel(upper)}`)
  if (lower.length > 0) parts.push(`inf ${numberLabel(lower)}`)
  return parts.join(' | ') || 'proximo alinhador'
}

function addReminderTarget(
  remindersByKey: Map<string, { caseItem: Case; date: string; upper: number[]; lower: number[] }>,
  caseItem: Case,
  date: string | undefined,
  trayNumber: number,
  arch: 'upper' | 'lower',
  rangeStartKey: string,
  rangeEndKey: string,
) {
  if (!date || date < rangeStartKey || date > rangeEndKey) return
  const key = `${caseItem.id}:${date}`
  const current = remindersByKey.get(key) ?? { caseItem, date, upper: [], lower: [] }
  const target = arch === 'upper' ? current.upper : current.lower
  if (!target.includes(trayNumber)) target.push(trayNumber)
  remindersByKey.set(key, current)
}

function buildAlignerReminderEvents(
  cases: Case[],
  patientsById: Map<string, AgendaPersonOption>,
  professionalsById: Map<string, AgendaPersonOption>,
  rangeStartKey: string,
  rangeEndKey: string,
) {
  const remindersByKey = new Map<string, { caseItem: Case; date: string; upper: number[]; lower: number[] }>()

  cases.forEach((caseItem) => {
    if (!isAlignerProductType(caseItem.productId ?? caseItem.productType)) return
    if (caseItem.status === 'finalizado') return
    const installedAt = caseItem.installation?.installedAt?.slice(0, 10)
    if (!installedAt) return

    const totals = resolveAlignerArchTotals(caseItem)
    const delivered = resolveDeliveredToPatient(caseItem, totals)
    if (delivered.upper <= 0 && delivered.lower <= 0) return

    const schedule = buildChangeSchedule({
      installedAt,
      changeEveryDays: Math.max(1, Math.trunc(caseItem.changeEveryDays || 7)),
      totalUpper: totals.upper,
      totalLower: totals.lower,
      deliveredUpper: delivered.upper,
      deliveredLower: delivered.lower,
      trays: caseItem.trays ?? [],
      actualUpperByTray: buildActualChangeDateMap(caseItem.installation, 'superior'),
      actualLowerByTray: buildActualChangeDateMap(caseItem.installation, 'inferior'),
    })

    schedule.forEach((row) => {
      if (row.trayNumber <= delivered.upper) {
        addReminderTarget(remindersByKey, caseItem, row.upperChangeDate, row.trayNumber, 'upper', rangeStartKey, rangeEndKey)
      }
      if (row.trayNumber <= delivered.lower) {
        addReminderTarget(remindersByKey, caseItem, row.lowerChangeDate, row.trayNumber, 'lower', rangeStartKey, rangeEndKey)
      }
    })
  })

  return Array.from(remindersByKey.values()).map((reminder): AgendaCalendarEvent => {
    const patient = reminder.caseItem.patientId ? patientsById.get(reminder.caseItem.patientId) : undefined
    const professional = reminder.caseItem.dentistId ? professionalsById.get(reminder.caseItem.dentistId) : undefined
    const patientName = patient?.name ?? reminder.caseItem.patientName
    const trayLabel = formatTrayLabel(reminder.upper.sort((a, b) => a - b), reminder.lower.sort((a, b) => a - b))
    const whatsappHref = buildAlignerWhatsappHref(
      patient?.whatsapp,
      patientName,
      {
        upper: reminder.upper[0],
        lower: reminder.lower[0],
      },
      reminder.date,
    )

    return {
      id: `aligner:${reminder.caseItem.id}:${reminder.date}:${reminder.upper.join('-')}:${reminder.lower.join('-')}`,
      source: 'aligner_reminder',
      type: 'troca_alinhador',
      title: `${patientName}: ${trayLabel}`,
      start: isoAtLocalTime(reminder.date, 9, 0),
      end: isoAtLocalTime(reminder.date, 9, 30),
      date: reminder.date,
      readonly: true,
      patientId: reminder.caseItem.patientId,
      patientName,
      patientWhatsapp: patient?.whatsapp,
      professionalId: reminder.caseItem.dentistId,
      professionalName: professional?.name,
      caseId: reminder.caseItem.id,
      trayLabel,
      whatsappHref: whatsappHref || undefined,
      notes: 'Lembrete automatico gerado pelas datas previstas do tratamento.',
    }
  })
}

function toCaseFromSupabaseRow(row: SupabaseCaseRow): Case {
  return mapSupabaseCaseRow({
    id: row.id,
    product_type: row.product_type ?? undefined,
    product_id: row.product_id ?? undefined,
    scan_id: row.scan_id ?? undefined,
    clinic_id: row.clinic_id ?? undefined,
    patient_id: row.patient_id ?? undefined,
    dentist_id: row.dentist_id ?? undefined,
    requested_by_dentist_id: row.requested_by_dentist_id ?? undefined,
    data: row.data,
  })
}

export function useAgendaEvents(rangeStart: Date, rangeEnd: Date) {
  const { db } = useDb()
  const currentUser = useMemo(() => getCurrentUser(db), [db])
  const isSupabaseMode = DATA_MODE === 'supabase'
  const supabaseSyncTick = useSupabaseSyncTick(30000)
  const [refreshKey, setRefreshKey] = useState(0)
  const [events, setEvents] = useState<AgendaCalendarEvent[]>([])
  const [patientOptions, setPatientOptions] = useState<AgendaPersonOption[]>([])
  const [professionalOptions, setProfessionalOptions] = useState<AgendaPersonOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rangeStartKey = toLocalDateKey(rangeStart)
  const rangeEndKey = toLocalDateKey(rangeEnd)
  const rangeStartIso = startOfLocalDay(rangeStart).toISOString()
  const rangeEndIso = endOfLocalDay(rangeEnd).toISOString()

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1)
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    const load = async () => {
      if (isSupabaseMode && supabase) {
        const [manualRes, patientsRes, dentistsRes, casesRes] = await Promise.all([
          supabase
            .from('agenda_eventos')
            .select('id, clinic_id, titulo, tipo, inicio, fim, id_profissional, id_paciente, observacoes, created_at, updated_at, deleted_at')
            .is('deleted_at', null)
            .lte('inicio', rangeEndIso)
            .gte('fim', rangeStartIso)
            .order('inicio', { ascending: true }),
          supabase
            .from('patients')
            .select('id, name, whatsapp, clinic_id, deleted_at')
            .is('deleted_at', null)
            .order('name', { ascending: true }),
          supabase
            .from('dentists')
            .select('id, name, clinic_id, deleted_at')
            .is('deleted_at', null)
            .order('name', { ascending: true }),
          supabase
            .from('cases')
            .select('id, product_type, product_id, scan_id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, data, deleted_at')
            .is('deleted_at', null),
        ])

        if (!active) return
        const blockingError = patientsRes.error ?? dentistsRes.error ?? casesRes.error
        if (blockingError) throw new Error(blockingError.message)

        const patients = ((patientsRes.data ?? []) as SupabasePatientRow[]).map((row) => ({
          id: row.id,
          name: row.name ?? '-',
          clinicId: row.clinic_id ?? undefined,
          whatsapp: row.whatsapp ?? undefined,
        }))
        const professionals = ((dentistsRes.data ?? []) as SupabaseDentistRow[]).map((row) => ({
          id: row.id,
          name: row.name ?? '-',
          clinicId: row.clinic_id ?? undefined,
        }))
        const patientsById = new Map(patients.map((item) => [item.id, item]))
        const professionalsById = new Map(professionals.map((item) => [item.id, item]))
        const manualRows = manualRes.error ? [] : ((manualRes.data ?? []) as AgendaManualEventRow[])
        const manualEvents = manualRows.map((row) => toManualCalendarEvent(row, patientsById, professionalsById))
        const caseItems = ((casesRes.data ?? []) as SupabaseCaseRow[]).map(toCaseFromSupabaseRow)
        const reminders = buildAlignerReminderEvents(caseItems, patientsById, professionalsById, rangeStartKey, rangeEndKey)

        setPatientOptions(patients)
        setProfessionalOptions(professionals)
        setEvents([...manualEvents, ...reminders].sort(sortEvents))
        setError(manualRes.error ? `Eventos manuais indisponiveis: ${manualRes.error.message}` : null)
        return
      }

      const scopedPatients = listPatientsForUser(db, currentUser)
        .filter((patient) => !patient.deletedAt)
        .map((patient) => ({
          id: patient.id,
          name: patient.name,
          clinicId: patient.clinicId,
          whatsapp: patient.whatsapp,
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
      const professionals = db.dentists
        .filter((dentist) => dentist.type === 'dentista' && !dentist.deletedAt)
        .map((dentist) => ({
          id: dentist.id,
          name: dentist.name,
          clinicId: dentist.clinicId,
          whatsapp: dentist.whatsapp,
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
      const patientsById = new Map(scopedPatients.map((item) => [item.id, item]))
      const professionalsById = new Map(professionals.map((item) => [item.id, item]))
      const manualEvents = readLocalManualEvents()
        .filter((row) => !row.deleted_at && overlapsRange(row, rangeStartIso, rangeEndIso))
        .map((row) => toManualCalendarEvent(row, patientsById, professionalsById))
      const reminders = buildAlignerReminderEvents(listCasesForUser(db, currentUser), patientsById, professionalsById, rangeStartKey, rangeEndKey)

      if (!active) return
      setPatientOptions(scopedPatients)
      setProfessionalOptions(professionals)
      setEvents([...manualEvents, ...reminders].sort(sortEvents))
    }

    load()
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'Nao foi possivel carregar a agenda.')
        setEvents([])
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [currentUser, db, isSupabaseMode, rangeEndIso, rangeEndKey, rangeStartIso, rangeStartKey, refreshKey, supabaseSyncTick])

  const createManualEvent = useCallback(
    async (input: CreateAgendaManualEventInput): Promise<{ ok: true } | { ok: false; error: string }> => {
      const title = input.title.trim()
      const notes = input.notes?.trim() || undefined
      const start = new Date(input.startIso)
      const end = new Date(input.endIso)
      if (!title) return { ok: false, error: 'Informe um titulo para o evento.' }
      if (input.type !== 'escaneamento' && input.type !== 'planejamento') return { ok: false, error: 'Tipo de evento invalido.' }
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return { ok: false, error: 'Informe um periodo valido para o evento.' }
      }

      const patientClinicId = input.patientId ? patientOptions.find((item) => item.id === input.patientId)?.clinicId : undefined
      const professionalClinicId = input.professionalId ? professionalOptions.find((item) => item.id === input.professionalId)?.clinicId : undefined
      const clinicId = patientClinicId ?? professionalClinicId ?? currentUser?.linkedClinicId

      if (isSupabaseMode) {
        if (!supabase) return { ok: false, error: 'Supabase nao configurado.' }
        const { error: insertError } = await supabase.from('agenda_eventos').insert({
          titulo: title,
          tipo: input.type,
          inicio: start.toISOString(),
          fim: end.toISOString(),
          id_profissional: input.professionalId || null,
          id_paciente: input.patientId || null,
          observacoes: notes ?? null,
          clinic_id: clinicId ?? null,
        })
        if (insertError) return { ok: false, error: insertError.message }
        refresh()
        return { ok: true }
      }

      const now = new Date().toISOString()
      const nextRow: AgendaManualEventRow = {
        id: `agenda_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        clinic_id: clinicId,
        titulo: title,
        tipo: input.type,
        inicio: start.toISOString(),
        fim: end.toISOString(),
        id_profissional: input.professionalId || null,
        id_paciente: input.patientId || null,
        observacoes: notes,
        created_at: now,
        updated_at: now,
      }
      writeLocalManualEvents([nextRow, ...readLocalManualEvents()])
      refresh()
      return { ok: true }
    },
    [currentUser?.linkedClinicId, isSupabaseMode, patientOptions, professionalOptions, refresh],
  )

  return {
    events,
    patientOptions,
    professionalOptions,
    loading,
    error,
    refresh,
    createManualEvent,
  }
}
