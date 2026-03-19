import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildPhotoSlotsFromItems, loadDevPhotoSlots, mergePhotoSlots } from '../../lib/photoSlots'
import type { Scan, ScanAttachment } from '../../types/Scan'
import type { PhotoSlot } from '../../types/Scan'
import Badge from '../Badge'
import Button from '../Button'
import Card from '../Card'
import ImageCaptureInput from '../files/ImageCaptureInput'
import { createSignedUrl } from '../../repo/storageRepo'

type ScanDetailsModalProps = {
  open: boolean
  scan: Scan | null
  onClose: () => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onCreateCase: (scan: Scan) => void
  onAddAttachment: (
    scanId: string,
    payload: {
      file: File
      kind: ScanAttachment['kind']
      slotId?: string
      rxType?: ScanAttachment['rxType']
      arch?: ScanAttachment['arch']
      attachedAt: string
      note: string
    },
  ) => void
  onFlagAttachmentError: (scanId: string, attachmentId: string, reason: string) => void
  onClearAttachmentError: (scanId: string, attachmentId: string) => void
}

type ScanTab = 'resumo' | 'arquivos' | 'adicionar'
type AddCategory = 'scan3d' | 'foto_intra' | 'foto_extra' | 'raiox' | 'projeto' | 'outro'

function statusTone(status: Scan['status']) {
  if (status === 'aprovado') return 'success' as const
  if (status === 'reprovado') return 'danger' as const
  if (status === 'convertido') return 'info' as const
  return 'neutral' as const
}

function itemStatusTone(status?: 'ok' | 'erro') {
  return status === 'erro'
    ? 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700'
    : 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
}

function fileAvailability(item: ScanAttachment) {
  if (item.filePath) return null
  if (item.isLocal && !item.url) return 'arquivo local (reenvie para abrir)'
  if (!item.url) return 'Arquivo cadastrado (sem link).'
  return null
}

export default function ScanDetailsModal({
  open,
  scan,
  onClose,
  onApprove,
  onReject,
  onCreateCase,
  onAddAttachment,
  onFlagAttachmentError,
  onClearAttachmentError,
}: ScanDetailsModalProps) {
  const [tab, setTab] = useState<ScanTab>('resumo')
  const [category, setCategory] = useState<AddCategory>('scan3d')
  const [slotId, setSlotId] = useState('')
  const [arch, setArch] = useState<ScanAttachment['arch']>('superior')
  const [rxType, setRxType] = useState<ScanAttachment['rxType']>('panoramica')
  const [attachedAt, setAttachedAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [errorModal, setErrorModal] = useState<{ id: string; reason: string } | null>(null)
  const [devPhotoSlots, setDevPhotoSlots] = useState<PhotoSlot[]>([])

  useEffect(() => {
    let active = true
    void loadDevPhotoSlots().then((slots) => {
      if (active) setDevPhotoSlots(slots)
    })
    return () => {
      active = false
    }
  }, [])

  const availablePhotoSlots = useMemo(
    () => mergePhotoSlots(buildPhotoSlotsFromItems(scan?.attachments ?? []), devPhotoSlots),
    [devPhotoSlots, scan?.attachments],
  )
  const intraSlots = useMemo(
    () => availablePhotoSlots.filter((slot) => slot.kind === 'foto_intra'),
    [availablePhotoSlots],
  )
  const extraSlots = useMemo(
    () => availablePhotoSlots.filter((slot) => slot.kind === 'foto_extra'),
    [availablePhotoSlots],
  )

  const grouped = useMemo(() => {
    const files = scan?.attachments ?? []
    return {
      scan3d: {
        superior: files.filter((item) => item.kind === 'scan3d' && item.arch === 'superior'),
        inferior: files.filter((item) => item.kind === 'scan3d' && item.arch === 'inferior'),
        mordida: files.filter((item) => item.kind === 'scan3d' && item.arch === 'mordida'),
      },
      intra: intraSlots.map((slot) => ({ slot, files: files.filter((item) => item.kind === 'foto_intra' && item.slotId === slot.id) })),
      extra: extraSlots.map((slot) => ({ slot, files: files.filter((item) => item.kind === 'foto_extra' && item.slotId === slot.id) })),
      rx: {
        panoramica: files.filter((item) => item.rxType === 'panoramica'),
        teleradiografia: files.filter((item) => item.rxType === 'teleradiografia'),
        tomografia: files.filter((item) => item.rxType === 'tomografia' || item.kind === 'dicom'),
      },
      planejamento: files.filter((item) => item.kind === 'projeto'),
      outros: files.filter((item) => item.kind === 'outro'),
    }
  }, [extraSlots, intraSlots, scan?.attachments])

  if (!open || !scan) return null

  const submitNewAttachment = () => {
    if (!selectedFile) return
    const trimmedNote = note.trim()
    const requiresNote = category !== 'projeto'
    if (requiresNote && !trimmedNote) return

    const payload: {
      file: File
      kind: ScanAttachment['kind']
      slotId?: string
      rxType?: ScanAttachment['rxType']
      arch?: ScanAttachment['arch']
      attachedAt: string
      note: string
    } = {
      file: selectedFile,
      kind: category,
      attachedAt,
      note: trimmedNote || 'Planejamento importado',
    }

    if (category === 'scan3d') payload.arch = arch
    if (category === 'foto_intra' || category === 'foto_extra') payload.slotId = slotId || undefined
    if (category === 'raiox') payload.rxType = rxType
    if (category === 'raiox' && rxType === 'tomografia') payload.kind = 'dicom'

    onAddAttachment(scan.id, payload)
    setSelectedFile(null)
    setNote('')
    onClose()
  }

  const openAttachment = async (item: ScanAttachment) => {
    if (item.filePath) {
      const signed = await createSignedUrl(item.filePath, 300)
      if (!signed.ok) return
      window.open(signed.url, '_blank', 'noreferrer')
      return
    }
    if (item.url) {
      window.open(item.url, '_blank', 'noreferrer')
    }
  }

  const renderFileItem = (item: ScanAttachment) => {
    const attachedDate = item.attachedAt ?? item.createdAt
    const availability = fileAvailability(item)
    return (
      <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-900">{item.name}</p>
            <p className="text-xs text-slate-500">Data: {new Date(attachedDate).toLocaleDateString('pt-BR')}</p>
            <p className="text-xs text-slate-500">Obs: {item.note || '-'}</p>
            {item.status === 'erro' ? (
              <p className="mt-1 text-xs text-red-700">
                Motivo: {item.flaggedReason || '-'} | Em: {item.flaggedAt ? new Date(item.flaggedAt).toLocaleString('pt-BR') : '-'}
              </p>
            ) : null}
          </div>
          <span className={itemStatusTone(item.status)}>{item.status === 'erro' ? 'ERRO' : 'OK'}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {item.url || item.filePath ? (
            <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => void openAttachment(item)}>
              Abrir
            </button>
          ) : (
            <span className="text-xs text-slate-500">{availability}</span>
          )}
          {item.status === 'erro' ? (
            <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => onClearAttachmentError(scan.id, item.id)}>
              Desmarcar erro
            </button>
          ) : (
            <button type="button" className="text-xs font-semibold text-red-700" onClick={() => setErrorModal({ id: item.id, reason: '' })}>
              Marcar como erro
            </button>
          )}
        </div>
      </div>
    )
  }

  const section = (title: string, items: ScanAttachment[]) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</p>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? <p className="text-sm text-slate-500">Nenhum anexo.</p> : items.map(renderFileItem)}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <Card className="max-h-[90vh] w-full max-w-6xl overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Detalhes do Scan</h3>
            <p className="mt-1 text-sm text-slate-500">{scan.patientName}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === 'resumo' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab('resumo')}>
            Resumo
          </button>
          <button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === 'arquivos' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab('arquivos')}>
            Arquivos (Historico)
          </button>
          <button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === 'adicionar' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setTab('adicionar')}>
            Adicionar Anexo
          </button>
        </div>

        {tab === 'resumo' ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <p className="text-sm text-slate-600">Data: {new Date(`${scan.scanDate}T00:00:00`).toLocaleDateString('pt-BR')}</p>
              <p className="text-sm text-slate-600">Arcada: {scan.arch}</p>
              <div className="sm:col-span-2">
                <Badge tone={statusTone(scan.status)}>{scan.status}</Badge>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 p-4">
              <h4 className="text-sm font-semibold text-slate-800">Dados clinicos</h4>
              <p className="mt-1 text-sm text-slate-600">Queixa: {scan.complaint || '-'}</p>
              <p className="mt-1 text-sm text-slate-600">Orientacao: {scan.dentistGuidance || '-'}</p>
              <p className="mt-1 text-sm text-slate-600">Observações: {scan.notes || '-'}</p>
            </div>
          </>
        ) : null}

        {tab === 'arquivos' ? (
          <div className="mt-4 space-y-4">
            {section('Scan 3D - Superior', grouped.scan3d.superior)}
            {section('Scan 3D - Inferior', grouped.scan3d.inferior)}
            {section('Scan 3D - Mordida', grouped.scan3d.mordida)}
            {grouped.intra.map((entry) => section(`Foto Intra - ${entry.slot.label}`, entry.files))}
            {grouped.extra.map((entry) => section(`Foto Extra - ${entry.slot.label}`, entry.files))}
            {section('Radiografia - Panoramica', grouped.rx.panoramica)}
            {section('Radiografia - Teleradiografia', grouped.rx.teleradiografia)}
            {section('Radiografia - Tomografia', grouped.rx.tomografia)}
            {section('Planejamento', grouped.planejamento)}
            {section('Outros', grouped.outros)}
          </div>
        ) : null}

        {tab === 'adicionar' ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Categoria</label>
              <select value={category} onChange={(event) => setCategory(event.target.value as AddCategory)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="scan3d">Scan 3D</option>
                <option value="foto_intra">Foto intraoral</option>
                <option value="foto_extra">Foto extraoral</option>
                <option value="raiox">Radiografia</option>
                <option value="projeto">Planejamento</option>
                <option value="outro">Outro</option>
              </select>
            </div>

            {category === 'scan3d' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Arcada</label>
                <select value={arch} onChange={(event) => setArch(event.target.value as ScanAttachment['arch'])} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <option value="superior">Superior</option>
                  <option value="inferior">Inferior</option>
                  <option value="mordida">Mordida</option>
                </select>
              </div>
            ) : null}

            {category === 'foto_intra' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Slot intraoral</label>
                <select value={slotId} onChange={(event) => setSlotId(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <option value="">Selecione</option>
                  {intraSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {category === 'foto_extra' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Slot extraoral</label>
                <select value={slotId} onChange={(event) => setSlotId(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <option value="">Selecione</option>
                  {extraSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {category === 'raiox' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Tipo de radiografia</label>
                <select value={rxType} onChange={(event) => setRxType(event.target.value as ScanAttachment['rxType'])} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                  <option value="panoramica">Panoramica</option>
                  <option value="teleradiografia">Teleradiografia</option>
                  <option value="tomografia">Tomografia</option>
                </select>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data do anexo</label>
              <input type="date" value={attachedAt} onChange={(event) => setAttachedAt(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {category === 'projeto' ? 'Observacao (opcional)' : 'Observacao (obrigatoria)'}
              </label>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Arquivo</label>
              {category === 'foto_intra' || category === 'foto_extra' ? (
                <ImageCaptureInput
                  accept="image/*"
                  onFileSelected={(file) => setSelectedFile(file)}
                />
              ) : (
                <input type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
              )}
              {selectedFile ? <p className="mt-1 text-xs text-slate-500">Arquivo: {selectedFile.name}</p> : null}
            </div>
            <div>
              <Button onClick={submitNewAttachment} disabled={!selectedFile || (category !== 'projeto' && !note.trim())}>
                Salvar novo anexo
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {scan.status === 'pendente' ? (
            <>
              <Button onClick={() => onApprove(scan.id)}>Aprovar / Finalizar Cadastro</Button>
              <Button variant="secondary" onClick={() => onReject(scan.id)}>
                Reprovar
              </Button>
            </>
          ) : null}
          {scan.status === 'aprovado' ? <Button onClick={() => onCreateCase(scan)}>Criar Caso</Button> : null}
          {scan.status === 'convertido' && scan.linkedCaseId ? (
            <Link to={`/app/cases/${scan.linkedCaseId}`} className="inline-flex h-10 items-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white">
              Abrir Caso
            </Link>
          ) : null}
        </div>
      </Card>

      {errorModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-md">
            <h4 className="text-lg font-semibold text-slate-900">Marcar anexo como erro</h4>
            <p className="mt-1 text-sm text-slate-500">Informe o motivo do erro para auditoria.</p>
            <textarea
              rows={4}
              value={errorModal.reason}
              onChange={(event) => setErrorModal((current) => (current ? { ...current, reason: event.target.value } : null))}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setErrorModal(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!errorModal.reason.trim()}
                onClick={() => {
                  onFlagAttachmentError(scan.id, errorModal.id, errorModal.reason)
                  setErrorModal(null)
                }}
              >
                Confirmar erro
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

