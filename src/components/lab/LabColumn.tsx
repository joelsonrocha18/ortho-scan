import type { LabItem, LabStatus } from '../../types/Lab'
import LabCard from './LabCard'

type LabColumnProps = {
  title: string
  status: LabStatus
  items: LabItem[]
  isOverdue: (item: LabItem) => boolean
  guideTone: (item: LabItem) => 'green' | 'yellow' | 'red'
  caseLabel: (item: LabItem) => string | undefined
  productLabel: (item: LabItem) => string
  onPrevious: (id: string) => void
  onNext: (id: string) => void
  onDetails: (item: LabItem) => void
  onPrintLabel?: (item: LabItem) => void
  hasPreviousStatus: (status: LabStatus) => boolean
  hasNextStatus: (status: LabStatus) => boolean
}

const toneMap: Record<LabStatus, string> = {
  aguardando_iniciar: 'border-slate-200 bg-slate-100/60',
  em_producao: 'border-sky-200 bg-sky-50/60',
  controle_qualidade: 'border-amber-200 bg-amber-50/60',
  prontas: 'border-emerald-200 bg-emerald-50/60',
}

export default function LabColumn({
  title,
  status,
  items,
  isOverdue,
  guideTone,
  caseLabel,
  productLabel,
  onPrevious,
  onNext,
  onDetails,
  onPrintLabel,
  hasPreviousStatus,
  hasNextStatus,
}: LabColumnProps) {
  return (
    <div className={`min-w-[280px] rounded-2xl border p-3 ${toneMap[status]}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{items.length}</span>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <LabCard
            key={item.id}
            item={item}
            isOverdue={isOverdue(item)}
            guideTone={guideTone(item)}
            caseLabel={caseLabel(item)}
            productLabel={productLabel(item)}
            onPrevious={onPrevious}
            onNext={onNext}
            onDetails={onDetails}
            onPrintLabel={onPrintLabel}
            hasPrevious={hasPreviousStatus(status)}
            hasNext={hasNextStatus(status)}
          />
        ))}
      </div>
    </div>
  )
}
