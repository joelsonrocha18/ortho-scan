import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import type { Clinic } from '../types/Clinic'
import {
  createClinic,
  createClinicFirebase,
  getClinic,
  getClinicFirebase,
  restoreClinic,
  restoreClinicFirebase,
  softDeleteClinic,
  softDeleteClinicFirebase,
  updateClinic,
  updateClinicFirebase,
} from '../repo/clinicRepo'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import { clinicCode } from '../lib/entityCode'

type ClinicForm = {
  tradeName: string
  legalName: string
  cnpj: string
  phone: string
  whatsapp: string
  email: string
  address: {
    cep: string
    street: string
    number: string
    complement: string
    district: string
    city: string
    state: string
  }
  notes: string
  isActive: boolean
}

const emptyForm: ClinicForm = {
  tradeName: '',
  legalName: '',
  cnpj: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: {
    cep: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
  },
  notes: '',
  isActive: true,
}

function mapToForm(item: Clinic): ClinicForm {
  return {
    tradeName: item.tradeName,
    legalName: item.legalName ?? '',
    cnpj: item.cnpj ?? '',
    phone: item.phone ?? '',
    whatsapp: item.whatsapp ?? '',
    email: item.email ?? '',
    address: {
      cep: item.address?.cep ?? '',
      street: item.address?.street ?? '',
      number: item.address?.number ?? '',
      complement: item.address?.complement ?? '',
      district: item.address?.district ?? '',
      city: item.address?.city ?? '',
      state: item.address?.state ?? '',
    },
    notes: item.notes ?? '',
    isActive: item.isActive,
  }
}

export default function ClinicDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const isFirebaseMode = DATA_MODE === 'firebase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'clinics.write')
  const canDelete = can(currentUser, 'clinics.delete')
  const isNew = params.id === 'new'
  const existingLocal = useMemo(() => (!isNew && params.id ? getClinic(params.id) : null), [isNew, params.id])

  const [form, setForm] = useState<ClinicForm>(emptyForm)
  const [error, setError] = useState('')
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')
  const [existingFirebase, setExistingFirebase] = useState<Clinic | null>(null)
  const [loadingFirebase, setLoadingFirebase] = useState(false)
  const [isFormDirty, setIsFormDirty] = useState(false)
  const hydratedClinicIdRef = useRef<string | null>(null)

  const existing = isFirebaseMode ? existingFirebase : existingLocal

  const patchForm = (updater: (current: ClinicForm) => ClinicForm) => {
    setIsFormDirty(true)
    setForm(updater)
  }

  useEffect(() => {
    let active = true
    if (!isFirebaseMode || isNew || !params.id) {
      setExistingFirebase(null)
      setLoadingFirebase(false)
      return
    }
    setLoadingFirebase(true)
    ;(async () => {
      const data = await getClinicFirebase(params.id!)
      if (!active) return
      setExistingFirebase(data)
      setLoadingFirebase(false)
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode, isNew, params.id])

  useEffect(() => {
    if (!existing) {
      hydratedClinicIdRef.current = null
      setIsFormDirty(false)
      setForm(emptyForm)
      return
    }
    const isNewRecord = hydratedClinicIdRef.current !== existing.id
    if (!isFormDirty || isNewRecord) {
      hydratedClinicIdRef.current = existing.id
      setForm(mapToForm(existing))
      setIsFormDirty(false)
    }
  }, [existing, isFormDirty])

  useEffect(() => {
    const cep = normalizeCep(form.address.cep)
    if (!isValidCep(cep)) {
      setCepStatus('')
      setCepError('')
      return
    }

    let active = true
    fetchCep(cep)
      .then((data) => {
        if (!active) return
        setForm((current) => ({
          ...current,
          address: {
            ...current.address,
            street: data.street || current.address.street,
            district: data.district || current.address.district,
            city: data.city || current.address.city,
            state: data.state || current.address.state,
          },
        }))
        setCepStatus('Endereço preenchido automaticamente.')
        setCepError('')
      })
      .catch((err: Error) => {
        if (!active) return
        setCepStatus('')
        setCepError(err.message || 'CEP não encontrado.')
      })

    return () => {
      active = false
    }
  }, [form.address.cep])

  if (!isNew && loadingFirebase) {
    return (
      <AppShell breadcrumb={['Início', 'Clínicas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Carregando...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing) {
    return (
      <AppShell breadcrumb={['Início', 'Clínicas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Registro não encontrado</h1>
          <Link to="/app/clinics" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para clínicas
          </Link>
        </Card>
      </AppShell>
    )
  }

  const handleSave = async () => {
    if (!canWrite) {
      setError('Sem permissão para editar clínicas.')
      return
    }
    if (!form.tradeName.trim()) {
      setError('Nome fantasia é obrigatório.')
      return
    }
    if (form.phone.trim() && !isValidFixedPhone(form.phone)) {
      setError('Telefone fixo inválido.')
      return
    }
    if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) {
      setError('Celular/WhatsApp inválido.')
      return
    }
    if (form.cnpj.trim() && !isValidCnpj(form.cnpj)) {
      setError('CNPJ inválido.')
      return
    }

    const payload = {
      tradeName: form.tradeName.trim(),
      legalName: form.legalName.trim() || undefined,
      cnpj: form.cnpj.trim() || undefined,
      phone: form.phone.trim() || undefined,
      whatsapp: form.whatsapp.trim() || undefined,
      email: form.email.trim() || undefined,
      address: {
        cep: form.address.cep.trim() || undefined,
        street: form.address.street.trim() || undefined,
        number: form.address.number.trim() || undefined,
        complement: form.address.complement.trim() || undefined,
        district: form.address.district.trim() || undefined,
        city: form.address.city.trim() || undefined,
        state: form.address.state.trim() || undefined,
      },
      notes: form.notes.trim() || undefined,
      isActive: form.isActive,
    }

    if (isNew && isFirebaseMode) {
      const result = await createClinicFirebase({ ...payload, isActive: payload.isActive ?? true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      navigate(`/app/clinics/${result.clinic.id}`, { replace: true })
      return
    }

    if (isNew) {
      const result = createClinic({ ...payload, isActive: payload.isActive ?? true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      navigate(`/app/clinics/${result.clinic.id}`, { replace: true })
      return
    }

    if (!existing) return
    if (isFirebaseMode) {
      const result = await updateClinicFirebase(existing.id, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setExistingFirebase(result.clinic)
      setIsFormDirty(false)
    } else {
      const result = updateClinic(existing.id, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setIsFormDirty(false)
    }
    setError('')
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDelete) return
    const confirmed = window.confirm('Tem certeza que deseja excluir?')
    if (!confirmed) return
    if (isFirebaseMode) {
      const result = await softDeleteClinicFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setExistingFirebase((current) =>
        current ? { ...current, deletedAt: new Date().toISOString(), isActive: false, updatedAt: new Date().toISOString() } : current,
      )
    } else {
      const result = softDeleteClinic(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
  }

  const handleRestore = async () => {
    if (!existing) return
    if (!canDelete) return
    if (isFirebaseMode) {
      const result = await restoreClinicFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setExistingFirebase((current) =>
        current ? { ...current, deletedAt: undefined, isActive: true, updatedAt: new Date().toISOString() } : current,
      )
    } else {
      const result = restoreClinic(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
  }

  return (
    <AppShell breadcrumb={['Início', 'Clínicas', isNew ? 'Novo' : existing?.tradeName ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Nova clínica' : existing?.tradeName}
          </h1>
          {!isNew && existing ? <p className="mt-1 text-xs font-semibold text-slate-500">{clinicCode(existing.id, existing.shortId)}</p> : null}
          <p className="mt-2 text-sm text-slate-500">
            Clínica {existing?.deletedAt ? '(Excluida)' : ''}
          </p>
        </div>
        <Link
          to="/app/clinics"
          className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
        >
          Voltar
        </Link>
      </section>

      <section className="mt-6 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Identificacao</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome Fantasia *</label>
              <Input value={form.tradeName} onChange={(event) => patchForm((current) => ({ ...current, tradeName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Razao Social</label>
              <Input value={form.legalName} onChange={(event) => patchForm((current) => ({ ...current, legalName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CNPJ</label>
              <Input value={form.cnpj} onChange={(event) => patchForm((current) => ({ ...current, cnpj: formatCnpj(event.target.value) }))} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => patchForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              <span className="text-sm text-slate-700">{form.isActive ? 'Ativa' : 'Inativa'}</span>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Contatos</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Telefone fixo</label>
              <Input value={form.phone} onChange={(event) => patchForm((current) => ({ ...current, phone: formatFixedPhone(event.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label>
              <Input value={form.whatsapp} onChange={(event) => patchForm((current) => ({ ...current, whatsapp: formatMobilePhone(event.target.value) }))} />
              <WhatsappLink value={form.whatsapp} className="mt-2 text-xs font-semibold" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => patchForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Endereço</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CEP</label>
              <Input
                value={form.address.cep}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, cep: normalizeCep(event.target.value) } }))
                }
              />
              {cepStatus ? <p className="mt-1 text-xs text-emerald-700">{cepStatus}</p> : null}
              {cepError ? <p className="mt-1 text-xs text-amber-700">{cepError}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Rua</label>
              <Input
                value={form.address.street}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, street: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Número</label>
              <Input
                value={form.address.number}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, number: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Complemento</label>
              <Input
                value={form.address.complement}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, complement: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Bairro</label>
              <Input
                value={form.address.district}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, district: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cidade</label>
              <Input
                value={form.address.city}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, city: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">UF</label>
              <Input
                value={form.address.state}
                onChange={(event) =>
                  patchForm((current) => ({ ...current, address: { ...current.address, state: event.target.value.toUpperCase().slice(0, 2) } }))
                }
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Observações</h2>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(event) => patchForm((current) => ({ ...current, notes: event.target.value }))}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </Card>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          {canWrite ? <Button onClick={handleSave}>Salvar</Button> : null}
          {!isNew && existing?.deletedAt && canDelete ? (
            <Button variant="secondary" onClick={handleRestore}>
              Restaurar
            </Button>
          ) : null}
          {!isNew && !existing?.deletedAt && canDelete ? (
            <Button variant="ghost" onClick={handleDelete} className="text-red-600 hover:text-red-700">
              Excluir
            </Button>
          ) : null}
        </div>
      </section>
    </AppShell>
  )
}

