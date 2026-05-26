import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import { createEntityId } from '../../../../shared/utils/id'
import type { AgendaEvent } from './CalendarView'

type EventModalProps = {
  open: boolean
  event?: AgendaEvent
  onClose: () => void
  onSave: (event: AgendaEvent) => void
}

const typeColors: Record<AgendaEvent['type'], string> = {
  scan: '#0284c7',
  planning: '#d97706',
  delivery: '#16a34a',
  consultation: '#7c3aed',
  other: '#64748b',
}

function createDraftEvent(): AgendaEvent {
  const start = new Date()
  return {
    id: createEntityId('event'),
    title: '',
    type: 'consultation',
    start,
    end: new Date(start.getTime() + 60 * 60000),
    status: 'scheduled',
    color: typeColors.consultation,
  }
}

export default function EventModal({ open, event, onClose, onSave }: EventModalProps) {
  const [draft, setDraft] = useState<AgendaEvent>(() => event ?? createDraftEvent())

  useEffect(() => {
    if (!open) return
    setDraft(event ?? createDraftEvent())
  }, [event, open])

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold text-slate-950">Evento da agenda</Dialog.Title>
              <Dialog.Description className="text-sm text-slate-600">Crie ou edite consultas, escaneamentos, entregas e planejamentos.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Fechar modal">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Título
              <Input value={draft.title} onChange={(input) => setDraft((current) => ({ ...current, title: input.target.value }))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Tipo
              <select
                value={draft.type}
                onChange={(input) => {
                  const type = input.target.value as AgendaEvent['type']
                  setDraft((current) => ({ ...current, type, color: typeColors[type] }))
                }}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
              >
                <option value="scan">Escaneamento</option>
                <option value="planning">Planejamento</option>
                <option value="delivery">Entrega</option>
                <option value="consultation">Consulta</option>
                <option value="other">Outro</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Início
              <Input type="datetime-local" onChange={(input) => setDraft((current) => ({ ...current, start: new Date(input.target.value) }))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Fim
              <Input type="datetime-local" onChange={(input) => setDraft((current) => ({ ...current, end: new Date(input.target.value) }))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Paciente
              <Input value={draft.patient_name ?? ''} onChange={(input) => setDraft((current) => ({ ...current, patient_name: input.target.value }))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Dentista
              <Input value={draft.dentist_name ?? ''} onChange={(input) => setDraft((current) => ({ ...current, dentist_name: input.target.value }))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              Notas
              <textarea value={draft.notes ?? ''} onChange={(input) => setDraft((current) => ({ ...current, notes: input.target.value }))} className="min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm" />
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(draft)}>Salvar evento</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
