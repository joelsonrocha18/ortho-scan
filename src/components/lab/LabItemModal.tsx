import { useEffect, useMemo, useState } from 'react'
import { canMoveToStatus } from '../../data/labRepo'
import type { Case } from '../../types/Case'
import type { LabItem, LabPriority, LabStatus } from '../../types/Lab'
import type { ProductType } from '../../types/Product'
import { isAlignerProductType, PRODUCT_TYPE_LABEL } from '../../types/Product'
import { useToast } from '../../app/ToastProvider'
import Button from '../Button'
import Card from '../Card'
import Input from '../Input'

type LabModalMode = 'create' | 'edit'

type LabItemModalProps = {
  mode: LabModalMode
  item: LabItem | null
  open: boolean
  cases: Case[]
  patientOptions?: Array<{
    id: string
    name: string
    dentistId?: string
    clinicId?: string
    dentistName?: string
    clinicName?: string
  }>
  readOnly?: boolean
  allowDelete?: boolean
  onClose: () => void
  onCreate: (payload: {
    caseId?: string
    productType?: ProductType
    productId?: ProductType
    patientId?: string
    dentistId?: string
    clinicId?: string
    arch: 'superior' | 'inferior' | 'ambos'
    plannedUpperQty?: number
    plannedLowerQty?: number
    patientName: string
    trayNumber: number
    dueDate: string
    priority: LabPriority
    notes?: string
    status: LabStatus
  }) => { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>
  onSave: (id: string, patch: Partial<LabItem>) => { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>
  onDelete: (id: string) => void
  onReprintGuide?: (item: LabItem) => void
}

type FormState = {
  productType: ProductType
  productId?: ProductType
  patientId?: string
  dentistId?: string
  clinicId?: string
  arch: 'superior' | 'inferior' | 'ambos'
  plannedUpperQty: string
  plannedLowerQty: string
  patientName: string
  trayNumber: string
  dueDate: string
  priority: LabPriority
  notes: string
  status: LabStatus
}

const defaultForm: FormState = {
  productType: 'alinhador_12m',
  arch: 'ambos',
  plannedUpperQty: '0',
  plannedLowerQty: '0',
  patientName: '',
  trayNumber: '',
  dueDate: '',
  priority: 'Medio',
  notes: '',
  status: 'aguardando_iniciar',
}

const statusOptions: Array<{ value: LabStatus; label: string }> = [
  { value: 'aguardando_iniciar', label: 'Aguardando iniciar' },
  { value: 'em_producao', label: 'Em Producao' },
  { value: 'controle_qualidade', label: 'Controle de qualidade' },
  { value: 'prontas', label: 'Prontas' },
]

const archLabelMap: Record<'superior' | 'inferior' | 'ambos', string> = {
  superior: 'Superior',
  inferior: 'Inferior',
  ambos: 'Ambas',
}

function isStartWaitingStatus(status?: string) {
  const normalized = (status ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
  return normalized === 'aguardando_iniciar'
}

function treatmentArchSummary(
  arch: 'superior' | 'inferior' | 'ambos',
  upper: number,
  lower: number,
) {
  if (arch === 'superior') return `Sup ${upper}`
  if (arch === 'inferior') return `Inf ${lower}`
  return `Sup ${upper} | Inf ${lower}`
}

export default function LabItemModal({
  mode,
  item,
  open,
  cases,
  patientOptions = [],
  onClose,
  readOnly = false,
  allowDelete = false,
  onCreate,
  onSave,
  onDelete,
  onReprintGuide,
}: LabItemModalProps) {
  const { addToast } = useToast()
  const [form, setForm] = useState<FormState>(defaultForm)
  const [error, setError] = useState('')
  const [patientSearch, setPatientSearch] = useState('')

  const linkedCaseId = mode === 'edit' ? item?.caseId : undefined
  const selectedCase = useMemo(
    () => (linkedCaseId ? cases.find((current) => current.id === linkedCaseId) ?? null : null),
    [cases, linkedCaseId],
  )
  const selectedCaseUpper = useMemo(() => {
    if (!selectedCase) return 0
    if (typeof selectedCase.totalTraysUpper === 'number') return selectedCase.totalTraysUpper
    if (selectedCase.arch === 'inferior') return 0
    return selectedCase.totalTrays
  }, [selectedCase])
  const selectedCaseLower = useMemo(() => {
    if (!selectedCase) return 0
    if (typeof selectedCase.totalTraysLower === 'number') return selectedCase.totalTraysLower
    if (selectedCase.arch === 'superior') return 0
    return selectedCase.totalTrays
  }, [selectedCase])

  useEffect(() => {
    if (!open) {
      return
    }

    if (mode === 'edit' && item) {
      setForm({
        arch: item.arch ?? 'ambos',
        productType: item.productType ?? 'alinhador_12m',
        productId: item.productId,
        patientId: item.patientId,
        dentistId: item.dentistId,
        clinicId: item.clinicId,
        plannedUpperQty: String(item.plannedUpperQty ?? 0),
        plannedLowerQty: String(item.plannedLowerQty ?? 0),
        patientName: item.patientName,
        trayNumber: String(item.trayNumber),
        dueDate: item.dueDate,
        priority: item.priority,
        notes: item.notes ?? '',
        status: item.status,
      })
      setError('')
      setPatientSearch('')
      return
    }

    setForm({ ...defaultForm, dueDate: new Date().toISOString().slice(0, 10) })
    setError('')
    setPatientSearch('')
  }, [mode, item, open])

  const filteredPatientOptions = useMemo(() => {
    const query = patientSearch.trim().toLowerCase()
    if (!query) return patientOptions.slice(0, 30)
    return patientOptions
      .filter((item) => item.name.toLowerCase().includes(query))
      .slice(0, 30)
  }, [patientOptions, patientSearch])

  const canDelete = mode === 'edit' && Boolean(item)
  const isReworkItem = useMemo(
    () => mode === 'edit' && Boolean(item) && (item?.requestKind === 'reconfeccao' || (item?.notes ?? '').toLowerCase().includes('rework')),
    [item, mode],
  )
  const planQtyTotal = Math.trunc(Number(form.plannedUpperQty || 0)) + Math.trunc(Number(form.plannedLowerQty || 0))
  const isAlignerProduct = isAlignerProductType(form.productType)
  const automaticStatus = isAlignerProduct && planQtyTotal > 0 ? 'em_producao' : 'aguardando_iniciar'

  const statusBlocked = useMemo(() => {
    if (mode === 'create') {
      return !canMoveToStatus('aguardando_iniciar', form.status)
    }
    if (!item) {
      return false
    }
    return !canMoveToStatus(item.status, form.status)
  }, [form.status, item, mode])

  if (!open) {
    return null
  }

  const submit = async () => {
    if (readOnly) {
      return
    }
    const tray = mode === 'edit' && item ? item.trayNumber : 1
    const rawUpperQty = Number(form.plannedUpperQty || 0)
    const rawLowerQty = Number(form.plannedLowerQty || 0)
    const plannedUpperQty = form.arch === 'inferior' ? 0 : rawUpperQty
    const plannedLowerQty = form.arch === 'superior' ? 0 : rawLowerQty
    if (!form.patientName.trim() || !form.dueDate || !Number.isFinite(tray) || tray <= 0) {
      const message = 'Preencha os campos obrigatorios com valores validos.'
      setError(message)
      addToast({ type: 'error', title: 'Validacao', message })
      return
    }

    if (isAlignerProduct && selectedCase && tray > selectedCase.totalTrays) {
      const message = `A placa deve estar entre 1 e ${selectedCase.totalTrays} para este caso.`
      setError(message)
      addToast({ type: 'error', title: 'Validacao', message })
      return
    }
    if (!Number.isFinite(plannedUpperQty) || !Number.isFinite(plannedLowerQty) || plannedUpperQty < 0 || plannedLowerQty < 0) {
      const message = 'Informe quantidades validas por arcada (zero ou maior).'
      setError(message)
      addToast({ type: 'error', title: 'Validacao', message })
      return
    }
    if (isAlignerProduct && selectedCase) {
      const maxUpper = selectedCase.totalTraysUpper ?? selectedCase.totalTrays
      const maxLower = selectedCase.totalTraysLower ?? selectedCase.totalTrays
      if (plannedUpperQty > maxUpper || plannedLowerQty > maxLower) {
        const message = `Planejamento excede o caso. Limites: Superior ${maxUpper} | Inferior ${maxLower}.`
        setError(message)
        addToast({ type: 'error', title: 'Validacao', message })
        return
      }
    }

    if (statusBlocked) {
      const message = 'Transicao de status invalida para este item.'
      setError(message)
      addToast({ type: 'error', title: 'Validacao', message })
      return
    }
    if (mode === 'create') {
      const result = await onCreate({
        caseId: undefined,
        productType: form.productType,
        productId: form.productId ?? form.productType,
        patientId: form.patientId,
        dentistId: form.dentistId,
        clinicId: form.clinicId,
        arch: form.arch,
        plannedUpperQty: Math.trunc(plannedUpperQty),
        plannedLowerQty: Math.trunc(plannedLowerQty),
        patientName: form.patientName.trim(),
        trayNumber: tray,
        dueDate: form.dueDate,
        priority: form.priority,
        notes: form.notes.trim() || undefined,
        status: automaticStatus,
      })
      if (!result.ok) {
        setError(result.message ?? 'Erro ao salvar solicitacao.')
        addToast({ type: 'error', title: 'Erro', message: result.message ?? 'Erro ao salvar solicitacao.' })
        return
      }
      addToast({ type: 'success', title: 'Solicitacao salva' })
      onClose()
      return
    }

    if (!item) {
      return
    }

    const result = await onSave(item.id, {
      arch: form.arch,
      productType: form.productType,
      productId: form.productId ?? form.productType,
      patientId: form.patientId,
      dentistId: form.dentistId,
      clinicId: form.clinicId,
      plannedUpperQty: Math.trunc(plannedUpperQty),
      plannedLowerQty: Math.trunc(plannedLowerQty),
      patientName: form.patientName.trim(),
      trayNumber: tray,
      dueDate: form.dueDate,
      priority: form.priority,
      notes: form.notes.trim() || undefined,
      status: mode === 'edit' && item.status !== 'aguardando_iniciar' ? form.status : automaticStatus,
    })
    if (!result.ok) {
      setError(result.message ?? 'Erro ao salvar solicitacao.')
      addToast({ type: 'error', title: 'Erro', message: result.message ?? 'Erro ao salvar solicitacao.' })
      return
    }
    addToast({ type: 'success', title: 'Solicitacao salva' })
    onClose()
  }

  const handleDelete = () => {
    if (readOnly) {
      return
    }
    if (!item) {
      return
    }
    if (!window.confirm('Deseja excluir este item do laboratorio?')) {
      return
    }
    onDelete(item.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <Card className="w-full max-w-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {mode === 'create' ? 'Solicitacao avulsa' : isReworkItem ? 'Detalhes do Rework' : 'Detalhes do Item'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'create'
                ? 'Cadastre uma solicitacao avulsa na fila do laboratorio.'
                : isReworkItem
                  ? 'Rework da esteira: ajuste prazo, observacoes e status.'
                  : 'Edite prioridade, prazo, observacoes e status.'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!linkedCaseId ? (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo de produto</label>
              <select
                value={form.productType}
                onChange={(event) => setForm((current) => ({ ...current, productType: event.target.value as ProductType }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                disabled={readOnly}
              >
                {Object.entries(PRODUCT_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="sm:col-span-2">
            {mode === 'edit' ? (
              <p className="mb-2 text-sm text-slate-700">
                OS: {item?.requestCode ?? selectedCase?.treatmentCode ?? '-'}
              </p>
            ) : null}
            {isReworkItem && item ? (
              <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-semibold">Placa(s) solicitada(s) para rework: #{item.trayNumber}</p>
                <p className="text-xs">Arcada: {archLabelMap[item.arch]}</p>
              </div>
            ) : null}
            {selectedCase ? (
              <p className="text-xs text-slate-600">
                Tratamento: {treatmentArchSummary(selectedCase.arch ?? 'ambos', selectedCaseUpper, selectedCaseLower)} | Troca a cada {selectedCase.changeEveryDays} dias
              </p>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Paciente</label>
            <Input
              value={form.patientName}
              onChange={(event) => setForm((current) => ({ ...current, patientName: event.target.value }))}
              placeholder="Nome do paciente"
              readOnly={Boolean(linkedCaseId)}
              disabled={readOnly}
            />
          </div>
          {!linkedCaseId ? (
            <>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Buscar no banco de pacientes</label>
                <Input
                  value={patientSearch}
                  onChange={(event) => setPatientSearch(event.target.value)}
                  placeholder="Digite o nome do paciente"
                  disabled={readOnly}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Paciente cadastrado</label>
                <select
                  value={form.patientId ?? ''}
                  onChange={(event) => {
                    const selected = patientOptions.find((item) => item.id === event.target.value)
                    setForm((current) => ({
                      ...current,
                      patientId: selected?.id,
                      patientName: selected?.name ?? current.patientName,
                      dentistId: selected?.dentistId,
                      clinicId: selected?.clinicId,
                    }))
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  disabled={readOnly}
                >
                  <option value="">Não vincular paciente</option>
                  {filteredPatientOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {form.patientId ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Vínculos: Dentista {patientOptions.find((item) => item.id === form.patientId)?.dentistName ?? '-'} | Clínica {patientOptions.find((item) => item.id === form.patientId)?.clinicName ?? '-'}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Prazo</label>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              disabled={readOnly}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Prioridade</label>
            <select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as LabPriority }))}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              disabled={readOnly}
            >
              <option value="Baixo">Baixo</option>
              <option value="Medio">Medio</option>
              <option value="Urgente">Urgente</option>
            </select>
          </div>

          {isAlignerProduct ? (
            <>
              {form.arch !== 'inferior' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Qtd a produzir - Superior</label>
                  <Input
                    type="number"
                    min={0}
                    value={form.plannedUpperQty}
                    onChange={(event) => setForm((current) => ({ ...current, plannedUpperQty: event.target.value }))}
                    disabled={readOnly}
                  />
                </div>
              ) : null}

              {form.arch !== 'superior' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Qtd a produzir - Inferior</label>
                  <Input
                    type="number"
                    min={0}
                    value={form.plannedLowerQty}
                    onChange={(event) => setForm((current) => ({ ...current, plannedLowerQty: event.target.value }))}
                    disabled={readOnly}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
            {(mode === 'create' || item?.status === 'aguardando_iniciar') ? (
              <p className="mb-1 text-xs text-slate-500">
                Status automático: fica em "Aguardando iniciar" ate definir quantidade. Ao salvar com quantidade, vai para "Em Producao".
              </p>
            ) : null}
            <select
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as LabStatus }))}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              disabled={readOnly || mode === 'create' || item?.status === 'aguardando_iniciar'}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              placeholder="Detalhes internos do laboratorio..."
              disabled={readOnly}
            />
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!readOnly && mode === 'edit' && isStartWaitingStatus(item?.status) && item && onReprintGuide ? (
              <Button variant="secondary" onClick={() => onReprintGuide(item)}>
                Reimpressao O.S
              </Button>
            ) : null}
            {!readOnly && canDelete && allowDelete ? (
              <Button variant="secondary" onClick={handleDelete}>
                Excluir
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              {readOnly ? 'Fechar' : 'Cancelar'}
            </Button>
            {!readOnly ? <Button onClick={submit}>Salvar</Button> : null}
          </div>
        </div>
      </Card>
    </div>
  )
}

