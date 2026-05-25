import AppShell from '../../../layouts/AppShell'
import { useDb } from '../../../lib/useDb'
import PatientsTable, { type PatientListItem } from './components/PatientsTable'

export default function PatientsPageContainer() {
  const { db } = useDb()
  const dentistsById = new Map(db.dentists.map((dentist) => [dentist.id, dentist.name]))
  const casesByPatient = new Map(db.cases.map((caseItem) => [caseItem.patientId ?? '', caseItem]))
  const patients: PatientListItem[] = db.patients
    .filter((patient) => !patient.deletedAt)
    .map((patient) => {
      const activeCase = casesByPatient.get(patient.id)
      return {
        id: patient.id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone ?? patient.whatsapp ?? '-',
        cpf: patient.cpf,
        dentist_id: patient.primaryDentistId ?? '',
        dentist_name: dentistsById.get(patient.primaryDentistId ?? '') ?? 'Não informado',
        active_case: activeCase ? { id: activeCase.id, status: activeCase.status } : undefined,
        portal_enabled: Boolean(patient.portal_enabled),
        current_tray: patient.current_tray,
        total_trays: activeCase?.totalTrays,
        created_at: new Date(patient.createdAt),
      }
    })

  return (
    <AppShell breadcrumb={['Pacientes']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Pacientes</h1>
        <p className="mt-1 text-sm text-slate-600">Lista aprimorada com busca, portal e vínculo com casos ativos.</p>
      </div>
      <PatientsTable patients={patients} />
    </AppShell>
  )
}
