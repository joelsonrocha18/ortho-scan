import AppShell from '../../../layouts/AppShell'
import { useDb } from '../../../lib/useDb'
import DentistsTable, { type DentistListItem } from './components/DentistsTable'

export default function DentistsPageContainer() {
  const { db } = useDb()
  const clinicsById = new Map(db.clinics.map((clinic) => [clinic.id, clinic.tradeName]))
  const dentists: DentistListItem[] = db.dentists
    .filter((dentist) => dentist.type === 'dentista' && !dentist.deletedAt)
    .map((dentist) => {
      const cases = db.cases.filter((caseItem) => caseItem.dentistId === dentist.id)
      return {
        id: dentist.id,
        name: dentist.name,
        cro: dentist.cro ?? '-',
        cro_state: dentist.address?.state ?? '-',
        email: dentist.email ?? '-',
        phone: dentist.phone ?? dentist.whatsapp ?? '-',
        clinic_names: dentist.clinicId ? [clinicsById.get(dentist.clinicId) ?? dentist.clinicId] : [],
        role: 'dentist_client',
        active_cases_count: cases.filter((caseItem) => caseItem.status !== 'finalizado').length,
        total_cases_count: cases.length,
        portal_access: Boolean(dentist.portal_access_token),
        created_at: new Date(dentist.createdAt),
      }
    })

  return (
    <AppShell breadcrumb={['Dentistas']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Dentistas</h1>
        <p className="mt-1 text-sm text-slate-600">Gestão de parceiros, métricas e acesso ao portal.</p>
      </div>
      <DentistsTable dentists={dentists} />
    </AppShell>
  )
}
