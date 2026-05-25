import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { can } from '../auth/permissions'
import { useToast } from '../app/ToastProvider'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import AppShell from '../layouts/AppShell'
import { getCurrentUser } from '../lib/auth'
import { loadSystemSettings, saveSystemSettings, type PricingArchScope, type PricingMode } from '../lib/systemSettings'
import { useDb } from '../lib/useDb'
import { PRODUCT_TYPE_LABEL } from '../types/Product'

const TOOTH_OPTIONS = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
]

function parsePriceInput(raw: string) {
  const sanitized = raw.replace(/[^\d,.-]/g, '').trim()
  if (!sanitized) return 0
  const normalized = sanitized.includes(',') ? sanitized.replace(/\./g, '').replace(',', '.') : sanitized
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function formatCurrencyBrl(value?: number) {
  if (!Number.isFinite(value)) return '-'
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function PricesPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'prices.write')
  const [settingsState, setSettingsState] = useState(() => loadSystemSettings())
  const [form, setForm] = useState<{
    productFlow: 'alinhador' | 'impressoes'
    customName: string
    pricingMode: PricingMode
    archScope: PricingArchScope
    unitPrice: string
    upperPrice: string
    lowerPrice: string
    toothUnitPrice: string
    selectedTeeth: string[]
  }>({
    productFlow: 'impressoes',
    customName: '',
    pricingMode: 'unit',
    archScope: 'ambas',
    unitPrice: '',
    upperPrice: '',
    lowerPrice: '',
    toothUnitPrice: '',
    selectedTeeth: [],
  })

  const catalog = settingsState.priceCatalog ?? []
  const activeCount = useMemo(() => catalog.filter((item) => item.isActive !== false).length, [catalog])

  const persistCatalog = (nextCatalog: typeof catalog, successMessage: string) => {
    const nextSettings = { ...settingsState, priceCatalog: nextCatalog }
    saveSystemSettings(nextSettings)
    setSettingsState(nextSettings)
    addToast({ type: 'success', title: successMessage })
  }

  const addProduct = () => {
    if (!canWrite) return
    const name = form.customName.trim()
    if (!name) return addToast({ type: 'error', title: 'Informe o nome do produto.' })
    if (form.pricingMode === 'unit' && parsePriceInput(form.unitPrice) <= 0) return addToast({ type: 'error', title: 'Informe o preço por unidade.' })
    if (form.pricingMode === 'arch' && form.archScope === 'superior' && parsePriceInput(form.upperPrice) <= 0) return addToast({ type: 'error', title: 'Informe o preço da arcada superior.' })
    if (form.pricingMode === 'arch' && form.archScope === 'inferior' && parsePriceInput(form.lowerPrice) <= 0) return addToast({ type: 'error', title: 'Informe o preço da arcada inferior.' })
    if (form.pricingMode === 'arch' && form.archScope === 'ambas' && parsePriceInput(form.upperPrice) <= 0 && parsePriceInput(form.lowerPrice) <= 0) return addToast({ type: 'error', title: 'Informe ao menos um preço por arcada.' })
    if (form.pricingMode === 'tooth' && parsePriceInput(form.toothUnitPrice) <= 0) return addToast({ type: 'error', title: 'Informe o preço por dente.' })
    if (form.pricingMode === 'tooth' && form.selectedTeeth.length === 0) return addToast({ type: 'error', title: 'Selecione ao menos um dente.' })

    const now = new Date().toISOString()
    persistCatalog([
      {
        id: `price_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        name,
        productType: form.productFlow === 'alinhador' ? 'alinhador_12m' : 'biomodelo',
        pricingMode: form.pricingMode,
        archScope: form.pricingMode === 'arch' ? form.archScope : undefined,
        unitPrice: form.pricingMode === 'unit' ? parsePriceInput(form.unitPrice) : undefined,
        upperPrice: form.pricingMode === 'arch' && form.archScope !== 'inferior' ? parsePriceInput(form.upperPrice) : undefined,
        lowerPrice: form.pricingMode === 'arch' && form.archScope !== 'superior' ? parsePriceInput(form.lowerPrice) : undefined,
        toothUnitPrice: form.pricingMode === 'tooth' ? parsePriceInput(form.toothUnitPrice) : undefined,
        selectedTeeth: form.pricingMode === 'tooth' ? form.selectedTeeth : undefined,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ...catalog,
    ], 'Produto adicionado à política de preço')
    setForm({ productFlow: 'impressoes', customName: '', pricingMode: 'unit', archScope: 'ambas', unitPrice: '', upperPrice: '', lowerPrice: '', toothUnitPrice: '', selectedTeeth: [] })
  }

  const toggleProduct = (id: string, isActive: boolean) => {
    if (!canWrite) return
    persistCatalog(catalog.map((item) => item.id === id ? { ...item, isActive, updatedAt: new Date().toISOString() } : item), isActive ? 'Produto ativado' : 'Produto desativado')
  }

  const removeProduct = (id: string) => {
    if (!canWrite) return
    persistCatalog(catalog.filter((item) => item.id !== id), 'Produto removido')
  }

  return (
    <AppShell breadcrumb={['Início', 'Preços']}>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-700">Política comercial</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Preços</h1>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Cadastrar produto</h2>
          <div className="mt-4 space-y-3">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Produto</label><Input value={form.customName} onChange={(event) => setForm((current) => ({ ...current, customName: event.target.value }))} placeholder="Ex.: Contenção premium" /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Fluxo</label><select value={form.productFlow} onChange={(event) => setForm((current) => ({ ...current, productFlow: event.target.value as 'alinhador' | 'impressoes' }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="impressoes">Impressões e demais produtos</option><option value="alinhador">Alinhadores</option></select></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Cobrança</label><select value={form.pricingMode} onChange={(event) => setForm((current) => ({ ...current, pricingMode: event.target.value as PricingMode }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="unit">Unidade</option><option value="arch">Arcada</option><option value="tooth">Dente</option></select></div>
            {form.pricingMode === 'unit' ? <div><label className="mb-1 block text-sm font-medium text-slate-700">Preço por unidade</label><Input value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} /></div> : null}
            {form.pricingMode === 'arch' ? <div className="space-y-3"><div><label className="mb-1 block text-sm font-medium text-slate-700">Aplicação</label><select value={form.archScope} onChange={(event) => setForm((current) => ({ ...current, archScope: event.target.value as PricingArchScope }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="ambas">Ambas</option><option value="superior">Superior</option><option value="inferior">Inferior</option></select></div>{form.archScope !== 'inferior' ? <Input placeholder="Preço superior" value={form.upperPrice} onChange={(event) => setForm((current) => ({ ...current, upperPrice: event.target.value }))} /> : null}{form.archScope !== 'superior' ? <Input placeholder="Preço inferior" value={form.lowerPrice} onChange={(event) => setForm((current) => ({ ...current, lowerPrice: event.target.value }))} /> : null}</div> : null}
            {form.pricingMode === 'tooth' ? <div className="space-y-3"><Input placeholder="Preço por dente" value={form.toothUnitPrice} onChange={(event) => setForm((current) => ({ ...current, toothUnitPrice: event.target.value }))} /><div className="grid grid-cols-8 gap-2">{TOOTH_OPTIONS.map((tooth) => <label key={tooth} className={`cursor-pointer rounded border px-2 py-1 text-center text-xs ${form.selectedTeeth.includes(tooth) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}><input className="sr-only" type="checkbox" checked={form.selectedTeeth.includes(tooth)} onChange={(event) => setForm((current) => ({ ...current, selectedTeeth: event.target.checked ? [...current.selectedTeeth, tooth] : current.selectedTeeth.filter((item) => item !== tooth) }))} />{tooth}</label>)}</div></div> : null}
            <Button className="w-full" onClick={addProduct} disabled={!canWrite}><Plus className="mr-2 h-4 w-4" />Adicionar produto</Button>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Produtos cadastrados</h2>
            <Badge tone="info">{activeCount} ativo(s)</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50"><tr><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Produto</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Cobrança</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Valor</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Status</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Ações</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                {catalog.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{item.name}</p><p className="text-xs text-slate-500">{PRODUCT_TYPE_LABEL[item.productType as keyof typeof PRODUCT_TYPE_LABEL] ?? item.productType ?? '-'}</p></td>
                    <td className="px-5 py-4 text-sm text-slate-700">{item.pricingMode === 'unit' ? 'Unidade' : item.pricingMode === 'arch' ? 'Arcada' : 'Dente'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">{item.pricingMode === 'unit' ? formatCurrencyBrl(item.unitPrice) : null}{item.pricingMode === 'arch' ? `Sup ${formatCurrencyBrl(item.upperPrice)} | Inf ${formatCurrencyBrl(item.lowerPrice)}` : null}{item.pricingMode === 'tooth' ? `${formatCurrencyBrl(item.toothUnitPrice)} por dente` : null}</td>
                    <td className="px-5 py-4"><Badge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge></td>
                    <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => toggleProduct(item.id, !item.isActive)} disabled={!canWrite}>{item.isActive ? 'Desativar' : 'Ativar'}</Button><Button size="sm" variant="ghost" className="text-red-600" onClick={() => removeProduct(item.id)} disabled={!canWrite}><Trash2 className="h-4 w-4" /></Button></div></td>
                  </tr>
                ))}
                {catalog.length === 0 ? <tr><td className="px-5 py-8 text-sm text-slate-500" colSpan={5}>Nenhum preço cadastrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </AppShell>
  )
}
