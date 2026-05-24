import { Archive, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import AppShell from '../layouts/AppShell'
import { cn } from '../lib/cn'
import { listInventoryMaterialsAsync } from '../repo/inventoryRepo'
import { archiveProductPolicyAsync, calculateProductProductionCost, listProductPoliciesAsync, upsertProductPolicyAsync } from '../repo/productPolicyRepo'
import type { InventoryMaterial, InventoryUnit, ProductPolicy, ProductRecipeItem } from '../types/Commercial'

type RecipeDraft = {
  materialId: string
  quantityRequired: string
  unit: InventoryUnit
}

type ProductForm = {
  id?: string
  serviceName: string
  category: string
  salePrice: string
  recipe: RecipeDraft[]
}

const selectClass =
  'h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

const emptyForm: ProductForm = {
  serviceName: '',
  category: 'Alinhadores',
  salePrice: '',
  recipe: [{ materialId: '', quantityRequired: '', unit: 'un' }],
}

const categories = ['Alinhadores', 'Blocos', 'Dentes', 'Biomodelos', 'Guias', 'Contenções', 'Serviços laboratoriais']

function parseNumber(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function toRecipe(form: ProductForm): ProductRecipeItem[] {
  return form.recipe
    .map((item) => ({
      materialId: item.materialId,
      quantityRequired: parseNumber(item.quantityRequired),
      unit: item.unit,
    }))
    .filter((item) => item.materialId && item.quantityRequired > 0)
}

export default function PricingPolicyPage() {
  const { addToast } = useToast()
  const [products, setProducts] = useState<ProductPolicy[]>([])
  const [materials, setMaterials] = useState<InventoryMaterial[]>([])
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const materialById = useMemo(() => new Map(materials.map((item) => [item.id, item])), [materials])
  const recipe = useMemo(() => toRecipe(form), [form])
  const estimatedCost = useMemo(() => calculateProductProductionCost({ recipe }, materials), [materials, recipe])
  const salePrice = parseNumber(form.salePrice)
  const margin = salePrice - estimatedCost
  const marginPercent = salePrice > 0 ? (margin / salePrice) * 100 : 0

  const reload = async () => {
    const [nextProducts, nextMaterials] = await Promise.all([
      listProductPoliciesAsync(),
      listInventoryMaterialsAsync(),
    ])
    setProducts(nextProducts)
    setMaterials(nextMaterials)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    reload()
      .catch((error) => {
        console.error('Falha ao carregar política de preços.', error)
        addToast({ type: 'error', title: 'Falha ao carregar', message: 'Não foi possível carregar produtos e insumos.' })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [addToast])

  const updateRecipe = (index: number, patch: Partial<RecipeDraft>) => {
    setForm((current) => ({
      ...current,
      recipe: current.recipe.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  }

  const editProduct = (product: ProductPolicy) => {
    setForm({
      id: product.id,
      serviceName: product.serviceName,
      category: product.category,
      salePrice: String(product.salePrice).replace('.', ','),
      recipe: product.recipe.length
        ? product.recipe.map((item) => ({
            materialId: item.materialId,
            quantityRequired: String(item.quantityRequired).replace('.', ','),
            unit: item.unit,
          }))
        : [{ materialId: '', quantityRequired: '', unit: 'un' }],
    })
  }

  const resetForm = () => setForm(emptyForm)

  const handleSave = async () => {
    setSaving(true)
    const result = await upsertProductPolicyAsync({
      id: form.id,
      serviceName: form.serviceName,
      category: form.category,
      salePrice,
      recipe,
    })
    setSaving(false)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Não foi possível salvar', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Política salva', message: 'Produto ou serviço atualizado com sucesso.' })
    resetForm()
    await reload()
  }

  const handleArchive = async (product: ProductPolicy) => {
    const result = await archiveProductPolicyAsync(product.id)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Não foi possível arquivar', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Item arquivado', message: `${product.serviceName} saiu da política ativa.` })
    await reload()
  }

  return (
    <AppShell breadcrumb={['Início', 'Política de preços']}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">Produtos e serviços</p>
          <h1 className="text-2xl font-bold text-slate-950">Política de preços</h1>
          <p className="max-w-3xl text-sm text-slate-600">
            Cadastre serviços com ficha técnica, custo estimado de produção e margem antes de publicar o preço final.
          </p>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{form.id ? 'Editar serviço' : 'Novo serviço'}</h2>
                <p className="text-sm text-slate-500">Monte a ficha técnica com os insumos cadastrados no estoque.</p>
              </div>
              {form.id ? (
                <Button variant="secondary" onClick={resetForm}>
                  Novo
                </Button>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <label className="lg:col-span-1">
                <span className="mb-1 block text-sm font-medium text-slate-700">Serviço</span>
                <Input value={form.serviceName} onChange={(event) => setForm((current) => ({ ...current, serviceName: event.target.value }))} placeholder="Ex: Alinhador 12 meses" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Categoria</span>
                <select className={selectClass} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Preço de venda</span>
                <Input inputMode="decimal" value={form.salePrice} onChange={(event) => setForm((current) => ({ ...current, salePrice: event.target.value }))} placeholder="0,00" />
              </label>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Ficha técnica</h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setForm((current) => ({ ...current, recipe: [...current.recipe, { materialId: '', quantityRequired: '', unit: 'un' }] }))}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Insumo
                </Button>
              </div>
              <div className="space-y-3">
                {form.recipe.map((item, index) => {
                  const material = materialById.get(item.materialId)
                  return (
                    <div key={`${index}-${item.materialId}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(0,1fr)_140px_96px_40px]">
                      <select
                        className={selectClass}
                        value={item.materialId}
                        onChange={(event) => {
                          const selected = materialById.get(event.target.value)
                          updateRecipe(index, { materialId: event.target.value, unit: selected?.unit ?? item.unit })
                        }}
                      >
                        <option value="">Selecione um insumo</option>
                        {materials.map((materialOption) => (
                          <option key={materialOption.id} value={materialOption.id}>
                            {materialOption.name}
                          </option>
                        ))}
                      </select>
                      <Input inputMode="decimal" value={item.quantityRequired} onChange={(event) => updateRecipe(index, { quantityRequired: event.target.value })} placeholder="Quantidade" />
                      <Input value={material?.unit ?? item.unit} readOnly />
                      <Button
                        aria-label="Remover insumo"
                        variant="ghost"
                        size="sm"
                        className="h-10 px-2"
                        onClick={() => setForm((current) => ({ ...current, recipe: current.recipe.filter((_, itemIndex) => itemIndex !== index) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={() => void handleSave()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar política'}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-950">Margem prevista</h2>
            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-baby-200 bg-baby-50 p-4">
                <p className="text-xs font-semibold uppercase text-brand-700">Custo estimado de produção</p>
                <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(estimatedCost)}</p>
              </div>
              <div className={cn('rounded-lg border p-4', margin >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50')}>
                <p className="text-xs font-semibold uppercase text-slate-700">Margem real prevista</p>
                <p className={cn('mt-1 text-2xl font-bold', margin >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {formatCurrency(margin)}
                </p>
                <p className="mt-1 text-sm text-slate-600">{Number.isFinite(marginPercent) ? marginPercent.toFixed(1).replace('.', ',') : '0,0'}% sobre o preço final</p>
              </div>
            </div>
          </Card>
        </section>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">Tabela ativa</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Serviço</th>
                  <th className="px-5 py-3">Categoria</th>
                  <th className="px-5 py-3">Preço</th>
                  <th className="px-5 py-3">Custo estimado</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr><td className="px-5 py-5 text-slate-500" colSpan={5}>Carregando...</td></tr>
                ) : products.length === 0 ? (
                  <tr><td className="px-5 py-5 text-slate-500" colSpan={5}>Nenhum serviço cadastrado.</td></tr>
                ) : products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-5 py-4 font-medium text-slate-950">{product.serviceName}</td>
                    <td className="px-5 py-4 text-slate-600">{product.category}</td>
                    <td className="px-5 py-4 text-slate-700">{formatCurrency(product.salePrice)}</td>
                    <td className="px-5 py-4 text-slate-700">{formatCurrency(calculateProductProductionCost(product, materials))}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => editProduct(product)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleArchive(product)}>
                          <Archive className="mr-2 h-4 w-4" />
                          Arquivar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
