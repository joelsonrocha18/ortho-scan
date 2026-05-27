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
import { listPatientsAsync } from '../../../repo/patientRepo'
import type { Case } from '../../../types/Case'
import type { DentistClinic } from '../../../types/DentistClinic'
import type { Patient } from '../../../types/Patient'
import PatientsTable, { type PatientListItem } from './components/PatientsTable'

export default function PatientsPageContainer() {
  const { db } = useDb()
  const navigate = useNavigate()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'patients.write')
  const [remotePatients, setRemotePatients] = useState<Patient[]>([])
  const [remoteCases, setRemoteCases] = useState<Case[]>([])
  const [remoteDentists, setRemoteDentists] = useState<DentistClinic[]>([])
  const [loading, setLoading] = useState(DATA_MODE === 'firebase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (DATA_MODE !== 'firebase') return undefined
    let active = true
    setLoading(true)
    setError(null)

    void Promise.all([
      listPatientsAsync({ includeDeleted: false }),
      listCasesAsync(),
      listDentistsAsync({ includeDeleted: false, includeInactive: true }),
    ])
      .then(([patientsResult, casesResult, dentistsResult]) => {
        if (!active) return
        setRemotePatients(patientsResult)
        setRemoteCases(casesResult as Case[])
        setRemoteDentists(dentistsResult)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar pacientes.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const sourcePatients = DATA_MODE === 'firebase' ? remotePatients : db.patients
  const sourceCases = DATA_MODE === 'firebase' ? remoteCases : db.cases
  const sourceDentists = DATA_MODE === 'firebase' ? remoteDentists : db.dentists

  const patients = useMemo<PatientListItem[]>(() => {
    const dentistsById = new Map(sourceDentists.map((dentist) => [dentist.id, dentist.name]))
    const casesByPatient = new Map(sourceCases.map((caseItem) => [caseItem.patientId ?? '', caseItem]))

    return sourcePatients
      .filter((patient) => !patient.deletedAt)
      .map((patient) => {
        const activeCase = casesByPatient.get(patient.id)
        const portalFields = patient as Patient & { portal_enabled?: boolean; current_tray?: number }
        return {
          id: patient.id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone ?? patient.whatsapp ?? '-',
          cpf: patient.cpf,
          dentist_id: patient.primaryDentistId ?? '',
          dentist_name: dentistsById.get(patient.primaryDentistId ?? '') ?? 'Nao informado',
          active_case: activeCase ? { id: activeCase.id, status: activeCase.status } : undefined,
          portal_enabled: Boolean(portalFields.portal_enabled),
          current_tray: portalFields.current_tray,
          total_trays: activeCase?.totalTrays,
          created_at: new Date(patient.createdAt),
        }
      })
  }, [sourceCases, sourceDentists, sourcePatients])

  return (
    <AppShell breadcrumb={['Pacientes']}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Pacientes</h1>
          <p className="mt-1 text-sm text-slate-600">Lista aprimorada com busca, portal e vinculo com casos ativos.</p>
        </div>
        {canWrite ? (
          <Button onClick={() => navigate('/app/patients/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Novo paciente
          </Button>
        ) : null}
      </div>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <PatientsTable patients={patients} loading={loading} />
    </AppShell>
  )
}
