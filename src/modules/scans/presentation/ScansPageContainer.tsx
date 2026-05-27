import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useToast } from '../../../app/ToastProvider'
import { can } from '../../../auth/permissions'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import { DATA_MODE } from '../../../data/dataMode'
import { createScanAsync, listScansAsync } from '../../../data/scanRepo'
import AppShell from '../../../layouts/AppShell'
import { getCurrentUser } from '../../../lib/auth'
import { useDb } from '../../../lib/useDb'
import { listPatientsAsync } from '../../../repo/patientRepo'
import { listClinicsAsync } from '../../../repo/clinicRepo'
import { listDentistsAsync } from '../../../data/dentistRepo'
import FilePreviewModal from '../../../shared/components/FilePreviewModal'
import type { Clinic } from '../../../types/Clinic'
import type { DentistClinic } from '../../../types/DentistClinic'
import type { Patient } from '../../../types/Patient'
import type { Scan, ScanArch } from '../../../types/Scan'
import ScanGallery, { scanAttachmentToItem, type ScanItem } from './components/ScanGallery'
import ScanUploader from './components/ScanUploader'

type NewScanForm = {
  patientId: string
  patientName: string
  dentistId: string
  clinicId: string
  scanDate: string
  arch: ScanArch
  complaint: string
  dentistGuidance: string
  notes: string
}

type NewScanModalProps = {
  patients: Patient[]
  dentists: DentistClinic[]
  clinics: Clinic[]
  onClose: () => void
  onSubmit: (payload: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
}

const selectClassName = 'h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const textareaClassName = 'w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function NewScanModal({ patients, dentists, clinics, onClose, onSubmit }: NewScanModalProps) {
  const [form, setForm] = useState<NewScanForm>({
    patientId: '',
    patientName: '',
    dentistId: '',
    clinicId: '',
    scanDate: new Date().toISOString().slice(0, 10),
    arch: 'ambos',
    complaint: '',
    dentistGuidance: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activeDentists = useMemo(
    () => dentists.filter((dentist) => dentist.type === 'dentista' && !dentist.deletedAt && dentist.isActive !== false),
    [dentists],
  )
  const activeClinics = useMemo(
    () => clinics.filter((clinic) => !clinic.deletedAt && clinic.isActive !== false),
    [clinics],
  )

  const updatePatient = (patientId: string) => {
    const patient = patients.find((item) => item.id === patientId)
    setForm((current) => ({
      ...current,
      patientId,
      patientName: patient?.name ?? current.patientName,
      dentistId: patient?.primaryDentistId ?? current.dentistId,
      clinicId: patient?.clinicId ?? current.clinicId,
    }))
  }

  const updateDentist = (dentistId: string) => {
    const dentist = dentists.find((item) => item.id === dentistId)
    setForm((current) => ({
      ...current,
      dentistId,
      clinicId: current.clinicId || dentist?.clinicId || '',
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.patientName.trim()) {
      setError('Informe o paciente do exame.')
      return
    }
    if (!form.scanDate) {
      setError('Informe a data do exame.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSubmit({
        patientName: form.patientName.trim(),
        patientId: form.patientId || undefined,
        dentistId: form.dentistId || undefined,
        requestedByDentistId: form.dentistId || undefined,
        clinicId: form.clinicId || undefined,
        scanDate: form.scanDate,
        arch: form.arch,
        complaint: form.complaint.trim() || undefined,
        dentistGuidance: form.dentistGuidance.trim() || undefined,
        notes: form.notes.trim() || undefined,
        attachments: [],
        status: 'pendente',
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel criar o exame.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Novo exame</h2>
            <p className="mt-1 text-sm text-slate-600">Cadastre o exame com os dados do paciente. Arquivos podem ser anexados depois.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar cadastro de exame">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Paciente cadastrado</label>
            <select value={form.patientId} onChange={(event) => updatePatient(event.target.value)} className={selectClassName}>
              <option value="">Selecionar ou digitar abaixo</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nome do paciente *</label>
            <Input
              value={form.patientName}
              onChange={(event) => setForm((current) => ({ ...current, patientName: event.target.value, patientId: '' }))}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Dentista</label>
            <select value={form.dentistId} onChange={(event) => updateDentist(event.target.value)} className={selectClassName}>
              <option value="">Sem dentista</option>
              {activeDentists.map((dentist) => (
                <option key={dentist.id} value={dentist.id}>
                  {dentist.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Clinica</label>
            <select value={form.clinicId} onChange={(event) => setForm((current) => ({ ...current, clinicId: event.target.value }))} className={selectClassName}>
              <option value="">Sem clinica</option>
              {activeClinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.tradeName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Data do exame *</label>
            <Input type="date" value={form.scanDate} onChange={(event) => setForm((current) => ({ ...current, scanDate: event.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Arcada</label>
            <select value={form.arch} onChange={(event) => setForm((current) => ({ ...current, arch: event.target.value as ScanArch }))} className={selectClassName}>
              <option value="ambos">Ambas</option>
              <option value="superior">Superior</option>
              <option value="inferior">Inferior</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Queixa principal</label>
            <textarea value={form.complaint} onChange={(event) => setForm((current) => ({ ...current, complaint: event.target.value }))} rows={3} className={textareaClassName} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Orientacao do dentista</label>
            <textarea value={form.dentistGuidance} onChange={(event) => setForm((current) => ({ ...current, dentistGuidance: event.target.value }))} rows={3} className={textareaClassName} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Observacoes internas</label>
            <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} className={textareaClassName} />
          </div>
        </div>

        {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Criar exame
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function ScansPageContainer() {
  const { db, refresh } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'scans.write')
  const [preview, setPreview] = useState<ScanItem | null>(null)
  const [newScanOpen, setNewScanOpen] = useState(false)
  const [remoteScans, setRemoteScans] = useState<Scan[]>([])
  const [remotePatients, setRemotePatients] = useState<Patient[]>([])
  const [remoteDentists, setRemoteDentists] = useState<DentistClinic[]>([])
  const [remoteClinics, setRemoteClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(DATA_MODE === 'firebase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (DATA_MODE !== 'firebase') return undefined
    let active = true
    setLoading(true)
    setError(null)

    void Promise.all([
      listScansAsync(),
      listPatientsAsync({ includeDeleted: false }),
      listDentistsAsync({ includeDeleted: false, includeInactive: true }),
      listClinicsAsync({ includeDeleted: false }),
    ])
      .then(([scansResult, patientsResult, dentistsResult, clinicsResult]) => {
        if (!active) return
        setRemoteScans(scansResult)
        setRemotePatients(patientsResult)
        setRemoteDentists(dentistsResult)
        setRemoteClinics(clinicsResult)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar exames.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const sourceScans = DATA_MODE === 'firebase' ? remoteScans : db.scans
  const sourcePatients = DATA_MODE === 'firebase' ? remotePatients : db.patients
  const sourceDentists = DATA_MODE === 'firebase' ? remoteDentists : db.dentists
  const sourceClinics = DATA_MODE === 'firebase' ? remoteClinics : db.clinics

  const items = useMemo(
    () =>
      sourceScans.flatMap((scan) => {
        if (scan.attachments.length > 0) {
          return scan.attachments.map((attachment) => scanAttachmentToItem(scan.id, scan.patientName, attachment))
        }
        return [{
          id: scan.id,
          type: 'photo_intraoral' as const,
          file_url: '',
          patient_id: scan.patientId ?? scan.id,
          patient_name: scan.patientName,
          case_id: scan.linkedCaseId,
          uploaded_by: 'Equipe',
          uploaded_at: new Date(scan.createdAt),
          file_size_bytes: 0,
          metadata: { scanner_model: scan.serviceOrderCode ?? scan.shortId ?? scan.id },
        }]
      }),
    [sourceScans],
  )

  const handleCreateScan = async (payload: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) => {
    const created = await createScanAsync(payload)
    if (DATA_MODE === 'firebase') {
      setRemoteScans((current) => [created, ...current.filter((scan) => scan.id !== created.id)])
    } else {
      refresh()
    }
    addToast({ type: 'success', title: 'Exame cadastrado', message: `${created.patientName} foi adicionado a lista.` })
  }

  return (
    <AppShell breadcrumb={['Escaneamentos']}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Escaneamentos</h1>
          <p className="mt-1 text-sm text-slate-600">Galeria, upload multiplo e pre-visualizacao de arquivos clinicos.</p>
        </div>
        {canWrite ? (
          <Button onClick={() => setNewScanOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Novo exame
          </Button>
        ) : null}
      </div>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="mb-5">
        <ScanUploader />
      </div>
      <ScanGallery scans={items} loading={loading} onPreview={setPreview} />
      {newScanOpen ? (
        <NewScanModal
          patients={sourcePatients}
          dentists={sourceDentists}
          clinics={sourceClinics}
          onClose={() => setNewScanOpen(false)}
          onSubmit={handleCreateScan}
        />
      ) : null}
      {preview ? <FilePreviewModal file={{ url: preview.file_url, name: preview.patient_name, type: preview.type === '3d_scan' ? '3d' : 'image' }} onClose={() => setPreview(null)} /> : null}
    </AppShell>
  )
}
