import { useEffect, useState } from 'react'
import Button from '../Button'
import Card from '../Card'
import Input from '../Input'

type RegisterDeliveryLotModalProps = {
  open: boolean
  caseOptions?: Array<{ id: string; label: string }>
  selectedCaseId?: string
  isSelectedRework?: boolean
  selectedProductLabel?: string
  selectedArch?: 'superior' | 'inferior' | 'ambos' | ''
  requiresArchQuantities?: boolean
  initialUpperQty?: number
  initialLowerQty?: number
  onCaseChange?: (caseId: string) => void
  onClose: () => void
  onConfirm: (payload: {
    upperQty: number
    lowerQty: number
    deliveredToDoctorAt: string
    note?: string
    forcePrint?: boolean
  }) => void
}

export default function RegisterDeliveryLotModal({
  open,
  caseOptions,
  selectedCaseId,
  isSelectedRework = false,
  selectedProductLabel,
  selectedArch = '',
  requiresArchQuantities = true,
  initialUpperQty = 0,
  initialLowerQty = 0,
  onCaseChange,
  onClose,
  onConfirm,
}: RegisterDeliveryLotModalProps) {
  const [upperQty, setUpperQty] = useState('')
  const [lowerQty, setLowerQty] = useState('')
  const [deliveredToDoctorAt, setDeliveredToDoctorAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setUpperQty(String(initialUpperQty))
    setLowerQty(String(initialLowerQty))
  }, [initialLowerQty, initialUpperQty, open, selectedCaseId])

  if (!open) return null

  const archLabel =
    selectedArch === 'superior'
      ? 'Superior'
      : selectedArch === 'inferior'
        ? 'Inferior'
        : selectedArch === 'ambos'
          ? 'Ambas'
          : '-'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <Card className="w-full max-w-lg">
        <h3 className="text-xl font-semibold text-slate-900">Registrar entrega do LAB ao profissional</h3>
        <div className="mt-4 grid gap-3">
          {caseOptions && onCaseChange ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">OS pronta</label>
              <select
                value={selectedCaseId ?? ''}
                onChange={(event) => onCaseChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Selecione uma OS pronta</option>
                {caseOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Data da entrega</label>
            <Input type="date" value={deliveredToDoctorAt} onChange={(event) => setDeliveredToDoctorAt(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {isSelectedRework ? (
              <div className="col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Rework selecionado: a entrega será registrada automaticamente pela placa solicitada.
              </div>
            ) : null}
            {requiresArchQuantities ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Qtd Superior</label>
                  <Input
                    type="number"
                    min={0}
                    value={upperQty}
                    disabled={isSelectedRework}
                    onChange={(event) => setUpperQty(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Qtd Inferior</label>
                  <Input
                    type="number"
                    min={0}
                    value={lowerQty}
                    disabled={isSelectedRework}
                    onChange={(event) => setLowerQty(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <div><span className="font-semibold">Produto:</span> {selectedProductLabel || '-'}</div>
                <div><span className="font-semibold">Arcada:</span> {archLabel}</div>
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observacao</label>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              onConfirm({
                upperQty: Number(upperQty),
                lowerQty: Number(lowerQty),
                deliveredToDoctorAt,
                note: note.trim() || undefined,
                forcePrint: true,
              })
            }
          >
            Forcar impressao
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                upperQty: Number(upperQty),
                lowerQty: Number(lowerQty),
                deliveredToDoctorAt,
                note: note.trim() || undefined,
              })
            }
          >
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  )
}

