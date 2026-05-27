import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import type { DentistClinic } from '../types/DentistClinic'
import {
  createDentist,
  createDentistFirebase,
  getDentist,
  getDentistFirebase,
  restoreDentist,
  restoreDentistFirebase,
  softDeleteDentist,
  softDeleteDentistFirebase,
  updateDentist,
  updateDentistFirebase,
} from '../data/dentistRepo'
import { useDb } from '../lib/useDb'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { getCurrentUser } from '../lib/auth'
import { buildDentistPortalWhatsappHref, buildDentistPortalWhatsappMessage } from '../lib/accessLinks'
import { can } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import { dentistCode } from '../lib/entityCode'
import { loadSystemSettings } from '../lib/systemSettings'
import { isWhatsappServiceReady, sendWhatsappServiceMessage } from '../lib/whatsappService'
import { listClinicsFirebase } from '../repo/clinicRepo'

type DentistForm = {
  firstName: string
  lastName: string
  cpf: string
  birthDate: string
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
    complement: string
    district: string
    city: string
    state: string
  }
  notes: string
  isActive: boolean
}

const emptyForm: DentistForm = {
  firstName: '',
  lastName: '',
  cpf: '',
  birthDate: '',
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
    complement: '',
    district: '',
    city: '',
    state: '',
  },
  notes: '',
  isActive: true,
}

function mapToForm(item: DentistClinic): DentistForm {
  const rawName = item.name?.trim() ?? ''
  const inferredParts = rawName ? rawName.split(/\s+/).filter(Boolean) : []
  const inferredFirst = inferredParts.length ? inferredParts[0] : ''
  const inferredLast = inferredParts.length > 1 ? inferredParts.slice(1).join(' ') : ''
  return {
    firstName: item.firstName ?? inferredFirst,
    lastName: item.lastName ?? inferredLast,
    cpf: item.cpf ?? '',
    birthDate: item.birthDate ?? '',
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
      complement: item.address?.complement ?? '',
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
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'dentists.write')
  const canDelete = can(currentUser, 'dentists.delete')
  const isFirebaseMode = DATA_MODE === 'firebase'
  const isNew = params.id === 'new'
  const localExisting = useMemo(
    () => (!isNew && params.id ? getDentist(params.id) : null),
    [isNew, params.id],
  )
  const [firebaseExisting, setFirebaseExisting] = useState<DentistClinic | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const existing = isFirebaseMode ? firebaseExisting : localExisting

  const [form, setForm] = useState<DentistForm>(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')

  const [firebaseClinics, setFirebaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const clinics = useMemo(
    () => (isFirebaseMode ? firebaseClinics : db.clinics.filter((item) => !item.deletedAt)),
    [db.clinics, firebaseClinics, isFirebaseMode],
  )

  useEffect(() => {
    if (!isFirebaseMode) {
      setFirebaseClinics([])
      return
    }
    let active = true
    void (async () => {
      const clinics = await listClinicsFirebase({ includeDeleted: false })
      if (!active) return
      setFirebaseClinics(clinics.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName })))
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  useEffect(() => {
    if (!isFirebaseMode || isNew || !params.id) {
      setFirebaseExisting(null)
      if (!isFirebaseMode) setLoadingExisting(false)
      return
    }
    let active = true
    setLoadingExisting(true)
    void (async () => {
      const data = await getDentistFirebase(params.id!)
      if (!active) return
      setFirebaseExisting(data)
      setLoadingExisting(false)
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode, isNew, params.id])

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

  const namePrefix = form.gender === 'feminino' ? 'Dra.' : 'Dr.'
  const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
  const headerName = fullName ? `${namePrefix} ${fullName}` : ''
  const dentistPortalWhatsappMessage = useMemo(
    () =>
      buildDentistPortalWhatsappMessage({
        dentistName: headerName || existing?.name,
        email: form.email,
      }),
    [existing?.name, form.email, headerName],
  )
  const dentistPortalWhatsappHref = useMemo(
    () =>
      buildDentistPortalWhatsappHref({
        dentistName: headerName || existing?.name,
        whatsapp: form.whatsapp,
        email: form.email,
      }),
    [existing?.name, form.email, form.whatsapp, headerName],
  )

  const shareDentistPortalAccess = async () => {
    if (!dentistPortalWhatsappHref) return

    const settings = loadSystemSettings()
    if (isWhatsappServiceReady(settings.whatsappService) && dentistPortalWhatsappMessage) {
      const result = await sendWhatsappServiceMessage(
        { whatsappService: settings.whatsappService },
        {
          to: form.whatsapp,
          message: dentistPortalWhatsappMessage,
          kind: 'dentist_portal_access',
          metadata: { dentistId: existing?.id ?? '', email: form.email },
        },
      )
      if (result.ok) {
        addToast({ type: 'success', title: 'Acesso enviado pelo WhatsApp' })
        return
      }
      addToast({ type: 'error', title: 'Serviço WhatsApp indisponível', message: result.error })
    }

    window.open(dentistPortalWhatsappHref, '_blank', 'noopener,noreferrer')
  }

  if (!isNew && loadingExisting) {
    return (
      <AppShell breadcrumb={['Início', 'Dentistas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Carregando registro...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing && !loadingExisting) {
    return (
      <AppShell breadcrumb={['Início', 'Dentistas']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Registro não encontrado</h1>
          <Link to="/app/dentists" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para dentistas
          </Link>
        </Card>
      </AppShell>
    )
  }

  const handleSave = async () => {
    if (!canWrite) {
      setError('Sem permissão para editar dentistas.')
      return
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Nome e sobrenome são obrigatórios.')
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
    const payload = {
      type: 'dentista' as const,
      name: fullName,
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
      cnpj: undefined,
      cro: form.cro.trim() || undefined,
      gender: form.gender,
      cpf: form.cpf.trim() || undefined,
      birthDate: form.birthDate || undefined,
      clinicId: form.clinicId ? form.clinicId : undefined,
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

    setSaving(true)
    try {
      if (isFirebaseMode) {
        if (isNew) {
          const result = await createDentistFirebase({
            ...payload,
            isActive: payload.isActive ?? true,
          })
          if (!result.ok) {
            setError(result.error)
            return
          }
          addToast({ type: 'success', title: 'Dentista salvo' })
          navigate(`/app/dentists/${result.dentist.id}`, { replace: true })
          return
        }
        if (!existing) return
        const result = await updateDentistFirebase(existing.id, payload)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setFirebaseExisting(result.dentist)
        setError('')
        addToast({ type: 'success', title: 'Dentista salvo' })
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
        addToast({ type: 'success', title: 'Dentista salvo' })
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
      addToast({ type: 'success', title: 'Dentista salvo' })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Nao foi possivel salvar o dentista.'
      setError(message)
      addToast({ type: 'error', title: 'Falha ao salvar', message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDelete) return
    const confirmed = window.confirm('Tem certeza que deseja excluir?')
    if (!confirmed) return
    if (isFirebaseMode) {
      const result = await softDeleteDentistFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
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
    if (isFirebaseMode) {
      const result = await restoreDentistFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFirebaseExisting((current) =>
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
    <AppShell breadcrumb={['Início', 'Dentistas', isNew ? 'Novo' : existing?.name ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Novo dentista' : headerName || existing?.name}
          </h1>
          {!isNew && existing ? <p className="mt-1 text-xs font-semibold text-slate-500">{dentistCode(existing.id, existing.shortId)}</p> : null}
          <p className="mt-2 text-sm text-slate-500">
            Dentista {existing?.deletedAt ? '(Excluído)' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isNew ? (
            <Button
              variant="secondary"
              disabled={!dentistPortalWhatsappHref}
              onClick={
                dentistPortalWhatsappHref
                  ? shareDentistPortalAccess
                  : undefined
              }
            >
              Encaminhar acesso
            </Button>
          ) : null}
          <Link
            to="/app/dentists"
            className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
          >
            Voltar
          </Link>
        </div>
      </section>

      <section className="mt-6 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Identificacao</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <Input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Sobrenome</label>
              <Input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} />
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
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CPF</label>
              <Input value={form.cpf} onChange={(event) => setForm((current) => ({ ...current, cpf: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data de nascimento</label>
              <Input type="date" value={form.birthDate} onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Clínica vinculada</label>
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
                  Abrir clínica
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
          <h2 className="text-lg font-semibold text-slate-900">Endereço</h2>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Número</label>
              <Input
                value={form.address.number}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, number: event.target.value } }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Complemento</label>
              <Input
                value={form.address.complement}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: { ...current.address, complement: event.target.value } }))
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
          <h2 className="text-lg font-semibold text-slate-900">Observações</h2>
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
          {canWrite ? <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button> : null}
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

