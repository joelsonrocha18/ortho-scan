import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import type { CSSProperties } from 'react'
import { useLabKanban, type KanbanCard, type LabStage } from '../hooks/useLabKanban'

const columns: Array<{ id: LabStage; label: string }> = [
  { id: 'triagem', label: 'Triagem' },
  { id: 'setup', label: 'Setup 3D' },
  { id: 'impressao', label: 'Impressao 3D' },
  { id: 'termoformagem', label: 'Termoformagem' },
  { id: 'acabamento', label: 'Acabamento' },
  { id: 'expedicao', label: 'Expedicao' },
]

const slaColors: Record<KanbanCard['slaStatus'], string> = {
  on_time: 'border-l-4 border-green-500',
  warning: 'border-l-4 border-yellow-500',
  overdue: 'border-l-4 border-red-500 animate-pulse',
}

const priorityLabels: Record<KanbanCard['priority'], string> = {
  normal: 'Normal',
  urgent: 'Urgente',
  vip: 'VIP',
}

function KanbanColumn(props: {
  stage: LabStage
  title: string
  cards: KanbanCard[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.stage })

  return (
    <section
      ref={setNodeRef}
      className={`min-h-[520px] rounded-lg border border-slate-200 bg-slate-50 p-3 ${isOver ? 'ring-2 ring-brand-400' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{props.title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{props.cards.length}</span>
      </div>
      <div className="space-y-3">
        {props.cards.map((card) => <KanbanCardItem key={card.caseId} card={card} />)}
      </div>
    </section>
  )
}

function KanbanCardItem({ card }: { card: KanbanCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.caseId })
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {}

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${slaColors[card.slaStatus]} ${isDragging ? 'opacity-70' : ''}`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{card.patientName}</p>
          <p className="truncate text-xs text-slate-500">{card.dentistName}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
          {priorityLabels[card.priority]}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Placas</dt>
          <dd className="font-semibold text-slate-900">{card.alignerCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Prazo</dt>
          <dd className="font-semibold text-slate-900">{new Date(`${card.dueDate}T00:00:00`).toLocaleDateString('pt-BR')}</dd>
        </div>
      </dl>
    </article>
  )
}

export function LabKanbanBoard({ clinicId }: { clinicId: string }) {
  const { cases, loading, moveCard } = useLabKanban(clinicId)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      void moveCard(active.id as string, over.id as LabStage)
    }
  }

  if (loading) {
    return <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Carregando esteira do laboratorio...</p>
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1440px] grid-cols-6 gap-3">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              stage={column.id}
              title={column.label}
              cards={cases.filter((card) => card.currentStage === column.id)}
            />
          ))}
        </div>
      </div>
    </DndContext>
  )
}
