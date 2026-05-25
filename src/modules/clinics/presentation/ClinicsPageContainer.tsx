import AppShell from '../../../layouts/AppShell'
import { useDb } from '../../../lib/useDb'
import ClinicsTable, { type ClinicListItem } from './components/ClinicsTable'

export default function ClinicsPageContainer() {
  const { db } = useDb()
  const clinics: ClinicListItem[] = db.clinics
    .filter((clinic) => !clinic.deletedAt)
    .map((clinic) => ({
      id: clinic.id,
      name: clinic.tradeName,
      cnpj: clinic.cnpj ?? '-',
      city: clinic.address?.city ?? '-',
      state: clinic.address?.state ?? '-',
      plan: 'professional',
      status: clinic.isActive ? 'active' : 'suspended',
      users_count: db.users.filter((user) => user.linkedClinicId === clinic.id).length,
      cases_count: db.cases.filter((caseItem) => caseItem.clinicId === clinic.id).length,
      created_at: new Date(clinic.createdAt),
    }))

  return (
    <AppShell breadcrumb={['Clínicas']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Clínicas</h1>
        <p className="mt-1 text-sm text-slate-600">Gestão multi-clínica para administradores master.</p>
      </div>
      <ClinicsTable clinics={clinics} />
    </AppShell>
  )
}
