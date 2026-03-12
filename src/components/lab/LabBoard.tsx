import type { LabItem, LabStatus } from '../../types/Lab'
import { moveLabItem, nextStatus, previousStatus } from '../../data/labRepo'
import { useToast } from '../../app/ToastProvider'
import LabColumn from './LabColumn'

type LabBoardProps = {
  items: LabItem[]
  guideTone: (item: LabItem) => 'green' | 'yellow' | 'red'
  caseLabel: (item: LabItem) => string | undefined
  productLabel: (item: LabItem) => string
  onItemsChange: () => void
  onDetails: (item: LabItem) => void
  onPrintLabel?: (item: LabItem) => void
  onSyncMessage?: (message: string) => void
  onMoveStatus?: (id: string, status: LabStatus) => Promise<{ ok: true } | { ok: false; error: string }>
  canEdit?: boolean
}

const columns: Array<{ status: LabStatus; label: string }> = [
  { status: 'aguardando_iniciar', label: 'Aguardando iniciar' },
  { status: 'em_producao', label: 'Em producao' },
  { status: 'controle_qualidade', label: 'Controle de qualidade' },
  { status: 'prontas', label: 'Prontas' },
]

function isOverdue(item: LabItem) {
  if (item.status === 'prontas') return false
  const today = new Date()
  const dueDate = new Date(`${item.dueDate}T00:00:00`)
  return dueDate < new Date(today.toISOString().slice(0, 10))
}

export default function LabBoard({
  items,
  guideTone,
  caseLabel,
  productLabel,
  onItemsChange,
  onDetails,
  onPrintLabel,
  onSyncMessage,
  onMoveStatus,
  canEdit = true,
}: LabBoardProps) {
  const { addToast } = useToast()

  const handlePrevious = (id: string) => {
    if (!canEdit) return
    const current = items.find((item) => item.id === id)
    if (!current) return
    const next = previousStatus(current.status)
    if (!next) return

    if (onMoveStatus) {
      void onMoveStatus(id, next).then((result) => {
        if (!result.ok) {
          addToast({ type: 'error', title: 'Fluxo do LAB', message: result.error })
          return
        }
        onItemsChange()
      })
      return
    }

    const result = moveLabItem(id, next)
    if (result.error) {
      addToast({ type: 'error', title: 'Fluxo do LAB', message: result.error })
      return
    }
    if (!result.sync.ok) {
      if (onSyncMessage) onSyncMessage(result.sync.message)
      addToast({ type: 'error', title: 'Não foi possível sincronizar', message: result.sync.message })
    }
    onItemsChange()
  }

  const handleNext = (id: string) => {
    if (!canEdit) return
    const current = items.find((item) => item.id === id)
    if (!current) return
    const next = nextStatus(current.status)
    if (!next) return

    if (onMoveStatus) {
      void onMoveStatus(id, next).then((result) => {
        if (!result.ok) {
          addToast({ type: 'error', title: 'Fluxo do LAB', message: result.error })
          return
        }
        onItemsChange()
      })
      return
    }

    const result = moveLabItem(id, next)
    if (result.error) {
      addToast({ type: 'error', title: 'Fluxo do LAB', message: result.error })
      return
    }
    if (!result.sync.ok) {
      if (onSyncMessage) onSyncMessage(result.sync.message)
      addToast({ type: 'error', title: 'Não foi possível sincronizar', message: result.sync.message })
    }
    onItemsChange()
  }

  const hasPreviousStatus = (status: LabStatus) => previousStatus(status) !== null
  const hasNextStatus = (status: LabStatus) => nextStatus(status) !== null

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1180px] grid-cols-4 gap-4">
        {columns.map((column) => (
          <LabColumn
            key={column.status}
            title={column.label}
            status={column.status}
            items={items.filter((item) => item.status === column.status)}
            isOverdue={isOverdue}
            guideTone={guideTone}
            caseLabel={caseLabel}
            productLabel={productLabel}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onDetails={onDetails}
            onPrintLabel={onPrintLabel}
            hasPreviousStatus={hasPreviousStatus}
            hasNextStatus={hasNextStatus}
          />
        ))}
      </div>
    </div>
  )
}

