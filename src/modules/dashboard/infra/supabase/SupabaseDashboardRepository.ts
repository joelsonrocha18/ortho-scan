import { supabase } from '../../../../lib/supabaseClient'
import { err, ok, type Result } from '../../../../shared/errors'
import type { Patient } from '../../../../types/Patient'
import type { User } from '../../../../types/User'
import type { DashboardDateRange, DashboardRepository, ExecutiveDashboardSnapshot } from '../../application/ports/DashboardRepository'
import { mapSupabaseCaseRow, mapSupabaseScanRow } from '../../../cases/infra/supabase/supabaseCaseMappers'
import { mapSupabaseLabRow } from '../../../lab/infra/supabase/supabaseLabMappers'

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function isWithinDateRange(value: string | undefined, period?: DashboardDateRange) {
  if (!period || !value) return true
  const date = value.slice(0, 10)
  return date >= period.startDate && date <= period.endDate
}

function mapSupabasePatientRow(row: Record<string, unknown>): Patient {
  return {
    id: asText(row.id),
    shortId: asText(row.short_id) || undefined,
    name: asText(row.name, '-'),
    firstName: asText(row.first_name) || undefined,
    lastName: asText(row.last_name) || undefined,
    cpf: asText(row.cpf) || undefined,
    phone: asText(row.phone) || undefined,
    whatsapp: asText(row.whatsapp) || undefined,
    email: asText(row.email) || undefined,
    birthDate: asText(row.birth_date) || undefined,
    gender: (asText(row.gender) || undefined) as Patient['gender'],
    clinicId: asText(row.clinic_id) || undefined,
    primaryDentistId: asText(row.primary_dentist_id) || undefined,
    notes: asText(row.notes) || undefined,
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at, asText(row.created_at)),
    deletedAt: asText(row.deleted_at) || undefined,
  }
}

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(_currentUser: User | null) {}

  async loadSnapshot(period?: DashboardDateRange): Promise<Result<ExecutiveDashboardSnapshot, string>> {
    if (!supabase) return err('Supabase não configurado.')

    const [casesRes, scansRes, labRes, patientsRes] = await Promise.all([
      supabase
        .from('cases')
        .select('id, product_type, product_id, scan_id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, data, deleted_at')
        .is('deleted_at', null),
      supabase
        .from('scans')
        .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, created_at, data, deleted_at')
        .is('deleted_at', null),
      supabase
        .from('lab_items')
        .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data, deleted_at')
        .is('deleted_at', null),
      supabase
        .from('patients')
        .select('id, short_id, name, first_name, last_name, cpf, phone, whatsapp, email, birth_date, gender, clinic_id, primary_dentist_id, notes, created_at, updated_at, deleted_at')
        .is('deleted_at', null),
    ])

    if (casesRes.error) return err(casesRes.error.message)
    if (scansRes.error) return err(scansRes.error.message)
    if (labRes.error) return err(labRes.error.message)
    if (patientsRes.error) return err(patientsRes.error.message)

    const cases = ((casesRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
      mapSupabaseCaseRow(row as {
        id: string
        product_type?: string
        product_id?: string
        scan_id?: string | null
        clinic_id?: string | null
        patient_id?: string | null
        dentist_id?: string | null
        requested_by_dentist_id?: string | null
        data?: Record<string, unknown>
      }),
    ).filter((caseItem) => isWithinDateRange(caseItem.createdAt ?? caseItem.scanDate, period))
    const scans = ((scansRes.data ?? []) as Array<Record<string, unknown>>).map((row) =>
      mapSupabaseScanRow(row as {
        id: string
        clinic_id?: string | null
        patient_id?: string | null
        dentist_id?: string | null
        requested_by_dentist_id?: string | null
        created_at?: string
        data?: Record<string, unknown>
      }),
    ).filter((scan) => isWithinDateRange(scan.scanDate ?? scan.createdAt, period))
    const labOrders = ((labRes.data ?? []) as Array<Record<string, unknown>>)
      .map(mapSupabaseLabRow)
      .filter((order) => isWithinDateRange(order.createdAt ?? order.plannedDate, period))
    const patients = ((patientsRes.data ?? []) as Array<Record<string, unknown>>).map(mapSupabasePatientRow)

    return ok({
      cases,
      patients,
      scans,
      labOrders,
    })
  }
}

export function createSupabaseDashboardRepository(currentUser: User | null) {
  return new SupabaseDashboardRepository(currentUser)
}
