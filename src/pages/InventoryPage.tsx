import { AlertTriangle, Boxes, MinusCircle, PackagePlus, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import AppShell from '../layouts/AppShell'
import { cn } from '../lib/cn'
import {
  listInventoryMaterialsAsync,
  listInventoryTransactionsAsync,
  registerInventoryInputAsync,
  registerInventoryManualOutputAsync,
  upsertInventoryMaterialAsync,
} from '../repo/inventoryRepo'
import type { InventoryMaterial, InventoryTransaction, InventoryTransactionType, InventoryUnit } from '../types/Commercial'

type MaterialForm = {
  id?: string
  name: string
  currentStock: string
  unit: InventoryUnit
  unitCost: string
  minStock: string
}

type MovementForm = {
  materialId: string
  quantity: string
  type: 'waste' | 'internal_use' | 'adjustment'
  notes: string
}

type ModalMode = 'input' | 'output' | null

const selectClass =
  'h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const textareaClass =
  'min-h-24 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

const emptyMaterialForm: MaterialForm = {
  name: '',
  currentStock: '',
  unit: 'un',
  unitCost: '',
  minStock: '',
}

const emptyMovementForm: MovementForm = {
  materialId: '',
  quantity: '',
  type: 'waste',
  notes: '',
}

const unitOptions: InventoryUnit[] = ['un', 'ml', 'g', 'kg', 'l', 'm', 'cm', 'cx', 'pct']
const manualOutputLabels: Record<MovementForm['type'], string> = {
  waste: 'Perda ou vencimento',
  internal_use: 'Teste ou calibração',
  adjustment: 'Ajuste de balanço',
}
const transactionLabels: Record<InventoryTransactionType, string> = {
  input: 'Entrada',
  consumption: 'Consumo automático',
  return: 'Estorno',
  waste: 'Perda',
  internal_use: 'Uso interno',
  adjustment: 'Ajuste',
}

function parseNumber(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatQuantity(value: number, unit: InventoryUnit) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 'un' ? 0 : 4 })} ${unit}`
}

export default function InventoryPage() {
  const { addToast } = useToast()
  const [materials, setMaterials] = useState<InventoryMaterial[]>([])
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [form, setForm] = useState<MaterialForm>(emptyMaterialForm)
  const [movement, setMovement] = useState<MovementForm>(emptyMovementForm)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const materialById = useMemo(() => new Map(materials.map((item) => [item.id, item])), [materials])
  const lowStockMaterials = materials.filter((item) => item.currentStock <= item.minStock)

  const reload = async () => {
    const [nextMaterials, nextTransactions] = await Promise.all([
      listInventoryMaterialsAsync(),
      listInventoryTransactionsAsync(),
    ])
    setMaterials(nextMaterials)
    setTransactions(nextTransactions.slice(0, 12))
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    reload()
      .catch((error) => {
        console.error('Falha ao carregar estoque.', error)
        addToast({ type: 'error', title: 'Falha ao carregar', message: 'Não foi possível carregar o estoque.' })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [addToast])

  const editMaterial = (material: InventoryMaterial) => {
    setForm({
      id: material.id,
      name: material.name,
      currentStock: String(material.currentStock).replace('.', ','),
      unit: material.unit,
      unitCost: String(material.unitCost).replace('.', ','),
      minStock: String(material.minStock).replace('.', ','),
    })
  }

  const handleSaveMaterial = async () => {
    setSaving(true)
    const result = await upsertInventoryMaterialAsync({
      id: form.id,
      name: form.name,
      currentStock: parseNumber(form.currentStock),
      unit: form.unit,
      unitCost: parseNumber(form.unitCost),
      minStock: parseNumber(form.minStock),
    })
    setSaving(false)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Não foi possível salvar', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Insumo salvo', message: 'Saldo e parâmetros de estoque atualizados.' })
    setForm(emptyMaterialForm)
    await reload()
  }

  const handleRegisterMovement = async () => {
    const quantity = parseNumber(movement.quantity)
    const result = modalMode === 'input'
      ? await registerInventoryInputAsync({ materialId: movement.materialId, quantity, notes: movement.notes })
      : await registerInventoryManualOutputAsync({ materialId: movement.materialId, quantity, type: movement.type, notes: movement.notes })
    if (!result.ok) {
      addToast({ type: 'error', title: 'Movimentação bloqueada', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Estoque atualizado', message: 'Movimentação registrada com auditoria.' })
    setMovement(emptyMovementForm)
    setModalMode(null)
    await reload()
  }

  return (
    <AppShell breadcrumb={['Início', 'Estoque']}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">Inventário inteligente</p>
            <h1 className="text-2xl font-bold text-slate-950">Estoque e insumos</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Controle saldos decimais, custos unitários e alertas mínimos para baixa automática de contratos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModalMode('input')}>
              <PackagePlus className="mr-2 h-4 w-4" />
              Registrar entrada
            </Button>
            <Button onClick={() => setModalMode('output')}>
              <MinusCircle className="mr-2 h-4 w-4" />
              Saída manual
            </Button>
          </div>
        </header>

        {lowStockMaterials.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {lowStockMaterials.length} insumo(s) abaixo do estoque mínimo
            </div>
            <p className="mt-1">Revise compras para: {lowStockMaterials.map((item) => item.name).join(', ')}.</p>
          </div>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card>
            <h2 className="text-lg font-semibold text-slate-950">{form.id ? 'Editar insumo' : 'Cadastrar insumo'}</h2>
            <div className="mt-5 space-y-4">
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Nome</span>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex: Resina flexível" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">Saldo atual</span>
                  <Input inputMode="decimal" value={form.currentStock} onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))} />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">Unidade</span>
                  <select className={selectClass} value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as InventoryUnit }))}>
                    {unitOptions.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">Custo unitário</span>
                  <Input inputMode="decimal" value={form.unitCost} onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))} />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">Estoque mínimo</span>
                  <Input inputMode="decimal" value={form.minStock} onChange={(event) => setForm((current) => ({ ...current, minStock: event.target.value }))} />
                </label>
              </div>
              <Button className="w-full" onClick={() => void handleSaveMaterial()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar insumo'}
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                <Boxes className="h-5 w-5 text-brand-700" />
                Saldos físicos
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Insumo</th>
                    <th className="px-5 py-3">Saldo</th>
                    <th className="px-5 py-3">Mínimo</th>
                    <th className="px-5 py-3">Custo</th>
                    <th className="px-5 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr><td className="px-5 py-5 text-slate-500" colSpan={5}>Carregando...</td></tr>
                  ) : materials.length === 0 ? (
                    <tr><td className="px-5 py-5 text-slate-500" colSpan={5}>Nenhum insumo cadastrado.</td></tr>
                  ) : materials.map((material) => {
                    const belowMinimum = material.currentStock <= material.minStock
                    return (
                      <tr key={material.id} className={belowMinimum ? 'bg-amber-50/70' : undefined}>
                        <td className="px-5 py-4 font-medium text-slate-950">{material.name}</td>
                        <td className={cn('px-5 py-4 font-semibold', belowMinimum ? 'text-amber-800' : 'text-slate-800')}>{formatQuantity(material.currentStock, material.unit)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatQuantity(material.minStock, material.unit)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatCurrency(material.unitCost)}</td>
                        <td className="px-5 py-4 text-right">
                          <Button variant="secondary" size="sm" onClick={() => editMaterial(material)}>Editar</Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <Card>
          <h2 className="text-lg font-semibold text-slate-950">Movimentações recentes</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {transactions.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma movimentação registrada.</p>
            ) : transactions.map((transaction) => {
              const material = materialById.get(transaction.materialId)
              return (
                <div key={transaction.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{material?.name ?? 'Insumo removido'}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{transactionLabels[transaction.type]}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatQuantity(transaction.quantity, material?.unit ?? 'un')} em {new Date(transaction.date).toLocaleDateString('pt-BR')}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{transaction.notes}</p>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-lg">
            <h2 className="text-lg font-semibold text-slate-950">{modalMode === 'input' ? 'Registrar entrada/compra' : 'Registrar saída manual'}</h2>
            <div className="mt-5 space-y-4">
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Insumo</span>
                <select className={selectClass} value={movement.materialId} onChange={(event) => setMovement((current) => ({ ...current, materialId: event.target.value }))}>
                  <option value="">Selecione um insumo</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>{material.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Quantidade</span>
                <Input inputMode="decimal" value={movement.quantity} onChange={(event) => setMovement((current) => ({ ...current, quantity: event.target.value }))} />
              </label>
              {modalMode === 'output' ? (
                <label>
                  <span className="mb-1 block text-sm font-medium text-slate-700">Motivo</span>
                  <select className={selectClass} value={movement.type} onChange={(event) => setMovement((current) => ({ ...current, type: event.target.value as MovementForm['type'] }))}>
                    {Object.entries(manualOutputLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Justificativa</span>
                <textarea className={textareaClass} value={movement.notes} onChange={(event) => setMovement((current) => ({ ...current, notes: event.target.value }))} placeholder="Descreva a compra, perda, teste ou ajuste." />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setModalMode(null); setMovement(emptyMovementForm) }}>Cancelar</Button>
              <Button onClick={() => void handleRegisterMovement()}>Registrar</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </AppShell>
  )
}
