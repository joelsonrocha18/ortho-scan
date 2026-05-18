import { useEffect, useRef, useState } from 'react'
import Button from '../../../../components/Button'
import Card from '../../../../components/Card'
import { cn } from '../../../../lib/cn'
import type { ChangeScheduleRow } from '../../../../lib/alignerChange'
import { formatPtBrDate, formatPtBrDateTime } from '../../../../shared/utils/date'
import type { CaseTray, TrayState } from '../../../../types/Case'
import type { LabItem } from '../../../../types/Lab'
import { CaseTrayStateLegend } from '../components/CaseTrayStateLegend'
import { isReworkProductionLabItem } from '../lib/caseDetailPresentation'

type CaseTrayTimelineSectionProps = {
  trays: CaseTray[]
  changeSchedule: ChangeScheduleRow[]
  linkedLabItems: LabItem[]
  patientPortalPhotosByTray: Map<
    number,
    {
      documentId: string
      title: string
      capturedAt?: string
      sentAt?: string
      deviceLabel?: string
      previewUrl?: string
      note?: string
      fileName?: string
      filePath?: string
    }
  >
  todayIso: string
  canManageTray: boolean
  canEditActualDates: boolean
  hasUpperArch: boolean
  hasLowerArch: boolean
  actualUpperByTray: Map<number, string>
  actualLowerByTray: Map<number, string>
  onOpenTrayModal: (tray: CaseTray) => void
  onSaveTrayDueDate: (trayNumber: number, dueDate: string) => void
  onSaveActualChangeDate: (arch: 'superior' | 'inferior', trayNumber: number, changedAt: string) => void
  onDownloadPatientPhoto: (input: { trayNumber: number; previewUrl?: string; filePath?: string; fileName?: string }) => void
}

const trayStatusChipClasses: Record<TrayState | 'nao_aplica', string> = {
  pendente: 'border-slate-300 bg-slate-50 text-slate-700',
  em_producao: 'border-blue-200 bg-blue-50 text-blue-700',
  pronta: 'border-brand-200 bg-baby-50 text-brand-700',
  entregue: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rework: 'border-rose-200 bg-rose-50 text-rose-700',
  nao_aplica: 'border-slate-200 bg-slate-50 text-slate-400',
}

function statusLabel(state: TrayState | 'nao_aplica') {
  if (state === 'nao_aplica') return 'Não se aplica'
  if (state === 'em_producao') return 'Em produção'
  if (state === 'pronta') return 'Pronta'
  if (state === 'entregue') return 'Entregue'
  if (state === 'rework') return 'Reconfecção'
  return 'Pendente'
}

function overallStatus(row: ChangeScheduleRow) {
  const states = [row.superiorState, row.inferiorState]
  if (states.includes('rework')) return 'rework'
  if (states.includes('em_producao')) return 'em_producao'
  if (states.includes('pronta')) return 'pronta'
  if (states.includes('entregue')) return 'entregue'
  return 'pendente'
}

function formatDateLine(label: string, value?: string) {
  return `${label}: ${value ? formatPtBrDate(value) : '-'}`
}

function metadataChip(label: string, value?: string) {
  return {
    label,
    value: value?.trim() ? value : '-',
  }
}

function resolvePlannedDate(row: ChangeScheduleRow, tray?: CaseTray) {
  return row.upperPlannedDate ?? row.lowerPlannedDate ?? tray?.dueDate ?? row.changeDate ?? ''
}

type EditableDateFieldProps = {
  label: string
  value?: string
  canEdit: boolean
  required?: boolean
  onSave?: (value: string) => void
}

function EditableDateField({ label, value, canEdit, required = false, onSave }: EditableDateFieldProps) {
  const normalizedValue = value ?? ''
  const [draft, setDraft] = useState(normalizedValue)

  useEffect(() => {
    setDraft(normalizedValue)
  }, [normalizedValue])

  const dirty = draft !== normalizedValue
  const canSubmit = dirty && (!required || draft.trim().length > 0)

  return (
    <div className="mt-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4A5568]">{label}</span>
      {canEdit ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#1A202C] outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <Button
            size="sm"
            variant={canSubmit ? 'primary' : 'secondary'}
            disabled={!canSubmit}
            onClick={() => onSave?.(draft)}
          >
            Salvar
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold text-[#1A202C]">{value ? formatPtBrDate(value) : '-'}</p>
      )}
    </div>
  )
}

export function CaseTrayTimelineSection({
  trays,
  changeSchedule,
  linkedLabItems,
  patientPortalPhotosByTray,
  todayIso,
  canManageTray,
  canEditActualDates,
  hasUpperArch,
  hasLowerArch,
  actualUpperByTray,
  actualLowerByTray,
  onOpenTrayModal,
  onSaveTrayDueDate,
  onSaveActualChangeDate,
  onDownloadPatientPhoto,
}: CaseTrayTimelineSectionProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState<{
    title: string
    url: string
    fileName?: string
  } | null>(null)
  const dragStateRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)

  const rows = changeSchedule.length
    ? changeSchedule
    : trays
      .slice()
      .sort((left, right) => left.trayNumber - right.trayNumber)
      .map((tray) => ({
        trayNumber: tray.trayNumber,
        changeDate: tray.dueDate ?? '',
        upperPlannedDate: tray.dueDate,
        lowerPlannedDate: tray.dueDate,
        upperChangeDate: actualUpperByTray.get(tray.trayNumber) ?? tray.dueDate,
        lowerChangeDate: actualLowerByTray.get(tray.trayNumber) ?? tray.dueDate,
        superiorState: tray.state,
        inferiorState: tray.state,
      }))

  const scrollByAmount = (direction: 'left' | 'right') => {
    const container = scrollRef.current
    if (!container) return
    const amount = Math.max(320, Math.floor(container.clientWidth * 0.72))
    container.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, textarea, select, label, a')) return
    const container = scrollRef.current
    if (!container) return
    dragStateRef.current = { startX: event.clientX, startScrollLeft: container.scrollLeft }
    setIsDragging(true)
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const container = scrollRef.current
    const dragState = dragStateRef.current
    if (!container || !dragState) return
    const deltaX = event.clientX - dragState.startX
    container.scrollLeft = dragState.startScrollLeft - deltaX
  }

  const stopDragging = () => {
    dragStateRef.current = null
    setIsDragging(false)
  }

  return (
    <section className="mt-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Cards de troca</h2>
            <p className="mt-1 text-sm text-slate-500">Datas, status, foto do paciente e reconfecção.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => scrollByAmount('left')}>
              Voltar
            </Button>
            <Button variant="secondary" size="sm" onClick={() => scrollByAmount('right')}>
              Avançar
            </Button>
          </div>
        </div>
        <CaseTrayStateLegend />

        <div
          ref={scrollRef}
          className={cn(
            'mt-5 overflow-x-auto pb-2 select-none snap-x snap-mandatory',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
        >
          <div className="flex min-w-max items-stretch gap-4">
            {rows.map((row, index) => {
              const tray = trays.find((item) => item.trayNumber === row.trayNumber)
              const plannedDate = resolvePlannedDate(row, tray)
              const reworkOrders = linkedLabItems.filter(
                (item) =>
                  item.trayNumber === row.trayNumber &&
                  ((item.requestKind ?? 'producao') === 'reconfeccao' || isReworkProductionLabItem(item) || item.stage === 'rework'),
              )
              const hasRework = row.superiorState === 'rework' || row.inferiorState === 'rework' || reworkOrders.length > 0
              const status = hasRework ? 'rework' : overallStatus(row)
              const actualUpper = actualUpperByTray.get(row.trayNumber)
              const actualLower = actualLowerByTray.get(row.trayNumber)
              const patientPhoto = patientPortalPhotosByTray.get(row.trayNumber)
              const photoPending = !patientPhoto && Boolean((actualUpper || actualLower || row.changeDate) && (actualUpper || actualLower || row.changeDate) <= todayIso)

              return (
                <div key={row.trayNumber} className="flex items-center gap-4">
                  {index > 0 ? <div className="h-[2px] w-8 rounded-full bg-slate-200" aria-hidden="true" /> : null}
                  <article
                    className={cn(
                      'w-[328px] snap-start rounded-3xl border bg-white p-4 shadow-sm transition',
                      canManageTray ? 'hover:-translate-y-0.5 hover:shadow-md' : '',
                      hasRework ? 'border-rose-200' : 'border-slate-300',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4A5568]">
                          Alinhador #{row.trayNumber}
                        </p>
                        <EditableDateField
                          label="Prevista"
                          value={plannedDate}
                          canEdit={canManageTray}
                          required
                          onSave={(value) => onSaveTrayDueDate(row.trayNumber, value)}
                        />
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${trayStatusChipClasses[status]}`}>
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-2">
                      {hasUpperArch ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4A5568]">Superior</span>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">{formatDateLine('Prevista', row.upperPlannedDate)}</p>
                          <EditableDateField
                            label="Real"
                            value={actualUpper}
                            canEdit={canEditActualDates}
                            onSave={(value) => onSaveActualChangeDate('superior', row.trayNumber, value)}
                          />
                        </div>
                      ) : null}

                      {hasLowerArch ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4A5568]">Inferior</span>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">{formatDateLine('Prevista', row.lowerPlannedDate)}</p>
                          <EditableDateField
                            label="Real"
                            value={actualLower}
                            canEdit={canEditActualDates}
                            onSave={(value) => onSaveActualChangeDate('inferior', row.trayNumber, value)}
                          />
                        </div>
                      ) : null}
                    </div>

                    {reworkOrders.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">Reconfecção</p>
                          <span className="rounded-full border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700">
                            Reconfeccao
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-rose-900">
                          {reworkOrders.length === 1 ? '1 reconfecção vinculada' : `${reworkOrders.length} reconfecções vinculadas`}
                        </p>
                        <p className="mt-1 text-xs text-rose-700">
                          {reworkOrders.map((item) => item.requestCode ?? item.id).join(' • ')}
                        </p>
                      </div>
                    ) : null}

                    {patientPhoto ? (
                      <div className="mt-4 rounded-[24px] border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-baby-50 px-3 py-3 shadow-[0_12px_30px_-26px_rgba(6,182,212,0.55)]">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-800">Foto do paciente</p>
                          <span className="rounded-full border border-cyan-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-800">
                            Recebida
                          </span>
                        </div>
                        <div className="mt-3 overflow-hidden rounded-[22px] border border-cyan-100 bg-slate-950/95">
                          {patientPhoto.previewUrl ? (
                            <div className="relative aspect-[4/3]">
                              <img
                                src={patientPhoto.previewUrl}
                                alt={`Foto enviada pelo paciente no alinhador #${row.trayNumber}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent px-3 py-3">
                                <span className="text-xs font-semibold text-white/90">Selfie clínica vinculada</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    setSelectedPreview({
                                      title: patientPhoto.title,
                                      url: patientPhoto.previewUrl ?? '',
                                      fileName: patientPhoto.fileName,
                                    })
                                  }
                                >
                                  Tela grande
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm font-semibold text-cyan-50">
                              Foto enviada pelo paciente
                            </div>
                          )}
                        </div>
                        <div className="mt-3">
                          <p className="text-sm font-semibold text-[#1A202C]">{patientPhoto.title}</p>
                          {patientPhoto.note?.trim() ? (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600">{patientPhoto.note}</p>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[metadataChip('Troca em', patientPhoto.capturedAt ? formatPtBrDate(patientPhoto.capturedAt) : undefined), metadataChip('Registro', patientPhoto.sentAt ? formatPtBrDateTime(patientPhoto.sentAt) : undefined), metadataChip('Dispositivo', patientPhoto.deviceLabel)].map((item) => (
                            <div
                              key={`${row.trayNumber}-${item.label}`}
                              className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-[11px] leading-tight"
                            >
                              <span className="font-semibold text-cyan-800">{item.label}:</span>{' '}
                              <span className="text-slate-700">{item.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              onDownloadPatientPhoto({
                                trayNumber: row.trayNumber,
                                previewUrl: patientPhoto.previewUrl,
                                filePath: patientPhoto.filePath,
                                fileName: patientPhoto.fileName,
                              })
                            }
                          >
                            Baixar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className={cn(
                        'mt-4 rounded-[24px] border px-3 py-3',
                        photoPending ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50',
                      )}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn(
                            'text-xs font-semibold uppercase tracking-[0.14em]',
                            photoPending ? 'text-amber-800' : 'text-slate-600',
                          )}>
                            Foto do paciente
                          </p>
                          <span className={cn(
                            'rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]',
                            photoPending ? 'border-amber-200 bg-white text-amber-800' : 'border-slate-200 bg-white text-slate-600',
                          )}>
                            {photoPending ? 'Pendente' : 'Aguardando'}
                          </span>
                        </div>
                        <p className={cn(
                          'mt-2 text-sm font-semibold',
                          photoPending ? 'text-amber-900' : 'text-slate-700',
                        )}>
                          {photoPending ? 'Pendência de foto' : 'Foto aguardando envio'}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {photoPending
                            ? 'Sem foto confirmada para este alinhador.'
                            : 'Aguardando envio do paciente.'}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <div className={cn(
                            'rounded-full border px-3 py-1.5 text-[11px] leading-tight',
                            photoPending ? 'border-amber-200 bg-white text-amber-900' : 'border-slate-200 bg-white text-slate-700',
                          )}>
                            <span className="font-semibold">Base:</span>{' '}
                            {(actualUpper || actualLower || row.changeDate)
                              ? formatPtBrDate(actualUpper || actualLower || row.changeDate)
                              : '-'}
                          </div>
                          <div className={cn(
                            'rounded-full border px-3 py-1.5 text-[11px] leading-tight',
                            photoPending ? 'border-amber-200 bg-white text-amber-900' : 'border-slate-200 bg-white text-slate-700',
                          )}>
                            <span className="font-semibold">Status:</span>{' '}
                            {photoPending ? 'Aguardando confirmação do paciente' : 'Fora da janela esperada'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        {tray?.notes?.trim() ? `Observações: ${tray.notes}` : 'Sem observações clínicas.'}
                      </div>
                      {tray ? (
                        <Button
                          size="sm"
                          variant={canManageTray ? 'primary' : 'secondary'}
                          disabled={!canManageTray}
                          onClick={canManageTray ? () => onOpenTrayModal(tray) : undefined}
                        >
                          {canManageTray ? 'Abrir placa' : 'Somente leitura'}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                </div>
              )
            })}
          </div>
        </div>

        {selectedPreview ? (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 px-4 py-6">
            <div className="w-full max-w-5xl rounded-3xl bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{selectedPreview.title}</h3>
                  {selectedPreview.fileName ? (
                    <p className="mt-1 text-sm text-slate-500">{selectedPreview.fileName}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onDownloadPatientPhoto({
                        trayNumber: 0,
                        previewUrl: selectedPreview.url,
                        fileName: selectedPreview.fileName,
                      })
                    }
                  >
                    Baixar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelectedPreview(null)}>
                    Fechar
                  </Button>
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-3xl bg-slate-950">
                <img
                  src={selectedPreview.url}
                  alt={selectedPreview.title}
                  className="max-h-[78vh] w-full object-contain"
                />
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  )
}
