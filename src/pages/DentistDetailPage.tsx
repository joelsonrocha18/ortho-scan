import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import type { DentistClinic } from '../types/DentistClinic'
import { createDentist, getDentist, restoreDentist, softDeleteDentist, updateDentist } from '../data/dentistRepo'
import { useDb } from '../lib/useDb'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import { supabase } from '../lib/supabaseClient'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { dentistCode } from '../lib/entityCode'

type DentistForm = {
  name: string
  cro: string
  gender: 'masculino' | 'feminino'
  clinicId: string
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

const emptyForm: DentistForm = {
  name: '',
  cro: '',
  gender: 'masculino',
  clinicId: '',
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

function mapToForm(item: DentistClinic): DentistForm {
  return {
    name: item.name,
    cro: item.cro ?? '',
    gender: item.gender ?? 'masculino',
    clinicId: item.clinicId ?? '',
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

export default function DentistDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'dentists.write')
  const canDelete = can(currentUser, 'dentists.delete')
  const isSupabaseMode = DATA_MODE === 'supabase'
  const supabaseSyncTick = useSupabaseSyncTick()
  const isNew = params.id === 'new'
  const localExisting = useMemo(
    () => (!isNew && params.id ? getDentist(params.id) : null),
    [isNew, params.id],
  )
  const [supabaseExisting, setSupabaseExisting] = useState<DentistClinic | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const existing = isSupabaseMode ? supabaseExisting : localExisting

  const [form, setForm] = useState<DentistForm>(emptyForm)
  const [error, setError] = useState('')
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')

  const [supabaseClinics, setSupabaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const clinics = useMemo(
    () => (isSupabaseMode ? supabaseClinics : db.clinics.filter((item) => !item.deletedAt)),
    [db.clinics, isSupabaseMode, supabaseClinics],
  )

  useEffect(() => {
    if (!isSupabaseMode || !supabase) return
    let active = true
    void (async () => {
      const { data } = await supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null)
      if (!active) return
      setSupabaseClinics(
        ((data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => ({
          id: row.id,
          tradeName: row.trade_name ?? '-',
        })),
      )
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseSyncTick])

  useEffect(() => {
    if (!isSupabaseMode || !supabase || isNew || !params.id) {
      setSupabaseExisting(null)
      setLoadingExisting(false)
      return
    }
    let active = true
    setLoadingExisting(true)
    void (async () => {
      const { data, error } = await supabase
        .from('dentists')
        .select('id, short_id, name, cro, gender, clinic_id, phone, whatsapp, email, notes, is_active, deleted_at, created_at, updated_at')
        .eq('id', params.id)
        .maybeSingle()
      if (!active) return
      if (error || !data) {
        setSupabaseExisting(null)
        setLoadingExisting(false)
        return
      }
      setSupabaseExisting({
        id: String(data.id),
        shortId: (data.short_id as string | null) ?? undefined,
        type: 'dentista',
        name: String(data.name ?? ''),
        cro: (data.cro as string | null) ?? undefined,
        gender: data.gender === 'feminino' ? 'feminino' : 'masculino',
        clinicId: (data.clinic_id as string | null) ?? undefined,
        phone: (data.phone as string | null) ?? undefined,
        whatsapp: (data.whatsapp as string | null) ?? undefined,
        email: (data.email as string | null) ?? undefined,
        notes: (data.notes as string | null) ?? undefined,
        isActive: (data.is_active as boolean | null) ?? true,
        createdAt: (data.created_at as string | undefined) ?? new Date().toISOString(),
        updatedAt: (data.updated_at as string | undefined) ?? new Date().toISOString(),
        deletedAt: (data.deleted_at as string | null) ?? undefined,
      })
      setLoadingExisting(false)
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

  const namePrefix = form.gender === 'feminino' ? 'Dra.' : 'Dr.'
  const headerName = form.name.trim() ? `${namePrefix} ${form.name.trim()}` : ''

  if (!isNew && loadingExisting) {
    return (
      <AppShell breadcrumb={['Inicio', 'Dentistas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Carregando registro...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing && !loadingExisting) {
    return (
      <AppShell breadcrumb={['Inicio', 'Dentistas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Registro nao encontrado</h1>
          <Link to="/app/dentists" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para dentistas
          </Link>
        </Card>
      </AppShell>
    )
  }

  const handleSave = async () => {
    if (!canWrite) {
      setError('Sem permissao para editar dentistas.')
      return
    }
    if (!form.name.trim()) {
      setError('Nome e obrigatorio.')
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
    const payload = {
      type: 'dentista' as const,
      name: form.name.trim(),
      cnpj: undefined,
      cro: form.cro.trim() || undefined,
      gender: form.gender,
      clinicId: form.clinicId ? form.clinicId : undefined,
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

    if (isSupabaseMode && supabase) {
      const supabasePayload = {
        name: payload.name,
        cro: payload.cro ?? null,
        gender: payload.gender,
        clinic_id: payload.clinicId ?? null,
        phone: payload.phone ?? null,
        whatsapp: payload.whatsapp ?? null,
        email: payload.email ?? null,
        notes: payload.notes ?? null,
        is_active: payload.isActive,
      }
      if (isNew) {
        const { data, error: createError } = await supabase
          .from('dentists')
          .insert(supabasePayload)
          .select('id')
          .single()
        if (createError || !data?.id) {
          setError(createError?.message ?? 'Falha ao criar dentista.')
          return
        }
        navigate(`/app/dentists/${data.id as string}`, { replace: true })
        return
      }
      if (!existing) return
      const { error: updateError } = await supabase
        .from('dentists')
        .update({ ...supabasePayload, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setError('')
      return
    }

    if (isNew) {
      const result = createDentist({
        ...payload,
        isActive: payload.isActive ?? true,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      navigate(`/app/dentists/${result.dentist.id}`, { replace: true })
      return
    }

    if (!existing) return
    const result = updateDentist(existing.id, payload)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDelete) return
    const confirmed = window.confirm('Tem certeza que deseja excluir?')
    if (!confirmed) return
    if (isSupabaseMode && supabase) {
      const { error: deleteError } = await supabase
        .from('dentists')
        .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
    } else {
      const result = softDeleteDentist(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
    navigate('/app/dentists', { replace: true })
  }

  const handleRestore = async () => {
    if (!existing) return
    if (!canDelete) return
    if (isSupabaseMode && supabase) {
      const { error: restoreError } = await supabase
        .from('dentists')
        .update({ deleted_at: null, is_active: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (restoreError) {
        setError(restoreError.message)
        return
      }
      setSupabaseExisting((current) =>
        current ? { ...current, deletedAt: undefined, isActive: true } : current,
      )
    } else {
      const result = restoreDentist(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Dentistas', isNew ? 'Novo' : existing?.name ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Novo dentista' : headerName || existing?.name}
          </h1>
          {!isNew && existing ? <p className="mt-1 text-xs font-semibold text-slate-500">{dentistCode(existing.id, existing.shortId)}</p> : null}
          <p className="mt-2 text-sm text-slate-500">
            Dentista {existing?.deletedAt ? '(Excluido)' : ''}
          </p>
        </div>
        <Link
          to="/app/dentists"
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Sexo</label>
              <select
                value={form.gender}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    gender: event.target.value as DentistForm['gender'],
                  }))
                }
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CRO</label>
              <Input value={form.cro} onChange={(event) => setForm((current) => ({ ...current, cro: event.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Clinica vinculada</label>
              <select
                value={form.clinicId}
                onChange={(event) => setForm((current) => ({ ...current, clinicId: event.target.value }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Nenhuma</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.tradeName}
                  </option>
                ))}
              </select>
              {form.clinicId ? (
                <Link to={`/app/clinics/${form.clinicId}`} className="mt-2 inline-flex text-xs font-semibold text-brand-700">
                  Abrir clinica
                </Link>
              ) : null}
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
              <Input
                value={form.whatsapp}
                onChange={(event) => setForm((current) => ({ ...current, whatsapp: formatMobilePhone(event.target.value) }))}
              />
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

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Status</h2>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            <span className="text-sm text-slate-700">{form.isActive ? 'Ativo' : 'Inativo'}</span>
          </div>
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
