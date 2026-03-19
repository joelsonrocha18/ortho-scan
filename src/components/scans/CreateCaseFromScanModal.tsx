import { useEffect, useState } from 'react'
import type { Scan, ScanAttachment } from '../../types/Scan'
import { isAlignerProductType, normalizeProductType } from '../../types/Product'
import Button from '../Button'
import Card from '../Card'
import Input from '../Input'
import { parsePlanningTrayCounts } from '../../lib/archformParser'
import { createSignedUrl } from '../../repo/storageRepo'

type CreateCaseFromScanModalProps = {
  open: boolean
  scan: Scan | null
  onClose: () => void
  onConfirm: (payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  }) => void
}

export default function CreateCaseFromScanModal({ open, scan, onClose, onConfirm }: CreateCaseFromScanModalProps) {
  const [upper, setUpper] = useState('24')
  const [lower, setLower] = useState('20')
  const [changeEveryDays, setChangeEveryDays] = useState('7')
  const [attachmentBondingTray, setAttachmentBondingTray] = useState(false)
  const [planningNote, setPlanningNote] = useState('')
  const [error, setError] = useState('')
  const [autoDetected, setAutoDetected] = useState<{ upper?: number; lower?: number } | null>(null)

  const detectFromAttachedPlanning = async (attachments: ScanAttachment[]) => {
    let bestUpper: number | undefined
    let bestLower: number | undefined
    const planningFiles = attachments.filter((item) => item.kind === 'projeto')
    for (const item of planningFiles) {
      let url: string | undefined
      if (item.filePath) {
        const signed = await createSignedUrl(item.filePath, 300)
        if (signed.ok) url = signed.url
      } else {
        url = item.url
      }
      if (!url) continue
      try {
        const response = await fetch(url)
        if (!response.ok) continue
        const blob = await response.blob()
        const file = new File([blob], item.name, { type: blob.type || 'application/octet-stream' })
        const detected = await parsePlanningTrayCounts(file)
        if (!detected) continue
        if (detected.upper && (!bestUpper || detected.upper > bestUpper)) bestUpper = detected.upper
        if (detected.lower && (!bestLower || detected.lower > bestLower)) bestLower = detected.lower
      } catch {
        // ignore and continue with next planning file
      }
    }
    if (!bestUpper && !bestLower) return null
    return { upper: bestUpper, lower: bestLower }
  }

  useEffect(() => {
    if (!open || !scan) return
    const suggestedUpper = scan.planningDetectedUpperTrays
    const suggestedLower = scan.planningDetectedLowerTrays

    if (scan.arch === 'superior') {
      setUpper(suggestedUpper ? String(suggestedUpper) : '24')
      setLower('')
    } else if (scan.arch === 'inferior') {
      setUpper('')
      setLower(suggestedLower ? String(suggestedLower) : '20')
    } else {
      setUpper(suggestedUpper ? String(suggestedUpper) : '24')
      setLower(suggestedLower ? String(suggestedLower) : '20')
    }
    setChangeEveryDays('7')
    setAttachmentBondingTray(false)
    setPlanningNote('')
    setError('')
    setAutoDetected(null)
  }, [open, scan])

  useEffect(() => {
    if (!open || !scan) return
    const isAlignerFlow = isAlignerProductType(normalizeProductType(scan.purposeProductType))
    if (!isAlignerFlow) return
    if (scan.planningDetectedUpperTrays || scan.planningDetectedLowerTrays) return
    if (!scan.attachments.some((item) => item.kind === 'projeto')) return

    let active = true
    void detectFromAttachedPlanning(scan.attachments).then((detected) => {
      if (!active) return
      let nextDetected = detected
      if (!nextDetected) {
        const hasArchform = scan.attachments.some(
          (item) => item.kind === 'projeto' && item.name.toLowerCase().endsWith('.archform'),
        )
        if (hasArchform) {
          nextDetected = {
            upper: scan.arch !== 'inferior' ? 15 : undefined,
            lower: scan.arch !== 'superior' ? 15 : undefined,
          }
        }
      }
      if (!nextDetected) return
      setAutoDetected(nextDetected)
      if (scan.arch === 'superior') {
        if (nextDetected.upper) setUpper(String(nextDetected.upper))
      } else if (scan.arch === 'inferior') {
        if (nextDetected.lower) setLower(String(nextDetected.lower))
      } else {
        if (nextDetected.upper) setUpper(String(nextDetected.upper))
        if (nextDetected.lower) setLower(String(nextDetected.lower))
      }
    })
    return () => {
      active = false
    }
  }, [open, scan])

  if (!open || !scan) return null
  const isAlignerFlow = isAlignerProductType(normalizeProductType(scan.purposeProductType))

  const submit = () => {
    const upperNum = Number(upper)
    const lowerNum = Number(lower)
    const days = Number(changeEveryDays)

    const upperValue = Number.isFinite(upperNum) && upperNum > 0 ? upperNum : undefined
    const lowerValue = Number.isFinite(lowerNum) && lowerNum > 0 ? lowerNum : undefined

    if (isAlignerFlow && (!Number.isFinite(days) || days <= 0)) {
      setError('Troca em dias deve ser maior que zero.')
      return
    }

    if (isAlignerFlow && scan.arch === 'superior' && !upperValue) {
      setError('Informe total de placas superior.')
      return
    }
    if (isAlignerFlow && scan.arch === 'inferior' && !lowerValue) {
      setError('Informe total de placas inferior.')
      return
    }
    if (isAlignerFlow && scan.arch === 'ambos' && !upperValue && !lowerValue) {
      setError('Informe total de placas superior e/ou inferior.')
      return
    }

    onConfirm({
      totalTraysUpper: isAlignerFlow ? upperValue : undefined,
      totalTraysLower: isAlignerFlow ? lowerValue : undefined,
      changeEveryDays: isAlignerFlow ? days : 0,
      attachmentBondingTray,
      planningNote: planningNote.trim() || undefined,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <Card className="w-full max-w-lg">
        <h3 className="text-xl font-semibold text-slate-900">Criar Caso a partir do Scan</h3>
        <p className="mt-1 text-sm text-slate-500">
          {isAlignerFlow
            ? scan.arch === 'ambos'
              ? 'Planejamento inicial de placas para superior/inferior.'
              : `Planejamento inicial de placas para arcada ${scan.arch}.`
            : 'Produto sem fluxo de placas. O caso seguira com registro de instalação.'}
        </p>
        {isAlignerFlow && scan.arch === 'ambos' ? (
          <p className="mt-1 text-xs text-slate-500">Superior e inferior podem ter quantidades diferentes.</p>
        ) : null}
        {isAlignerFlow && (scan.planningDetectedUpperTrays || scan.planningDetectedLowerTrays || autoDetected) ? (
          <p className="mt-1 text-xs text-emerald-700">
            Valores preenchidos automaticamente pelo arquivo de planejamento anexado.
          </p>
        ) : null}

        <div className="mt-4 grid gap-4">
          {isAlignerFlow && scan.arch === 'ambos' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Total de placas Superior</label>
                <Input
                  type="number"
                  min={0}
                  value={upper}
                  onChange={(event) => setUpper(event.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Total de placas Inferior</label>
                <Input
                  type="number"
                  min={0}
                  value={lower}
                  onChange={(event) => setLower(event.target.value)}
                />
              </div>
            </div>
          ) : isAlignerFlow && scan.arch === 'superior' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Total de placas Superior</label>
              <Input
                type="number"
                min={0}
                value={upper}
                onChange={(event) => setUpper(event.target.value)}
              />
            </div>
          ) : isAlignerFlow ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Total de placas Inferior</label>
              <Input
                type="number"
                min={0}
                value={lower}
                onChange={(event) => setLower(event.target.value)}
              />
            </div>
          ) : null}

          {isAlignerFlow ? (
            <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Troca a cada (dias)</label>
            <Input type="number" min={1} value={changeEveryDays} onChange={(event) => setChangeEveryDays(event.target.value)} />
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Este produto vai direto para o fluxo de pedido/instalação, sem esteira de placas de alinhadores.
            </p>
          )}

          {isAlignerFlow ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={attachmentBondingTray}
                onChange={(event) => setAttachmentBondingTray(event.target.checked)}
              />
              Incluir placa para colar attachments antes do início
            </label>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observacao do planejamento (opcional)</label>
            <textarea
              rows={3}
              value={planningNote}
              onChange={(event) => setPlanningNote(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>Criar Caso</Button>
        </div>
      </Card>
    </div>
  )
}

