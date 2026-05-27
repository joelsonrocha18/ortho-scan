import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { can } from '../../../auth/permissions'
import Button from '../../../components/Button'
import { listCasesAsync } from '../../../data/caseRepo'
import { DATA_MODE } from '../../../data/dataMode'
import { listDentistsAsync } from '../../../data/dentistRepo'
import AppShell from '../../../layouts/AppShell'
import { getCurrentUser } from '../../../lib/auth'
import { useDb } from '../../../lib/useDb'
import { listClinicsAsync } from '../../../repo/clinicRepo'
import type { Case } from '../../../types/Case'
import type { Clinic } from '../../../types/Clinic'
import type { DentistClinic } from '../../../types/DentistClinic'
import DentistsTable, { type DentistListItem } from './components/DentistsTable'

export default function DentistsPageContainer() {
  const { db } = useDb()
  const navigate = useNavigate()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'dentists.write')
  const [remoteDentists, setRemoteDentists] = useState<DentistClinic[]>([])
  const [remoteClinics, setRemoteClinics] = useState<Clinic[]>([])
  const [remoteCases, setRemoteCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(DATA_MODE === 'firebase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (DATA_MODE !== 'firebase') return undefined
    let active = true
    setLoading(true)
    setError(null)

    void Promise.all([
      listDentistsAsync({ includeDeleted: false, includeInactive: true }),
      listClinicsAsync({ includeDeleted: false }),
      listCasesAsync(),
    ])
      .then(([dentistsResult, clinicsResult, casesResult]) => {
        if (!active) return
        setRemoteDentists(dentistsResult)
        setRemoteClinics(clinicsResult)
        setRemoteCases(casesResult as Case[])
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar dentistas.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const sourceDentists = DATA_MODE === 'firebase' ? remoteDentists : db.dentists
  const sourceClinics = DATA_MODE === 'firebase' ? remoteClinics : db.clinics
  const sourceCases = DATA_MODE === 'firebase' ? remoteCases : db.cases

  const dentists = useMemo<DentistListItem[]>(() => {
    const clinicsById = new Map(sourceClinics.map((clinic) => [clinic.id, clinic.tradeName]))

    return sourceDentists
      .filter((dentist) => dentist.type === 'dentista' && !dentist.deletedAt)
      .map((dentist) => {
        const cases = sourceCases.filter((caseItem) => caseItem.dentistId === dentist.id)
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
  }, [sourceCases, sourceClinics, sourceDentists])

  return (
    <AppShell breadcrumb={['Dentistas']}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Dentistas</h1>
          <p className="mt-1 text-sm text-slate-600">Gestao de parceiros, metricas e acesso ao portal.</p>
        </div>
        {canWrite ? (
          <Button onClick={() => navigate('/app/dentists/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo dentista
          </Button>
        ) : null}
      </div>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <DentistsTable dentists={dentists} loading={loading} />
    </AppShell>
  )
}
