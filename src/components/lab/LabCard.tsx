import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react'
import Badge from '../Badge'
import Button from '../Button'
import Card from '../Card'
import type { LabItem } from '../../types/Lab'
import { isAlignerProductType, PRODUCT_TYPE_LABEL } from '../../types/Product'

type LabCardProps = {
  item: LabItem
  isOverdue: boolean
  guideTone: 'green' | 'yellow' | 'red'
  caseLabel?: string
  productLabel?: string
  onPrevious: (id: string) => void
  onNext: (id: string) => void
  onDetails: (item: LabItem) => void
  onPrintLabel?: (item: LabItem) => void
  hasPrevious: boolean
  hasNext: boolean
}

const priorityToneMap: Record<LabItem['priority'], 'neutral' | 'info' | 'danger'> = {
  Baixo: 'neutral',
  Medio: 'info',
  Urgente: 'danger',
}

const archLabelMap: Record<LabItem['arch'], string> = {
  superior: 'Superior',
  inferior: 'Inferior',
  ambos: 'Ambas',
}

function formatDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('pt-BR')
}

function productionByArchLabel(item: LabItem) {
  const upper = item.plannedUpperQty ?? 0
  const lower = item.plannedLowerQty ?? 0
  if (item.arch === 'superior') return `Producao por arcada: Sup ${upper}`
  if (item.arch === 'inferior') return `Producao por arcada: Inf ${lower}`
  return `Producao por arcada: Sup ${upper} | Inf ${lower}`
}

export default function LabCard({
  item,
  isOverdue,
  guideTone: _guideTone,
  caseLabel,
  productLabel,
  onPrevious,
  onNext,
  onDetails,
  onPrintLabel,
  hasPrevious,
  hasNext,
}: LabCardProps) {
  const formatDisplayCode = (code?: string) => {
    if (!code) return undefined
    return code.trim()
  }
  const displayCode = formatDisplayCode(caseLabel ?? item.requestCode)
  const isRework = item.requestKind === 'reconfeccao' || (item.notes ?? '').toLowerCase().includes('rework')
  const isAligner = isAlignerProductType(item.productId ?? item.productType ?? 'alinhador_12m')
  const cardTone = isRework ? 'border border-red-300 bg-red-50/40' : ''

  return (
    <Card className={`p-4 ${cardTone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {displayCode ? <p className="text-xs font-medium text-slate-600">Guia: {displayCode}</p> : null}
          <p className="text-sm font-semibold text-slate-900">Paciente: {item.patientName}</p>
          <p className="mt-1 text-xs text-slate-600">Produto: {productLabel ?? PRODUCT_TYPE_LABEL[item.productType ?? 'alinhador_12m']}</p>
          <p className="mt-1 text-xs text-slate-700">Arcada: {archLabelMap[item.arch]}</p>
          {isAligner && !item.requestCode && !isRework ? (
            <p className="mt-1 text-xs text-slate-500">Placa #{item.trayNumber}</p>
          ) : null}
          {isRework ? (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs font-semibold text-red-700">Rework solicitado</p>
              {isAligner ? <p className="text-xs text-slate-700">Placa(s): #{item.trayNumber}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isRework ? <Badge tone="danger">Rework</Badge> : null}
          <Badge tone={priorityToneMap[item.priority]}>{item.priority}</Badge>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-xs">
        <p className={isOverdue ? 'flex items-center gap-2 text-red-600' : 'flex items-center gap-2 text-slate-600'}>
          <CalendarClock className="h-3.5 w-3.5" />
          Prazo: {formatDate(item.dueDate)}
        </p>
        {isAligner ? (
          <p className="text-slate-600">
            {productionByArchLabel(item)}
          </p>
        ) : null}
        {isAligner && item.status === 'aguardando_iniciar' && (item.plannedUpperQty ?? 0) + (item.plannedLowerQty ?? 0) <= 0 ? (
          <Badge tone="danger" className="px-2 py-0.5 text-[10px]">Definir arcadas</Badge>
        ) : null}
        {isOverdue ? <Badge tone="danger" className="px-2 py-0.5 text-[10px]">Atrasado</Badge> : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onPrevious(item.id)} disabled={!hasPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onNext(item.id)} disabled={!hasNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {item.status === 'prontas' && onPrintLabel ? (
            <Button size="sm" variant="secondary" onClick={() => onPrintLabel(item)}>
              Imprimir adesivo
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onDetails(item)}>
            Detalhes
          </Button>
        </div>
      </div>
    </Card>
  )
}
