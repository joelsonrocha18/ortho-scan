import { useEffect, useMemo, useState } from 'react'
import { Save } from 'lucide-react'
import { can } from '../auth/permissions'
import { useToast } from '../app/ToastProvider'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { listDentistsFirebase } from '../data/dentistRepo'
import { DATA_MODE } from '../data/dataMode'
import AppShell from '../layouts/AppShell'
import { getCurrentUser } from '../lib/auth'
import { loadSystemSettings } from '../lib/systemSettings'
import { useDb } from '../lib/useDb'
import { listClinicsFirebase } from '../repo/clinicRepo'
import { listPatientsFirebase } from '../repo/patientRepo'

type Option = {
  id: string
  label: string
}

type ContractItem = {
  id: string
  patientId: string
  patientName: string
  dentistId?: string
  dentistName?: string
  clinicId?: string
  clinicName?: string
  productName: string
  quantity: number
  totalValue: number
  installments: Array<{ dueDate: string; value: number }>
  status: 'pendente' | 'aprovado' | 'cancelado'
  createdAt: string
}

const CONTRACTS_KEY = 'orthoscan_contracts_v1'

function readContracts() {
  try {
    const raw = localStorage.getItem(CONTRACTS_KEY)
    return raw ? JSON.parse(raw) as ContractItem[] : []
  } catch {
    return []
  }
}

function parseMoney(value: string) {
  const sanitized = value.replace(/[^\d,.-]/g, '').trim()
  const normalized = sanitized.includes(',') ? sanitized.replace(/\./g, '').replace(',', '.') : sanitized
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function ContractsPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'contracts.write')
  const [patients, setPatients] = useState<Option[]>([])
  const [dentists, setDentists] = useState<Option[]>([])
  const [clinics, setClinics] = useState<Option[]>([])
  const [contracts, setContracts] = useState<ContractItem[]>(() => readContracts())
  const [form, setForm] = useState({
    patientId: '',
    dentistId: '',
    clinicId: '',
    productId: '',
    quantity: '1',
    totalValue: '',
    dueDate: todayIso(),
    installmentValue: '',
  })

  const products = loadSystemSettings().priceCatalog ?? []
  const selectedProduct = products.find((item) => item.id === form.productId)
  const summaryValue = parseMoney(form.totalValue)

  useEffect(() => {
    let active = true
    if (DATA_MODE === 'firebase') {
      Promise.all([
        listPatientsFirebase({ includeDeleted: false }),
        listDentistsFirebase({ includeDeleted: false, includeInactive: true }),
        listClinicsFirebase({ includeDeleted: false }),
      ]).then(([patientItems, dentistItems, clinicItems]) => {
        if (!active) return
        setPatients(patientItems.map((item) => ({ id: item.id, label: item.name })))
        setDentists(dentistItems.filter((item) => item.type === 'dentista').map((item) => ({ id: item.id, label: item.name })))
        setClinics(clinicItems.map((item) => ({ id: item.id, label: item.tradeName })))
      }).catch(() => {
        if (active) addToast({ type: 'error', title: 'Falha ao carregar cadastros do Firebase.' })
      })
      return () => {
        active = false
      }
    }

    setPatients(db.patients.filter((item) => !item.deletedAt).map((item) => ({ id: item.id, label: item.name })))
    setDentists(db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt).map((item) => ({ id: item.id, label: item.name })))
    setClinics(db.clinics.filter((item) => !item.deletedAt).map((item) => ({ id: item.id, label: item.tradeName })))
    return () => {
      active = false
    }
  }, [addToast, db.clinics, db.dentists, db.patients])

  const persist = (next: ContractItem[]) => {
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(next))
    setContracts(next)
  }

  const saveContract = () => {
    if (!canWrite) return
    const patient = patients.find((item) => item.id === form.patientId)
    if (!patient) return addToast({ type: 'error', title: 'Selecione um paciente.' })
    const totalValue = summaryValue
    if (totalValue <= 0) return addToast({ type: 'error', title: 'Informe o valor do contrato.' })
    const quantity = Math.max(1, Math.trunc(Number(form.quantity) || 1))
    const installmentValue = parseMoney(form.installmentValue) || totalValue
    const dentist = dentists.find((item) => item.id === form.dentistId)
    const clinic = clinics.find((item) => item.id === form.clinicId)
    const now = new Date().toISOString()
    persist([
      {
        id: `contract_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        patientId: patient.id,
        patientName: patient.label,
        dentistId: dentist?.id,
        dentistName: dentist?.label,
        clinicId: clinic?.id,
        clinicName: clinic?.label,
        productName: selectedProduct?.name ?? 'Produto ou serviço',
        quantity,
        totalValue,
        installments: [{ dueDate: form.dueDate || todayIso(), value: installmentValue }],
        status: 'pendente',
        createdAt: now,
      },
      ...contracts,
    ])
    setForm({ patientId: '', dentistId: '', clinicId: '', productId: '', quantity: '1', totalValue: '', dueDate: todayIso(), installmentValue: '' })
    addToast({ type: 'success', title: 'Contrato salvo' })
  }

  const changeStatus = (id: string, status: ContractItem['status']) => {
    if (!canWrite) return
    persist(contracts.map((item) => item.id === id ? { ...item, status } : item))
  }

  const totals = useMemo(() => ({
    total: contracts.reduce((sum, item) => sum + item.totalValue, 0),
    pending: contracts.filter((item) => item.status === 'pendente').length,
  }), [contracts])

  return (
    <AppShell breadcrumb={['Início', 'Contratos']}>
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-700">Contratos e faturamento</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Gestão financeira de contratos</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="info">{formatCurrency(totals.total)}</Badge>
          <Badge tone={totals.pending > 0 ? 'neutral' : 'success'}>{totals.pending} pendente(s)</Badge>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Novo contrato</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Paciente</label><select value={form.patientId} onChange={(event) => setForm((current) => ({ ...current, patientId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="">Selecione</option>{patients.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Dentista</label><select value={form.dentistId} onChange={(event) => setForm((current) => ({ ...current, dentistId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="">Selecione</option>{dentists.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Clínica</label><select value={form.clinicId} onChange={(event) => setForm((current) => ({ ...current, clinicId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="">Selecione</option>{clinics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
            <div className="lg:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Produto ou serviço</label><select value={form.productId} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm"><option value="">Produto ou serviço</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Quantidade</label><Input value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Valor total</label><Input value={form.totalValue} onChange={(event) => setForm((current) => ({ ...current, totalValue: event.target.value }))} placeholder="R$ 0,00" /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Vencimento</label><Input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Valor da parcela</label><Input value={form.installmentValue} onChange={(event) => setForm((current) => ({ ...current, installmentValue: event.target.value }))} placeholder="Valor" /></div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={saveContract} disabled={!canWrite}><Save className="mr-2 h-4 w-4" />Salvar contrato</Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Resumo previsto</h2>
          <div className="mt-4 rounded-lg border border-baby-200 bg-baby-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Valor do contrato</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(summaryValue)}</p>
          </div>
          <div className="mt-4 text-sm text-slate-600">
            {selectedProduct ? `Produto selecionado: ${selectedProduct.name}` : 'Selecione produtos para calcular a baixa prevista.'}
          </div>
        </Card>
      </section>

      <section className="mt-4">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Contratos</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50"><tr><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Paciente</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Dentista</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Clínica</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Valor</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Status</th><th className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Ações</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                {contracts.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{item.patientName}</p><p className="text-xs text-slate-500">{item.productName} x{item.quantity}</p></td>
                    <td className="px-5 py-4 text-sm text-slate-700">{item.dentistName ?? '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">{item.clinicName ?? '-'}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">{formatCurrency(item.totalValue)}</td>
                    <td className="px-5 py-4"><Badge tone={item.status === 'aprovado' ? 'success' : item.status === 'cancelado' ? 'danger' : 'neutral'}>{item.status}</Badge></td>
                    <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => changeStatus(item.id, 'aprovado')} disabled={!canWrite}>Aprovar</Button><Button size="sm" variant="ghost" onClick={() => changeStatus(item.id, 'cancelado')} disabled={!canWrite}>Cancelar</Button></div></td>
                  </tr>
                ))}
                {contracts.length === 0 ? <tr><td className="px-5 py-8 text-sm text-slate-500" colSpan={6}>Nenhum contrato cadastrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </AppShell>
  )
}
