import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import type { Clinic } from '../types/Clinic'
import { createClinic, getClinic, restoreClinic, softDeleteClinic, updateClinic } from '../repo/clinicRepo'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import { supabase } from '../lib/supabaseClient'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
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
  const isSupabaseMode = DATA_MODE === 'supabase'
  const supabaseSyncTick = useSupabaseSyncTick()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'clinics.write')
  const canDelete = can(currentUser, 'clinics.delete')
  const isNew = params.id === 'new'
  const existingLocal = useMemo(() => (!isNew && params.id ? getClinic(params.id) : null), [isNew, params.id])

  const [form, setForm] = useState<ClinicForm>(emptyForm)
  const [error, setError] = useState('')
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')
  const [existingSupabase, setExistingSupabase] = useState<Clinic | null>(null)
  const [loadingSupabase, setLoadingSupabase] = useState(false)

  const existing = isSupabaseMode ? existingSupabase : existingLocal

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || isNew || !params.id || !supabase) {
      setExistingSupabase(null)
      setLoadingSupabase(false)
      return
    }

    setLoadingSupabase(true)
    ;(async () => {
      const { data } = await supabase
        .from('clinics')
        .select('id, short_id, trade_name, legal_name, cnpj, phone, whatsapp, email, address, notes, is_active, created_at, updated_at, deleted_at')
        .eq('id', params.id)
        .maybeSingle()
      if (!active) return
      if (!data) {
        setExistingSupabase(null)
        setLoadingSupabase(false)
        return
      }
      setExistingSupabase({
        id: String(data.id),
        shortId: (data.short_id as string | null) ?? undefined,
        tradeName: String(data.trade_name ?? ''),
        legalName: (data.legal_name as string | null) ?? undefined,
        cnpj: (data.cnpj as string | null) ?? undefined,
        phone: (data.phone as string | null) ?? undefined,
        whatsapp: (data.whatsapp as string | null) ?? undefined,
        email: (data.email as string | null) ?? undefined,
        address: (data.address as Clinic['address'] | null) ?? undefined,
        notes: (data.notes as string | null) ?? undefined,
        isActive: Boolean(data.is_active ?? true),
        createdAt: String(data.created_at ?? new Date().toISOString()),
        updatedAt: String(data.updated_at ?? new Date().toISOString()),
        deletedAt: (data.deleted_at as string | null) ?? undefined,
      })
      setLoadingSupabase(false)
    })()

    return () => {
      active = false
    }
  }, [isNew, isSupabaseMode, params.id, supabaseSyncTick])

  useEffect(() => {
    if (!existing) {
      setForm(emptyForm)
      return
    }
    setForm(mapToForm(existing))
  }, [existing])

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
        setCepStatus('Endereco preenchido automaticamente.')
        setCepError('')
      })
      .catch((err: Error) => {
        if (!active) return
        setCepStatus('')
        setCepError(err.message || 'CEP nao encontrado.')
      })

    return () => {
      active = false
    }
  }, [form.address.cep])

  if (!isNew && loadingSupabase) {
    return (
      <AppShell breadcrumb={['Inicio', 'Clinicas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Carregando...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing) {
    return (
      <AppShell breadcrumb={['Inicio', 'Clinicas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Registro nao encontrado</h1>
          <Link to="/app/clinics" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para clinicas
          </Link>
        </Card>
      </AppShell>
    )
  }

  const handleSave = async () => {
    if (!canWrite) {
      setError('Sem permissao para editar clinicas.')
      return
    }
    if (!form.tradeName.trim()) {
      setError('Nome fantasia e obrigatorio.')
      return
    }
    if (form.phone.trim() && !isValidFixedPhone(form.phone)) {
      setError('Telefone fixo invalido.')
      return
    }
    if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) {
      setError('Celular/WhatsApp invalido.')
      return
    }
    if (form.cnpj.trim() && !isValidCnpj(form.cnpj)) {
      setError('CNPJ invalido.')
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
        district: form.address.district.trim() || undefined,
        city: form.address.city.trim() || undefined,
        state: form.address.state.trim() || undefined,
      },
      notes: form.notes.trim() || undefined,
      isActive: form.isActive,
    }

    if (isNew && isSupabaseMode) {
      if (!supabase) {
        setError('Supabase nao configurado.')
        return
      }
      const { data, error: insertError } = await supabase
        .from('clinics')
        .insert({
          trade_name: payload.tradeName,
          legal_name: payload.legalName ?? null,
          cnpj: payload.cnpj ?? null,
          phone: payload.phone ?? null,
          whatsapp: payload.whatsapp ?? null,
          email: payload.email ?? null,
          address: payload.address,
          notes: payload.notes ?? null,
          is_active: payload.isActive,
        })
        .select('id')
        .single()
      if (insertError || !data?.id) {
        setError(insertError?.message ?? 'Falha ao criar clinica.')
        return
      }
      navigate(`/app/clinics/${data.id}`, { replace: true })
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
    if (isSupabaseMode) {
      if (!supabase) {
        setError('Supabase nao configurado.')
        return
      }
      const { error: updateError } = await supabase
        .from('clinics')
        .update({
          trade_name: payload.tradeName,
          legal_name: payload.legalName ?? null,
          cnpj: payload.cnpj ?? null,
          phone: payload.phone ?? null,
          whatsapp: payload.whatsapp ?? null,
          email: payload.email ?? null,
          address: payload.address,
          notes: payload.notes ?? null,
          is_active: payload.isActive,
        })
        .eq('id', existing.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setExistingSupabase((current) => (current ? { ...current, ...payload, updatedAt: new Date().toISOString() } : current))
    } else {
      const result = updateClinic(existing.id, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDelete) return
    const confirmed = window.confirm('Tem certeza que deseja excluir?')
    if (!confirmed) return
    if (isSupabaseMode) {
      if (!supabase) {
        setError('Supabase nao configurado.')
        return
      }
      const now = new Date().toISOString()
      const { error: deleteError } = await supabase
        .from('clinics')
        .update({ deleted_at: now, is_active: false })
        .eq('id', existing.id)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
      setExistingSupabase((current) =>
        current ? { ...current, deletedAt: now, isActive: false, updatedAt: now } : current,
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
    if (isSupabaseMode) {
      if (!supabase) {
        setError('Supabase nao configurado.')
        return
      }
      const now = new Date().toISOString()
      const { error: restoreError } = await supabase
        .from('clinics')
        .update({ deleted_at: null, is_active: true })
        .eq('id', existing.id)
      if (restoreError) {
        setError(restoreError.message)
        return
      }
      setExistingSupabase((current) =>
        current ? { ...current, deletedAt: undefined, isActive: true, updatedAt: now } : current,
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
    <AppShell breadcrumb={['Inicio', 'Clinicas', isNew ? 'Novo' : existing?.tradeName ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Nova clinica' : existing?.tradeName}
          </h1>
          {!isNew && existing ? <p className="mt-1 text-xs font-semibold text-slate-500">{clinicCode(existing.id, existing.shortId)}</p> : null}
          <p className="mt-2 text-sm text-slate-500">
            Clinica {existing?.deletedAt ? '(Excluida)' : ''}
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
              <Input value={form.tradeName} onChange={(event) => setForm((current) => ({ ...current, tradeName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Razao Social</label>
              <Input value={form.legalName} onChange={(event) => setForm((current) => ({ ...current, legalName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CNPJ</label>
              <Input value={form.cnpj} onChange={(event) => setForm((current) => ({ ...current, cnpj: formatCnpj(event.target.value) }))} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
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
              <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: formatFixedPhone(event.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label>
              <Input value={form.whatsapp} onChange={(event) => setForm((current) => ({ ...current, whatsapp: formatMobilePhone(event.target.value) }))} />
              <WhatsappLink value={form.whatsapp} className="mt-2 text-xs font-semibold" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Endereco</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CEP</label>
              <Input
                value={form.address.cep}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, cep: normalizeCep(event.target.value) } }))
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
                  setForm((current) => ({ ...current, address: { ...current.address, street: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Numero</label>
              <Input
                value={form.address.number}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, number: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Bairro</label>
              <Input
                value={form.address.district}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, district: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cidade</label>
              <Input
                value={form.address.city}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, city: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">UF</label>
              <Input
                value={form.address.state}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, state: event.target.value.toUpperCase().slice(0, 2) } }))
                }
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Observacoes</h2>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
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
