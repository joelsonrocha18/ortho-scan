import { CheckCircle2, FilePenLine, GitBranch, Plus, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import AppShell from '../layouts/AppShell'
import { listDentistsAsync } from '../data/dentistRepo'
import { approveContractAsync, computeContractConsumptionSummary, createContractAsync, listContractsAsync, startContractRenegotiationAsync, updateContractAsync } from '../repo/contractRepo'
import { listClinicsAsync } from '../repo/clinicRepo'
import { listInventoryMaterialsAsync } from '../repo/inventoryRepo'
import { listPatientsAsync } from '../repo/patientRepo'
import { listProductPoliciesAsync } from '../repo/productPolicyRepo'
import { nowIsoDate } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { Clinic } from '../types/Clinic'
import type { Contract, ContractItem, ContractPaymentTerm, ContractStatus, InventoryMaterial, ProductPolicy } from '../types/Commercial'
import type { DentistClinic } from '../types/DentistClinic'
import type { Patient } from '../types/Patient'

type ContractItemDraft = {
  productId: string
  quantity: string
}

type PaymentTermDraft = {
  id?: string
  dueDate: string
  amount: string
}

type ContractForm = {
  id?: string
  patientId: string
  dentistId: string
  clinicId: string
  totalValue: string
  items: ContractItemDraft[]
  paymentTerms: PaymentTermDraft[]
}

const selectClass =
  'h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

const emptyForm: ContractForm = {
  patientId: '',
  dentistId: '',
  clinicId: '',
  totalValue: '',
  items: [{ productId: '', quantity: '1' }],
  paymentTerms: [{ dueDate: nowIsoDate(), amount: '' }],
}

const statusLabels: Record<ContractStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovado',
  renegotiating: 'Em renegociação',
  archived: 'Arquivado',
}

function parseNumber(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function toContractItems(form: ContractForm): ContractItem[] {
  return form.items
    .map((item) => ({
      productId: item.productId,
      quantity: parseNumber(item.quantity),
    }))
    .filter((item) => item.productId && item.quantity > 0)
}

function toPaymentTerms(form: ContractForm): ContractPaymentTerm[] {
  return form.paymentTerms
    .map((item) => ({
      id: item.id ?? createEntityId('term'),
      dueDate: item.dueDate,
      amount: parseNumber(item.amount),
      status: 'planned' as const,
    }))
    .filter((item) => item.dueDate && item.amount > 0)
}

export default function BillingContractsPage() {
  const { addToast } = useToast()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [products, setProducts] = useState<ProductPolicy[]>([])
  const [materials, setMaterials] = useState<InventoryMaterial[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [dentists, setDentists] = useState<DentistClinic[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [form, setForm] = useState<ContractForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const productById = useMemo(() => new Map(products.map((item) => [item.id, item])), [products])
  const patientById = useMemo(() => new Map(patients.map((item) => [item.id, item])), [patients])
  const dentistById = useMemo(() => new Map(dentists.map((item) => [item.id, item])), [dentists])
  const clinicById = useMemo(() => new Map(clinics.map((item) => [item.id, item])), [clinics])
  const items = useMemo(() => toContractItems(form), [form])
  const itemsTotal = items.reduce((total, item) => total + (productById.get(item.productId)?.salePrice ?? 0) * item.quantity, 0)
  const totalValue = parseNumber(form.totalValue) || itemsTotal
  const predictedConsumption = useMemo(() => computeContractConsumptionSummary(items, products, materials), [items, materials, products])

  const reload = async () => {
    const [nextContracts, nextProducts, nextMaterials, nextPatients, nextDentists, nextClinics] = await Promise.all([
      listContractsAsync(),
      listProductPoliciesAsync(),
      listInventoryMaterialsAsync(),
      listPatientsAsync({ includeDeleted: false }),
      listDentistsAsync({ includeDeleted: false, includeInactive: false }),
      listClinicsAsync({ includeDeleted: false }),
    ])
    setContracts(nextContracts)
    setProducts(nextProducts)
    setMaterials(nextMaterials)
    setPatients(nextPatients)
    setDentists(nextDentists)
    setClinics(nextClinics)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    reload()
      .catch((error) => {
        console.error('Falha ao carregar contratos.', error)
        addToast({ type: 'error', title: 'Falha ao carregar', message: 'Não foi possível carregar contratos e cadastros.' })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [addToast])

  const updateItem = (index: number, patch: Partial<ContractItemDraft>) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  }

  const updateTerm = (index: number, patch: Partial<PaymentTermDraft>) => {
    setForm((current) => ({
      ...current,
      paymentTerms: current.paymentTerms.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  }

  const editContract = (contract: Contract) => {
    setForm({
      id: contract.id,
      patientId: contract.patientId,
      dentistId: contract.dentistId,
      clinicId: contract.clinicId,
      totalValue: String(contract.totalValue).replace('.', ','),
      items: contract.items.map((item) => ({ productId: item.productId, quantity: String(item.quantity).replace('.', ',') })),
      paymentTerms: contract.paymentTerms.length
        ? contract.paymentTerms.map((item) => ({ id: item.id, dueDate: item.dueDate, amount: String(item.amount).replace('.', ',') }))
        : [{ dueDate: nowIsoDate(), amount: '' }],
    })
  }

  const handlePatientChange = (patientId: string) => {
    const patient = patientById.get(patientId)
    setForm((current) => ({
      ...current,
      patientId,
      dentistId: patient?.primaryDentistId ?? current.dentistId,
      clinicId: patient?.clinicId ?? current.clinicId,
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = {
      patientId: form.patientId,
      dentistId: form.dentistId,
      clinicId: form.clinicId,
      totalValue,
      items,
      paymentTerms: toPaymentTerms(form),
    }
    const result = form.id
      ? await updateContractAsync(form.id, payload)
      : await createContractAsync(payload)
    setSaving(false)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Não foi possível salvar', message: result.error })
      return
    }
    addToast({ type: 'success', title: form.id ? 'Contrato atualizado' : 'Contrato criado', message: 'Dados financeiros e itens foram salvos.' })
    setForm(emptyForm)
    await reload()
  }

  const handleApprove = async (contract: Contract) => {
    const result = await approveContractAsync(contract.id)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Aprovação bloqueada', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Contrato aprovado', message: `${result.movementsApplied} movimentação(ões) de estoque aplicadas.` })
    await reload()
  }

  const handleRenegotiate = async (contract: Contract) => {
    const result = await startContractRenegotiationAsync(contract.id)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Renegociação bloqueada', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Nova versão criada', message: `Versão ${result.draft.version} criada como rascunho.` })
    editContract(result.draft)
    await reload()
  }

  return (
    <AppShell breadcrumb={['Início', 'Contratos']}>
      <div className="flex flex-col gap-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">Contratos e faturamento</p>
          <h1 className="text-2xl font-bold text-slate-950">Gestão financeira de contratos</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Vincule paciente, dentista e clínica, planeje parcelas e aprove contratos com baixa automática de insumos.
          </p>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{form.id ? 'Editar rascunho' : 'Novo contrato'}</h2>
                <p className="text-sm text-slate-500">O consumo previsto é calculado pela ficha técnica dos produtos.</p>
              </div>
              {form.id ? <Button variant="secondary" onClick={() => setForm(emptyForm)}>Novo</Button> : null}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Paciente</span>
                <select className={selectClass} value={form.patientId} onChange={(event) => handlePatientChange(event.target.value)}>
                  <option value="">Selecione</option>
                  {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Dentista</span>
                <select className={selectClass} value={form.dentistId} onChange={(event) => setForm((current) => ({ ...current, dentistId: event.target.value }))}>
                  <option value="">Selecione</option>
                  {dentists.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.name}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Clínica</span>
                <select className={selectClass} value={form.clinicId} onChange={(event) => setForm((current) => ({ ...current, clinicId: event.target.value }))}>
                  <option value="">Selecione</option>
                  {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.tradeName}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Itens contratados</h3>
                <Button variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { productId: '', quantity: '1' }] }))}>
                  <Plus className="mr-2 h-4 w-4" />
                  Item
                </Button>
              </div>
              <div className="space-y-3">
                {form.items.map((item, index) => (
                  <div key={`${index}-${item.productId}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[minmax(0,1fr)_120px]">
                    <select className={selectClass} value={item.productId} onChange={(event) => updateItem(index, { productId: event.target.value })}>
                      <option value="">Produto ou serviço</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.serviceName}</option>)}
                    </select>
                    <Input inputMode="decimal" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Valor total</span>
                <Input inputMode="decimal" value={form.totalValue} onChange={(event) => setForm((current) => ({ ...current, totalValue: event.target.value }))} placeholder={formatCurrency(itemsTotal)} />
              </label>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Parcelas planejadas</h3>
                  <Button variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, paymentTerms: [...current.paymentTerms, { dueDate: nowIsoDate(), amount: '' }] }))}>
                    <Plus className="mr-2 h-4 w-4" />
                    Parcela
                  </Button>
                </div>
                <div className="space-y-3">
                  {form.paymentTerms.map((term, index) => (
                    <div key={`${index}-${term.id ?? term.dueDate}`} className="grid gap-3 lg:grid-cols-2">
                      <Input type="date" value={term.dueDate} onChange={(event) => updateTerm(index, { dueDate: event.target.value })} />
                      <Input inputMode="decimal" value={term.amount} onChange={(event) => updateTerm(index, { amount: event.target.value })} placeholder="Valor" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={() => void handleSave()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar contrato'}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-950">Resumo previsto</h2>
            <div className="mt-4 rounded-lg border border-baby-200 bg-baby-50 p-4">
              <p className="text-xs font-semibold uppercase text-brand-700">Valor do contrato</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(totalValue)}</p>
            </div>
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-slate-900">Insumos previstos</h3>
              <div className="mt-3 space-y-2">
                {predictedConsumption.length === 0 ? (
                  <p className="text-sm text-slate-500">Selecione produtos para calcular a baixa prevista.</p>
                ) : predictedConsumption.map((item) => (
                  <div key={item.materialId} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-slate-950">{item.materialName}</span>
                      <span className="text-slate-700">{item.quantity.toLocaleString('pt-BR')} {item.unit}</span>
                    </div>
                    <p className="mt-1 text-slate-500">Custo estimado: {formatCurrency(item.estimatedCost)}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">Contratos</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Paciente</th>
                  <th className="px-5 py-3">Dentista</th>
                  <th className="px-5 py-3">Clínica</th>
                  <th className="px-5 py-3">Versão</th>
                  <th className="px-5 py-3">Valor</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr><td className="px-5 py-5 text-slate-500" colSpan={7}>Carregando...</td></tr>
                ) : contracts.length === 0 ? (
                  <tr><td className="px-5 py-5 text-slate-500" colSpan={7}>Nenhum contrato cadastrado.</td></tr>
                ) : contracts.map((contract) => (
                  <tr key={contract.id}>
                    <td className="px-5 py-4 font-medium text-slate-950">{patientById.get(contract.patientId)?.name ?? '-'}</td>
                    <td className="px-5 py-4 text-slate-600">{dentistById.get(contract.dentistId)?.name ?? '-'}</td>
                    <td className="px-5 py-4 text-slate-600">{clinicById.get(contract.clinicId)?.tradeName ?? '-'}</td>
                    <td className="px-5 py-4 text-slate-600">v{contract.version}</td>
                    <td className="px-5 py-4 text-slate-700">{formatCurrency(contract.totalValue)}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{statusLabels[contract.status]}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        {contract.status === 'draft' ? (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => editContract(contract)}>
                              <FilePenLine className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                            <Button size="sm" onClick={() => void handleApprove(contract)}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Aprovar
                            </Button>
                          </>
                        ) : null}
                        {contract.status === 'approved' ? (
                          <Button variant="secondary" size="sm" onClick={() => void handleRenegotiate(contract)}>
                            <GitBranch className="mr-2 h-4 w-4" />
                            Renegociar
                          </Button>
                        ) : null}
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
