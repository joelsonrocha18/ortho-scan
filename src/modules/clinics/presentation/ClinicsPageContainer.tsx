import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { can } from '../../../auth/permissions'
import Button from '../../../components/Button'
import { listCasesAsync } from '../../../data/caseRepo'
import { DATA_MODE } from '../../../data/dataMode'
import AppShell from '../../../layouts/AppShell'
import { getCurrentUser } from '../../../lib/auth'
import { useDb } from '../../../lib/useDb'
import { listClinicsAsync } from '../../../repo/clinicRepo'
import type { Case } from '../../../types/Case'
import type { Clinic } from '../../../types/Clinic'
import ClinicsTable, { type ClinicListItem } from './components/ClinicsTable'

export default function ClinicsPageContainer() {
  const { db } = useDb()
  const navigate = useNavigate()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'clinics.write')
  const [remoteClinics, setRemoteClinics] = useState<Clinic[]>([])
  const [remoteCases, setRemoteCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(DATA_MODE === 'firebase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (DATA_MODE !== 'firebase') return undefined
    let active = true
    setLoading(true)
    setError(null)

    void Promise.all([listClinicsAsync({ includeDeleted: false }), listCasesAsync()])
      .then(([clinicsResult, casesResult]) => {
        if (!active) return
        setRemoteClinics(clinicsResult)
        setRemoteCases(casesResult as Case[])
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar clinicas.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const sourceClinics = DATA_MODE === 'firebase' ? remoteClinics : db.clinics
  const sourceCases = DATA_MODE === 'firebase' ? remoteCases : db.cases

  const clinics = useMemo<ClinicListItem[]>(
    () =>
      sourceClinics
        .filter((clinic) => !clinic.deletedAt)
        .map((clinic) => ({
          id: clinic.id,
          name: clinic.tradeName,
          cnpj: clinic.cnpj ?? '-',
          city: clinic.address?.city ?? '-',
          state: clinic.address?.state ?? '-',
          plan: 'professional',
          status: clinic.isActive ? 'active' : 'suspended',
          users_count: DATA_MODE === 'firebase' ? 0 : db.users.filter((user) => user.linkedClinicId === clinic.id).length,
          cases_count: sourceCases.filter((caseItem) => caseItem.clinicId === clinic.id).length,
          created_at: new Date(clinic.createdAt),
        })),
    [db.users, sourceCases, sourceClinics],
  )

  return (
    <AppShell breadcrumb={['Clinicas']}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Clinicas</h1>
          <p className="mt-1 text-sm text-slate-600">Gestao multi-clinica para administradores master.</p>
        </div>
        {canWrite ? (
          <Button onClick={() => navigate('/app/clinics/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Nova clinica
          </Button>
        ) : null}
      </div>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <ClinicsTable clinics={clinics} loading={loading} />
    </AppShell>
  )
}
