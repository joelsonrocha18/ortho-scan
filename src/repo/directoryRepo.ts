import { listClinicsFirebase } from './clinicRepo'
import { listDentistsFirebase } from '../data/dentistRepo'

export type ClinicOption = { id: string; tradeName: string }
export type DentistOption = { id: string; name: string; clinicId: string | null }

export async function listClinicsSupabase(): Promise<ClinicOption[]> {
  const clinics = await listClinicsFirebase({ includeDeleted: false })
  return clinics.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName }))
}

export async function listDentistsSupabase(options?: { clinicId?: string }): Promise<DentistOption[]> {
  const dentists = await listDentistsFirebase({
    includeDeleted: false,
    includeInactive: false,
    clinicId: options?.clinicId,
  })
  return dentists.map((dentist) => ({
    id: dentist.id,
    name: dentist.name,
    clinicId: dentist.clinicId ?? null,
  }))
}
