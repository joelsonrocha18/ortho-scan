import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { DATA_MODE } from '../../data/dataMode'
import { buildPhotoSlotsFromItems, loadDevPhotoSlots, mergePhotoSlots } from '../../lib/photoSlots'
import { loadSystemSettings } from '../../lib/systemSettings'
import type { Scan, ScanArch, ScanAttachment } from '../../types/Scan'
import type { PhotoSlot } from '../../types/Scan'
import Button from '../Button'
import Card from '../Card'
import ImageCaptureInput from '../files/ImageCaptureInput'
import Input from '../Input'
import { buildScanAttachmentPath, createSignedUrl, uploadToStorage, validateScanAttachmentFile } from '../../repo/storageRepo'
import { parsePlanningTrayCounts } from '../../lib/archformParser'

type ScanModalProps = {
  open: boolean
  mode: 'create' | 'edit'
  initialScan?: Scan | null
  patients?: Array<{ id: string; name: string; primaryDentistId?: string; clinicId?: string }>
  dentists?: Array<{ id: string; name: string; gender?: 'masculino' | 'feminino'; clinicId?: string }>
  clinics?: Array<{ id: string; name: string }>
  onClose: () => void
  onSubmit: (
    payload: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { setPrimaryDentist?: boolean },
  ) => boolean | void | Promise<boolean | void>
  onPrintServiceOrder?: (payload: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) => void
}

type FormState = {
  purposeProductId?: string
  purposeProductType?: string
  purposeLabel?: string
  patientName: string
  patientId?: string
  dentistId?: string
  requestedByDentistId?: string
  clinicId?: string
  scanDate: string
  arch: ScanArch
  complaint: string
  dentistGuidance: string
  notes: string
  planningDetectedUpperTrays?: number
  planningDetectedLowerTrays?: number
  planningDetectedAt?: string
  planningDetectedSource?: 'keyframes' | 'goalset'
  attachments: ScanAttachment[]
}

const emptyForm: FormState = {
  purposeProductId: undefined,
  purposeProductType: undefined,
  purposeLabel: undefined,
  patientName: '',
  patientId: undefined,
  dentistId: undefined,
  requestedByDentistId: undefined,
  clinicId: undefined,
  scanDate: '',
  arch: 'ambos',
  complaint: '',
  dentistGuidance: '',
  notes: '',
  planningDetectedUpperTrays: undefined,
  planningDetectedLowerTrays: undefined,
  planningDetectedAt: undefined,
  planningDetectedSource: undefined,
  attachments: [],
}

function makeLocalAttachment(
  file: File,
  partial: Pick<ScanAttachment, 'kind' | 'slotId' | 'rxType' | 'arch'>,
): ScanAttachment {
  return {
    id: `scan_file_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: file.name,
    kind: partial.kind,
    slotId: partial.slotId,
    rxType: partial.rxType,
    arch: partial.arch,
    mime: file.type,
    size: file.size,
    url: URL.createObjectURL(file),
    isLocal: true,
    status: 'ok',
    attachedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
}

function statusPill(ok: boolean) {
  return ok
    ? 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
    : 'inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600'
}

function attachmentMetaState(att?: ScanAttachment) {
  if (!att) return null
  if (att.url && att.mime?.startsWith('image/')) return 'preview'
  return 'meta'
}

export default function ScanModal({
  open,
  mode,
  initialScan,
  patients = [],
  dentists = [],
  clinics = [],
  onClose,
  onSubmit,
  onPrintServiceOrder,
}: ScanModalProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const [setPrimaryDentist, setSetPrimaryDentist] = useState(false)
  const [draftId, setDraftId] = useState('')
  const [devPhotoSlots, setDevPhotoSlots] = useState<PhotoSlot[]>([])
  const nonAlignerPurposeOptions = useMemo(() => {
    const settings = loadSystemSettings()
    const active = (settings.priceCatalog ?? []).filter((item) => item.isActive !== false)
    return active
      .filter(
        (item) =>
          item.productType !== 'alinhador_3m' &&
          item.productType !== 'alinhador_6m' &&
          item.productType !== 'alinhador_12m',
      )
      .map((item) => ({ id: item.id, label: item.name, productType: item.productType }))
  }, [])
  const purposeOptions = useMemo(() => {
    const firstNonAligner = nonAlignerPurposeOptions[0]
    return [
      { id: 'alinhador_padrao', label: 'Alinhador', productType: 'alinhador_12m' },
      { id: firstNonAligner?.id ?? 'impressoes_padrao', label: 'Impressões', productType: firstNonAligner?.productType ?? 'biomodelo' },
    ]
  }, [nonAlignerPurposeOptions])

  const isAlignerPurpose = (value?: string) =>
    value === 'alinhador_3m' || value === 'alinhador_6m' || value === 'alinhador_12m'

  const finalityMode: 'alinhador' | 'impressoes' = isAlignerPurpose(form.purposeProductType) ? 'alinhador' : 'impressoes'

  const applyFinalityMode = (mode: 'alinhador' | 'impressoes') => {
    if (mode === 'alinhador') {
      setForm((current) => ({
        ...current,
        purposeProductId: 'alinhador_padrao',
        purposeProductType: 'alinhador_12m',
        purposeLabel: 'Alinhador',
      }))
      return
    }
    const selectedNonAligner =
      nonAlignerPurposeOptions.find((item) => item.id === form.purposeProductId) ?? nonAlignerPurposeOptions[0]
    setForm((current) => ({
      ...current,
      purposeProductId: selectedNonAligner?.id ?? 'impressoes_padrao',
      purposeProductType: selectedNonAligner?.productType ?? 'biomodelo',
      purposeLabel: selectedNonAligner?.label ?? 'Impressões',
    }))
  }

  useEffect(() => {
    if (isAlignerPurpose(form.purposeProductType)) return
    if ((form.purposeProductId && form.purposeProductId !== 'impressoes_padrao') || nonAlignerPurposeOptions.length === 0) return
    const fallback = nonAlignerPurposeOptions[0]
    if (!fallback) return
    setForm((current) => ({
      ...current,
      purposeProductId: fallback.id,
      purposeProductType: fallback.productType,
      purposeLabel: fallback.label,
    }))
  }, [form.purposeProductId, form.purposeProductType, nonAlignerPurposeOptions])

  useEffect(() => {
    if (!open) return

    if (mode === 'edit' && initialScan) {
      setForm({
        purposeProductId: initialScan.purposeProductId ?? purposeOptions[0]?.id,
        purposeProductType: initialScan.purposeProductType ?? purposeOptions[0]?.productType,
        purposeLabel: initialScan.purposeLabel ?? purposeOptions[0]?.label,
        patientName: initialScan.patientName,
        patientId: initialScan.patientId,
        dentistId: initialScan.dentistId,
        requestedByDentistId: initialScan.requestedByDentistId,
        clinicId: initialScan.clinicId,
        scanDate: initialScan.scanDate,
        arch: initialScan.arch,
        complaint: initialScan.complaint ?? '',
        dentistGuidance: initialScan.dentistGuidance ?? '',
        notes: initialScan.notes ?? '',
        planningDetectedUpperTrays: initialScan.planningDetectedUpperTrays,
        planningDetectedLowerTrays: initialScan.planningDetectedLowerTrays,
        planningDetectedAt: initialScan.planningDetectedAt,
        planningDetectedSource: initialScan.planningDetectedSource,
        attachments: initialScan.attachments,
      })
      setError('')
      setSetPrimaryDentist(false)
      return
    }

    setForm({
      ...emptyForm,
      scanDate: new Date().toISOString().slice(0, 10),
      purposeProductId: purposeOptions[0]?.id,
      purposeProductType: purposeOptions[0]?.productType,
      purposeLabel: purposeOptions[0]?.label,
    })
    setError('')
    setSetPrimaryDentist(false)
    setDraftId(`draft_${Date.now()}`)
  }, [open, mode, initialScan, purposeOptions])

  useEffect(() => {
    let active = true
    void loadDevPhotoSlots().then((slots) => {
      if (active) setDevPhotoSlots(slots)
    })
    return () => {
      active = false
    }
  }, [])

  const stlWarning = useMemo(() => {
    const hasSup = form.attachments.some((item) => item.kind === 'scan3d' && item.arch === 'superior')
    const hasInf = form.attachments.some((item) => item.kind === 'scan3d' && item.arch === 'inferior')
    if (form.arch === 'superior' && !hasSup) return 'Falta arquivo 3D superior.'
    if (form.arch === 'inferior' && !hasInf) return 'Falta arquivo 3D inferior.'
    if (form.arch === 'ambos' && (!hasSup || !hasInf)) return 'Falta arquivo 3D superior e/ou inferior.'
    return ''
  }, [form.arch, form.attachments])

  const availablePhotoSlots = useMemo(
    () => mergePhotoSlots(buildPhotoSlotsFromItems(form.attachments), devPhotoSlots),
    [devPhotoSlots, form.attachments],
  )
  const intraSlots = useMemo(
    () => availablePhotoSlots.filter((slot) => slot.kind === 'foto_intra'),
    [availablePhotoSlots],
  )
  const extraSlots = useMemo(
    () => availablePhotoSlots.filter((slot) => slot.kind === 'foto_extra'),
    [availablePhotoSlots],
  )

  useEffect(() => {
    if (!form.patientId || !form.dentistId) return
    const patient = patients.find((item) => item.id === form.patientId)
    if (!patient) return
    if (!patient.primaryDentistId) {
      setSetPrimaryDentist(true)
    }
  }, [form.patientId, form.dentistId, patients])

  if (!open) return null

  const buildAttachment = async (
    file: File,
    partial: Pick<ScanAttachment, 'kind' | 'slotId' | 'rxType' | 'arch'>,
  ): Promise<ScanAttachment | null> => {
    const valid = validateScanAttachmentFile(file, partial.kind)
    if (!valid.ok) {
      setError(valid.error)
      return null
    }
    if (DATA_MODE !== 'supabase') return makeLocalAttachment(file, partial)
    if (!form.clinicId) return makeLocalAttachment(file, partial)

    const scanId = mode === 'edit' && initialScan ? initialScan.id : draftId || 'draft_upload'
    const filePath = buildScanAttachmentPath({
      clinicId: form.clinicId,
      scanId,
      patientId: form.patientId,
      kind: partial.kind,
      fileName: file.name,
    })
    const upload = await uploadToStorage(filePath, file)
    if (!upload.ok) {
      setError(upload.error)
      return null
    }
    const signed = await createSignedUrl(filePath, 300)
    return {
      ...makeLocalAttachment(file, partial),
      url: signed.ok ? signed.url : undefined,
      filePath,
      isLocal: false,
    }
  }

  const setSingle = async (file: File, partial: Pick<ScanAttachment, 'kind' | 'slotId' | 'rxType' | 'arch'>) => {
    const nextAttachment = await buildAttachment(file, partial)
    if (!nextAttachment) return
    setForm((current) => ({
      ...current,
      attachments: [
        ...current.attachments.filter(
          (item) =>
            !(
              item.kind === partial.kind &&
              item.slotId === partial.slotId &&
              item.rxType === partial.rxType &&
              item.arch === partial.arch
            ),
        ),
        nextAttachment,
      ],
    }))
  }

  const addMany = async (files: FileList, partial: Pick<ScanAttachment, 'kind' | 'slotId' | 'rxType' | 'arch'>) => {
    let detectedUpper: number | undefined
    let detectedLower: number | undefined
    let detectedSource: 'keyframes' | 'goalset' | undefined
    let hasArchform = false
    if (partial.kind === 'projeto') {
      for (const file of Array.from(files)) {
        if (file.name.toLowerCase().endsWith('.archform')) hasArchform = true
        const detected = await parsePlanningTrayCounts(file)
        if (!detected) continue
        if (detected.upper && (!detectedUpper || detected.upper > detectedUpper)) detectedUpper = detected.upper
        if (detected.lower && (!detectedLower || detected.lower > detectedLower)) detectedLower = detected.lower
        detectedSource = detected.source
      }
      if (!detectedUpper && !detectedLower && hasArchform) {
        if (form.arch !== 'inferior') detectedUpper = 15
        if (form.arch !== 'superior') detectedLower = 15
      }
    }

    const nextWithNull = await Promise.all(Array.from(files).map((file) => buildAttachment(file, partial)))
    const next = nextWithNull.filter((item): item is ScanAttachment => Boolean(item))
    if (next.length === 0) return
    setForm((current) => ({
      ...current,
      attachments: [...current.attachments, ...next],
      planningDetectedUpperTrays: detectedUpper ?? current.planningDetectedUpperTrays,
      planningDetectedLowerTrays: detectedLower ?? current.planningDetectedLowerTrays,
      planningDetectedAt:
        detectedUpper || detectedLower ? new Date().toISOString() : current.planningDetectedAt,
      planningDetectedSource: detectedSource ?? current.planningDetectedSource,
    }))
  }

  const remove = (id: string) => {
    setForm((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== id) }))
  }

  const submit = async () => {
    if (!form.patientName.trim() || !form.scanDate) {
      setError('Paciente e data do scan sao obrigatorios.')
      return
    }
    if (!form.purposeProductId || !form.purposeLabel) {
      setError('Cadastre pelo menos um produto ativo na Politica de preco para definir a finalidade do exame.')
      return
    }

    const payload: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'> = {
      purposeProductId: form.purposeProductId,
      purposeProductType: form.purposeProductType,
      purposeLabel: form.purposeLabel,
      patientName: form.patientName.trim(),
      patientId: form.patientId,
      dentistId: form.dentistId,
      requestedByDentistId: form.requestedByDentistId,
      clinicId: form.clinicId,
      scanDate: form.scanDate,
      arch: form.arch,
      complaint: form.complaint.trim() || undefined,
      dentistGuidance: form.dentistGuidance.trim() || undefined,
      notes: form.notes.trim() || undefined,
      planningDetectedUpperTrays: form.planningDetectedUpperTrays,
      planningDetectedLowerTrays: form.planningDetectedLowerTrays,
      planningDetectedAt: form.planningDetectedAt,
      planningDetectedSource: form.planningDetectedSource,
      attachments: form.attachments,
      status: mode === 'edit' && initialScan ? initialScan.status : 'pendente',
      linkedCaseId: mode === 'edit' && initialScan ? initialScan.linkedCaseId : undefined,
    }

    const saved = await onSubmit(payload, { setPrimaryDentist })
    if (saved !== false) {
      onClose()
    }
  }

  const printServiceOrder = () => {
    if (!onPrintServiceOrder) return
    if (!form.patientName.trim() || !form.scanDate) {
      setError('Paciente e data do scan sao obrigatorios para imprimir a O.S.')
      return
    }
    if (!form.purposeProductId || !form.purposeLabel) {
      setError('Cadastre pelo menos um produto ativo na Politica de preco para definir a finalidade do exame.')
      return
    }
    setError('')
    onPrintServiceOrder({
      purposeProductId: form.purposeProductId,
      purposeProductType: form.purposeProductType,
      purposeLabel: form.purposeLabel,
      patientName: form.patientName.trim(),
      patientId: form.patientId,
      dentistId: form.dentistId,
      requestedByDentistId: form.requestedByDentistId,
      clinicId: form.clinicId,
      scanDate: form.scanDate,
      arch: form.arch,
      complaint: form.complaint.trim() || undefined,
      dentistGuidance: form.dentistGuidance.trim() || undefined,
      notes: form.notes.trim() || undefined,
      planningDetectedUpperTrays: form.planningDetectedUpperTrays,
      planningDetectedLowerTrays: form.planningDetectedLowerTrays,
      planningDetectedAt: form.planningDetectedAt,
      planningDetectedSource: form.planningDetectedSource,
      attachments: form.attachments,
      status: mode === 'edit' && initialScan ? initialScan.status : 'pendente',
      linkedCaseId: mode === 'edit' && initialScan ? initialScan.linkedCaseId : undefined,
    })
  }

  const bySlot = (slotId: string) => form.attachments.find((item) => item.slotId === slotId)
  const scanByArch = (arch: 'superior' | 'inferior' | 'mordida') =>
    form.attachments.find((item) => item.kind === 'scan3d' && item.arch === arch)
  const rxByType = (rxType: 'panoramica' | 'teleradiografia' | 'tomografia') =>
    form.attachments.filter((item) => item.rxType === rxType)
  const projeto = form.attachments.filter((item) => item.kind === 'projeto')

  const filePicker = (
    label: string,
    accept: string,
    onPick: (event: ChangeEvent<HTMLInputElement>) => void,
    secondary = false,
  ) => (
    <label
      className={`inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-xs font-semibold transition ${
        secondary ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-brand-500 text-white hover:bg-brand-700'
      }`}
    >
      {label}
      <input type="file" className="hidden" accept={accept} onChange={onPick} />
    </label>
  )

  const renderAttachmentRow = (att: ScanAttachment, showRemove = true) => (
    <div key={att.id} className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-slate-900">{att.name}</p>
          <p className="text-xs text-slate-500">{new Date(att.createdAt).toLocaleDateString('pt-BR')}</p>
        </div>
        {showRemove ? (
          <button type="button" className="text-xs font-semibold text-red-600" onClick={() => remove(att.id)}>
            Remover
          </button>
        ) : null}
      </div>
      {att.url && att.mime?.startsWith('image/') ? (
        <img src={att.url} alt={att.name} className="mt-2 h-20 w-full rounded-md border border-slate-200 object-cover" />
      ) : (
        <p className="mt-2 text-xs text-slate-500">Arquivo cadastrado (sem preview).</p>
      )}
    </div>
  )

  const renderPhotoSlot = (slot: { id: string; label: string; kind: 'foto_intra' | 'foto_extra' }) => {
    const att = bySlot(slot.id)
    const has = Boolean(att)
    const metaState = attachmentMetaState(att)
    return (
      <div key={slot.id} className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">{slot.label}</p>
          <span className={statusPill(has)}>{has ? 'OK' : 'Falta'}</span>
        </div>

        {att ? (
          <>
            <p className="mt-2 text-sm text-slate-900">{att.name}</p>
            {metaState === 'preview' ? (
              <img src={att.url} alt={att.name} className="mt-2 h-20 w-full rounded-md border border-slate-200 object-cover" />
            ) : (
              <p className="mt-2 text-xs text-slate-500">Arquivo cadastrado (sem preview).</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <ImageCaptureInput
                onFileSelected={(file) => void setSingle(file, { kind: slot.kind, slotId: slot.id })}
                accept="image/*"
              />
              <button type="button" className="text-xs font-semibold text-red-600" onClick={() => remove(att.id)}>
                Remover
              </button>
            </div>
          </>
        ) : (
          <div className="mt-2">
            <ImageCaptureInput
              onFileSelected={(file) => void setSingle(file, { kind: slot.kind, slotId: slot.id })}
              accept="image/*"
            />
          </div>
        )}
      </div>
    )
  }

  const renderScan3dCard = (title: string, arch: 'superior' | 'inferior' | 'mordida') => {
    const att = scanByArch(arch)
    const has = Boolean(att)
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">{title}</p>
          <span className={statusPill(has)}>{has ? 'OK' : 'Falta'}</span>
        </div>
        {att ? (
          <>
            <p className="mt-2 text-sm text-slate-900">{att.name}</p>
            <p className="mt-1 text-xs text-slate-500">Arquivo cadastrado (sem preview).</p>
            <div className="mt-2 flex items-center gap-2">
              {filePicker('Substituir', '.stl,.obj,.ply', (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void setSingle(file, { kind: 'scan3d', arch })
              }, true)}
              <button type="button" className="text-xs font-semibold text-red-600" onClick={() => remove(att.id)}>
                Remover
              </button>
            </div>
          </>
        ) : (
          <div className="mt-2">
            {filePicker('Adicionar', '.stl,.obj,.ply', (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void setSingle(file, { kind: 'scan3d', arch })
            })}
          </div>
        )}
      </div>
    )
  }

  const renderRxCard = (title: string, rxType: 'panoramica' | 'teleradiografia' | 'tomografia', accept: string, hint?: string) => {
    const items = rxByType(rxType)
    const has = items.length > 0
    const kind = rxType === 'tomografia' ? 'dicom' : 'raiox'
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-700">{title}</p>
            {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
          </div>
          <span className={statusPill(has)}>{has ? 'OK' : 'Falta'}</span>
        </div>
        <div className="mt-2 space-y-2">
          {items.length === 0 ? <p className="text-xs text-slate-500">Nenhum arquivo.</p> : items.map((item) => renderAttachmentRow(item))}
        </div>
        <div className="mt-2">
          <label className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white transition hover:bg-brand-700">
            Adicionar
            <input
              type="file"
              className="hidden"
              multiple
              accept={accept}
              onChange={(event) => event.target.files && void addMany(event.target.files, { kind, rxType })}
            />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <Card className="max-h-[90vh] w-full max-w-6xl overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{mode === 'create' ? 'Novo Exame' : 'Editar Exame'}</h2>
            <p className="mt-1 text-sm text-slate-500">Documentacao completa vinculada ao produto selecionado.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Vínculos</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Clínica</label>
              <select
                value={form.clinicId ?? ''}
                onChange={(event) => setForm((c) => ({ ...c, clinicId: event.target.value || undefined }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Sem clinica</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dentista responsável</label>
              <select
                value={form.dentistId ?? ''}
                onChange={(event) => {
                  const value = event.target.value || undefined
                  const dentist = dentists.find((item) => item.id === value)
                  setForm((c) => ({
                    ...c,
                    dentistId: value,
                    clinicId: c.clinicId || dentist?.clinicId,
                  }))
                }}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Selecione</option>
                {dentists.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Solicitante do exame</label>
              <select
                value={form.requestedByDentistId ?? ''}
                onChange={(event) => setForm((c) => ({ ...c, requestedByDentistId: event.target.value || undefined }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                <option value="">Opcional</option>
                {dentists.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Finalidade</label>
              <select
                value={finalityMode}
                onChange={(event) => applyFinalityMode(event.target.value === 'impressoes' ? 'impressoes' : 'alinhador')}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
              >
                {purposeOptions.map((option) => (
                  <option key={option.id} value={option.label === 'Alinhador' ? 'alinhador' : 'impressoes'}>
                    {option.label}
                  </option>
                ))}
              </select>
              {finalityMode === 'impressoes' ? (
                <div className="mt-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Produto (Impressões)</label>
                  <select
                    value={form.purposeProductId ?? ''}
                    onChange={(event) => {
                      const selected = nonAlignerPurposeOptions.find((item) => item.id === event.target.value)
                      setForm((current) => ({
                        ...current,
                        purposeProductId: selected?.id ?? current.purposeProductId,
                        purposeProductType: selected?.productType ?? current.purposeProductType,
                        purposeLabel: selected?.label ?? current.purposeLabel,
                      }))
                    }}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {nonAlignerPurposeOptions.length === 0 ? <option value="">Cadastre produtos na politica de preco</option> : null}
                    {nonAlignerPurposeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            {(() => {
              const dentist = dentists.find((item) => item.id === form.dentistId)
              const requester = dentists.find((item) => item.id === form.requestedByDentistId)
              const clinic = clinics.find((item) => item.id === form.clinicId)
              const dentistPrefix = dentist?.gender === 'feminino' ? 'Dra.' : dentist ? 'Dr.' : ''
              const requesterPrefix = requester?.gender === 'feminino' ? 'Dra.' : requester ? 'Dr.' : ''
              return (
                <>
                  Responsável: {dentist ? `${dentistPrefix} ${dentist.name}` : '-'}
                  {' | '}Clínica: {clinic ? clinic.name : '-'}
                  {requester ? ` | Solicitante: ${requesterPrefix} ${requester.name}` : ''}
                </>
              )
            })()}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Paciente</label>
            <Input
              list="patients-options"
              value={form.patientName}
              onChange={(event) => {
                const inputName = event.target.value
                const matched = patients.find((item) => item.name === inputName)
                setForm((current) => {
                  const currentDentist = dentists.find((item) => item.id === current.dentistId)
                  const patientClinicId = matched?.clinicId
                  const shouldOverrideClinic =
                    patientClinicId &&
                    (!current.clinicId || current.clinicId === currentDentist?.clinicId)
                  return {
                    ...current,
                    patientName: inputName,
                    patientId: matched?.id,
                    clinicId: shouldOverrideClinic ? patientClinicId : current.clinicId,
                  }
                })
                if (matched && !matched.primaryDentistId && form.dentistId) {
                  setSetPrimaryDentist(true)
                } else if (matched && matched.primaryDentistId) {
                  setSetPrimaryDentist(false)
                }
              }}
            />
            <datalist id="patients-options">
              {patients.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Data do scan</label>
            <Input type="date" value={form.scanDate} onChange={(event) => setForm((c) => ({ ...c, scanDate: event.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Arcada</label>
            <select
              value={form.arch}
              onChange={(event) => setForm((c) => ({ ...c, arch: event.target.value as ScanArch }))}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="superior">Caso Superior</option>
              <option value="inferior">Caso Inferior</option>
              <option value="ambos">Ambos</option>
            </select>
          </div>
        </div>

        {form.patientId && form.dentistId && !patients.find((item) => item.id === form.patientId)?.primaryDentistId ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={setPrimaryDentist}
              onChange={(event) => setSetPrimaryDentist(event.target.checked)}
            />
            <span>Definir como responsável do paciente</span>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Queixa do paciente</label>
            <textarea rows={3} value={form.complaint} onChange={(event) => setForm((c) => ({ ...c, complaint: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Orientacao do dentista</label>
            <textarea rows={3} value={form.dentistGuidance} onChange={(event) => setForm((c) => ({ ...c, dentistGuidance: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observações internas</label>
            <textarea rows={3} value={form.notes} onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Scan 3D</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(form.arch === 'superior' || form.arch === 'ambos') && renderScan3dCard('Superior (.stl, .obj, .ply)', 'superior')}
            {(form.arch === 'inferior' || form.arch === 'ambos') && renderScan3dCard('Inferior (.stl, .obj, .ply)', 'inferior')}
            {renderScan3dCard('Mordida (.stl, .obj, .ply)', 'mordida')}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Fotos Intraorais</h3>
          {intraSlots.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{intraSlots.map((slot) => renderPhotoSlot(slot))}</div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Nenhum slot intraoral disponivel neste ambiente.</p>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Fotos Extraorais</h3>
          {extraSlots.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{extraSlots.map((slot) => renderPhotoSlot(slot))}</div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Nenhum slot extraoral disponivel neste ambiente.</p>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Radiografias</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {renderRxCard('Panoramica', 'panoramica', 'image/*,application/pdf')}
            {renderRxCard('Teleradiografia', 'teleradiografia', 'image/*,application/pdf')}
            {renderRxCard('Tomografia', 'tomografia', '.dcm,.zip,application/zip,application/octet-stream,image/*,application/pdf', 'DICOM (.dcm) ou .zip')}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Planejamento</h3>
          <div className="mt-2 space-y-2">
            {projeto.length === 0 ? <p className="text-xs text-slate-500">Nenhum arquivo.</p> : projeto.map((item) => renderAttachmentRow(item))}
          </div>
          {form.planningDetectedUpperTrays || form.planningDetectedLowerTrays ? (
            <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              Quantidade detectada automaticamente: Sup {form.planningDetectedUpperTrays ?? '-'} | Inf {form.planningDetectedLowerTrays ?? '-'}
            </p>
          ) : null}
          <div className="mt-2">
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white transition hover:bg-brand-700">
              Adicionar
              <input type="file" className="hidden" multiple onChange={(event) => event.target.files && void addMany(event.target.files, { kind: 'projeto' })} />
            </label>
          </div>
        </div>

        {stlWarning ? <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{stlWarning}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between gap-2">
          <div>
            {onPrintServiceOrder ? (
              <Button variant="secondary" onClick={printServiceOrder}>
                Imprimir O.S. Escaneamento
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>Salvar Exame</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

