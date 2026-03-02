import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, LockKeyhole, Mail, Pause, PenLine, Play, Trash2, UserRound, WandSparkles } from 'lucide-react'
import { getAuthProvider } from '../auth/authProvider'
import { can, groupedPermissionsForRole, permissionLabel, profileDescription, profileLabel, type PermissionModule } from '../auth/permissions'
import { useToast } from '../app/ToastProvider'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import { DATA_MODE } from '../data/dataMode'
import { DB_KEY } from '../data/db'
import AppShell from '../layouts/AppShell'
import { getCurrentUser } from '../lib/auth'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { supabase } from '../lib/supabaseClient'
import {
  addAuditEntry,
  applyTheme,
  loadSystemSettings,
  saveSystemSettings,
  type SystemSettings,
  type PricingArchScope,
  type AppThemeMode,
  type LabCompanyProfile,
  type PricingMode,
} from '../lib/systemSettings'
import { loadSystemSettingsSupabase, saveSystemSettingsSupabase } from '../repo/systemSettingsRepo'
import { createUser, resetUserPassword, setUserActive, softDeleteUser, updateUser } from '../repo/userRepo'
import { requestPasswordReset, sendAccessEmail } from '../repo/accessRepo'
import { listClinicsSupabase, listDentistsSupabase, type ClinicOption, type DentistOption } from '../repo/directoryRepo'
import { inviteUser, listProfiles, setProfileActive, softDeleteProfile, updateProfile } from '../repo/profileRepo'
import { PRODUCT_TYPE_LABEL } from '../types/Product'
import type { Role, User } from '../types/User'
import { useDb } from '../lib/useDb'
import { loadExcelJS } from '../lib/loadExcelJS'

type MainTab = 'registration' | 'users' | 'pricing' | 'system_update' | 'system_diagnostics'
type ModalTab = 'personal' | 'access' | 'profile' | 'link'
type PasswordMode = 'auto' | 'manual'
type ReportDatasetKey = 'patients' | 'dentists' | 'clinics' | 'users' | 'scans' | 'cases' | 'labItems'
type ReportFieldOption = { key: string; label: string }
const ROLE_LIST: Role[] = ['master_admin', 'dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']
const MODULE_ORDER: PermissionModule[] = ['Dashboard', 'Pacientes', 'Scans', 'Alinhadores', 'Laboratorio', 'Usuarios', 'Configuracoes']
const REPORT_DATASETS: Array<{ key: ReportDatasetKey; label: string }> = [
  { key: 'patients', label: 'Pacientes' },
  { key: 'dentists', label: 'Dentistas' },
  { key: 'clinics', label: 'Clinicas' },
  { key: 'users', label: 'Usuarios' },
  { key: 'scans', label: 'Scans' },
  { key: 'cases', label: 'Alinhadores' },
  { key: 'labItems', label: 'Laboratorio' },
]
const TOOTH_OPTIONS = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
]

function parsePriceInput(raw: string) {
  const sanitized = raw.replace(/[^\d,.-]/g, '').trim()
  if (!sanitized) return 0
  const normalized = sanitized.includes(',')
    ? sanitized.replace(/\./g, '').replace(',', '.')
    : sanitized
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function formatCurrencyBrl(value?: number) {
  if (!Number.isFinite(value)) return '-'
  return (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// In Supabase mode, collaborator onboarding via link is for operational profiles only (no admin).
const INVITE_ROLE_LIST: Role[] = ['dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']
const ROLE_REQUIRES_LINK: Role[] = ['dentist_client', 'clinic_client', 'lab_tech', 'receptionist']
const ROLE_REQUIRES_CLINIC: Role[] = ['dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']

function generatePassword(size = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  const p1 = digits.slice(0, 3)
  const p2 = digits.slice(3, 6)
  const p3 = digits.slice(6, 9)
  const p4 = digits.slice(9, 11)
  let out = p1
  if (p2) out += `.${p2}`
  if (p3) out += `.${p3}`
  if (p4) out += `-${p4}`
  return out
}

function formatCep(value: string) {
  const digits = normalizeCep(value)
  const p1 = digits.slice(0, 5)
  const p2 = digits.slice(5, 8)
  return p2 ? `${p1}-${p2}` : p1
}

function composeAddressLine(parts: { street: string; number: string; district: string; city: string; state: string }) {
  return [parts.street, parts.number, parts.district, parts.city, parts.state]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' | ')
}

function splitAddressLine(addressLine?: string) {
  const raw = (addressLine ?? '').trim()
  if (!raw) return { street: '', number: '', district: '', city: '', state: '' }
  if (!raw.includes('|')) {
    const oldParts = raw.split(' - ').map((part) => part.trim())
    const [street = '', district = '', cityState = ''] = oldParts
    const [city = '', state = ''] = cityState.split('/').map((part) => part.trim())
    return { street, number: '', district, city, state }
  }
  const [street = '', number = '', district = '', city = '', state = ''] = raw.split('|').map((part) => part.trim())
  return { street, number, district, city, state }
}

function downloadFile(fileName: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function prettifyFieldLabel(key: string) {
  return key
    .replace(/\./g, ' / ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function flattenForReport(value: unknown, prefix = '', output: Record<string, unknown> = {}) {
  if (value == null) {
    if (prefix) output[prefix] = ''
    return output
  }
  if (Array.isArray(value)) {
    output[prefix] = value
      .map((item) => {
        if (item == null) return ''
        if (typeof item === 'object') return JSON.stringify(item)
        return String(item)
      })
      .join(' | ')
    return output
  }
  if (typeof value !== 'object') {
    output[prefix] = value
    return output
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    if (item != null && typeof item === 'object' && !Array.isArray(item)) {
      flattenForReport(item, nextPrefix, output)
      continue
    }
    flattenForReport(item, nextPrefix, output)
  }
  return output
}

function createdAtDate(input: Record<string, unknown>) {
  const value = input.createdAt ?? input.created_at
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function reportRowProductType(input: Record<string, unknown>) {
  const data = (input.data && typeof input.data === 'object') ? (input.data as Record<string, unknown>) : {}
  const value = input.productType ?? input.product_type ?? data.productType
  return typeof value === 'string' ? value : ''
}

function reportRowProductionStatus(input: Record<string, unknown>) {
  const data = (input.data && typeof input.data === 'object') ? (input.data as Record<string, unknown>) : {}
  const value = input.status ?? data.status
  return typeof value === 'string' ? value : ''
}

function normalizeEmail(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function isValidEmail(value?: string | null) {
  const email = normalizeEmail(value)
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeUserCreationError(error: string) {
  const text = (error ?? '').toLowerCase()
  if (text.includes('idx_profiles_short_id_unique')) {
    return 'Conflito interno ao gerar identificador do usuario. Tente novamente.'
  }
  return error
}

function mapProfilesToUsers(profiles: Awaited<ReturnType<typeof listProfiles>>): User[] {
  return profiles
    .filter((profile) => profile.deleted_at == null && isValidEmail(profile.login_email))
    .map((profile) => ({
      id: profile.user_id,
      name: (profile.full_name ?? '').trim() || (profile.login_email ?? '').trim() || profile.user_id,
      email: normalizeEmail(profile.login_email),
      role: profile.role as Role,
      isActive: Boolean(profile.is_active),
      linkedClinicId: profile.clinic_id ?? undefined,
      linkedDentistId: profile.dentist_id ?? undefined,
      cpf: profile.cpf ?? undefined,
      phone: undefined,
      whatsapp: profile.phone ?? undefined,
      createdAt: profile.created_at ?? '',
      updatedAt: profile.updated_at ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function reloadSupabaseUsers(isSupabaseMode: boolean, onLoaded: (users: User[]) => void) {
  if (!isSupabaseMode) return
  const profiles = await listProfiles()
  const invalidProfiles = profiles.filter((profile) => profile.deleted_at == null && !isValidEmail(profile.login_email))
  if (invalidProfiles.length > 0) {
    await Promise.all(invalidProfiles.map((profile) => softDeleteProfile(profile.user_id)))
  }
  onLoaded(mapProfilesToUsers(profiles))
}

export default function SettingsPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const isSupabaseMode = DATA_MODE === 'supabase'

  const dentistsLocal = useMemo(() => db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt), [db.dentists])
  const clinicsLocal = useMemo(() => db.clinics.filter((item) => !item.deletedAt), [db.clinics])
  const [clinicsSupabase, setClinicsSupabase] = useState<ClinicOption[]>([])
  const [dentistsSupabase, setDentistsSupabase] = useState<DentistOption[]>([])
  const clinicOptions = useMemo<ClinicOption[]>(() => {
    if (isSupabaseMode) return clinicsSupabase
    return clinicsLocal.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName }))
  }, [clinicsLocal, clinicsSupabase, isSupabaseMode])
  const dentistOptions = useMemo<DentistOption[]>(() => {
    if (isSupabaseMode) return dentistsSupabase
    return dentistsLocal.map((dentist) => ({ id: dentist.id, name: dentist.name, clinicId: dentist.clinicId ?? null }))
  }, [dentistsLocal, dentistsSupabase, isSupabaseMode])

  const [supabaseUsers, setSupabaseUsers] = useState<User[]>([])
  const users = useMemo(() => {
    if (isSupabaseMode) return supabaseUsers
    return [...db.users].sort((a, b) => a.name.localeCompare(b.name))
  }, [db.users, isSupabaseMode, supabaseUsers])

  const [mainTab, setMainTab] = useState<MainTab>('registration')
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportDataset, setReportDataset] = useState<ReportDatasetKey>('patients')
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')
  const [reportProductType, setReportProductType] = useState('')
  const [reportProductionStatus, setReportProductionStatus] = useState('')
  const [selectedReportFields, setSelectedReportFields] = useState<string[]>([])
  const [exportingReport, setExportingReport] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>('personal')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('auto')
  const [submittingUser, setSubmittingUser] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', cpf: '', cep: '', birthDate: '', phone: '', whatsapp: '', street: '', number: '', district: '', city: '', state: '', addressLine: '', role: 'receptionist' as Role, isActive: true, linkedDentistId: '', linkedClinicId: '', sendAccessEmail: true })
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')
  const [settingsState, setSettingsState] = useState(() => loadSystemSettings())
  const [labForm, setLabForm] = useState<LabCompanyProfile>(() => loadSystemSettings().labCompany)
  const [priceForm, setPriceForm] = useState<{
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

  const canManageUsers = can(currentUser, 'users.write')
  const canDeleteUsers = can(currentUser, 'users.delete')

  const persistSettings = async (next: SystemSettings) => {
    saveSystemSettings(next)
    if (!isSupabaseMode) return
    await saveSystemSettingsSupabase(next)
  }

  useEffect(() => {
    let active = true
    if (!isSupabaseMode) {
      setClinicsSupabase([])
      setDentistsSupabase([])
      return
    }
    Promise.all([listClinicsSupabase(), listDentistsSupabase()]).then(([clinics, dentists]) => {
      if (!active) return
      setClinicsSupabase(clinics)
      setDentistsSupabase(dentists)
    })
    return () => {
      active = false
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    let active = true
    void (async () => {
      const remote = await loadSystemSettingsSupabase()
      if (!remote || !active) return
      const localDefaults = loadSystemSettings()
      const normalized: SystemSettings = {
        ...localDefaults,
        ...remote,
        aiGateway: {
          ...localDefaults.aiGateway,
          ...(remote.aiGateway ?? {}),
          modules: {
            ...localDefaults.aiGateway.modules,
            ...(remote.aiGateway?.modules ?? {}),
          },
        },
      }
      saveSystemSettings(normalized)
      setSettingsState(normalized)
      setLabForm(normalized.labCompany)
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode])

  useEffect(() => {
    let active = true
    if (!isSupabaseMode) {
      setSupabaseUsers([])
      return
    }
    reloadSupabaseUsers(isSupabaseMode, (loadedUsers) => {
      if (!active) return
      setSupabaseUsers(loadedUsers)
    })
    return () => {
      active = false
    }
  }, [isSupabaseMode])

  const openNew = () => {
    setEditingUser(null)
    setModalTab('personal')
    setPasswordMode(isSupabaseMode ? 'manual' : 'auto')
    setForm({ name: '', username: '', email: '', password: isSupabaseMode ? '' : generatePassword(), cpf: '', cep: '', birthDate: '', phone: '', whatsapp: '', street: '', number: '', district: '', city: '', state: '', addressLine: '', role: 'receptionist', isActive: true, linkedDentistId: '', linkedClinicId: '', sendAccessEmail: true })
    setCepStatus('')
    setCepError('')
    setError(null)
    setModalOpen(true)
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    setModalTab('personal')
    setPasswordMode('manual')
    const addressParts = splitAddressLine(user.addressLine)
    setForm({ name: user.name, username: user.username ?? '', email: user.email, password: '', cpf: user.cpf ?? '', cep: user.cep ?? '', street: addressParts.street, number: addressParts.number, district: addressParts.district, city: addressParts.city, state: addressParts.state, birthDate: user.birthDate ?? '', phone: user.phone ?? '', whatsapp: user.whatsapp ?? '', addressLine: user.addressLine ?? '', role: user.role, isActive: user.isActive, linkedDentistId: user.linkedDentistId ?? '', linkedClinicId: user.linkedClinicId ?? '', sendAccessEmail: false })
    setCepStatus('')
    setCepError('')
    setError(null)
    setModalOpen(true)
  }

  useEffect(() => {
    if (modalOpen) setError(null)
  }, [modalOpen])

  const resolveCep = async () => {
    setCepError('')
    setCepStatus('')
    if (!form.cep.trim()) return
    if (!isValidCep(form.cep)) {
      setCepError('CEP invalido.')
      return
    }
    setCepStatus('Buscando CEP...')
    try {
      const data = await fetchCep(form.cep)
      setForm((current) => ({
        ...current,
        cep: formatCep(current.cep),
        street: data.street || current.street,
        district: data.district || current.district,
        city: data.city || current.city,
        state: data.state || current.state,
      }))
      setCepStatus('CEP localizado.')
    } catch (errorFetch) {
      const message = errorFetch instanceof Error ? errorFetch.message : 'Nao foi possivel localizar o CEP.'
      setCepError(message)
    }
  }

  const submitUser = async () => {
    if (submittingUser) return
    setSubmittingUser(true)
    setError(null)

    try {
      let submitAccessToken = ''
      if (isSupabaseMode) {
        if (!supabase) return setError('Supabase nao configurado.')
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) {
          setError('Sessao expirada. Saia e entre novamente.')
          return
        }
        submitAccessToken = data.session?.access_token ?? ''
        console.info('[settings-users] submit session snapshot', {
          hasSession: Boolean(data.session),
          tokenLength: submitAccessToken.length,
          expiresAt: data.session?.expires_at ?? null,
          userId: data.session?.user?.id ?? null,
        })
        if (!submitAccessToken) {
          setError('Sessao expirada. Saia e entre novamente.')
          return
        }
      }

      if (isSupabaseMode && !editingUser) {
        if (!form.name.trim()) return setError('Nome e obrigatorio.')
        if (!form.email.trim()) return setError('Email e obrigatorio.')
        if (!form.password.trim()) return setError('Senha e obrigatoria.')
        if (form.password.trim().length < 8) return setError('Senha deve ter no minimo 8 caracteres.')
        if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo invalido.')
        if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp invalido.')
        if (!INVITE_ROLE_LIST.includes(form.role)) {
          return setError('Perfil nao permitido para criacao neste modo.')
        }
        if (ROLE_REQUIRES_CLINIC.includes(form.role) && !form.linkedClinicId.trim()) {
          return setError('Clinica vinculada e obrigatoria para este perfil.')
        }
        if (form.role === 'dentist_client' && !form.linkedDentistId.trim()) {
          return setError('Dentista responsavel e obrigatorio para perfil Dentista Cliente.')
        }
        const result = await inviteUser({
          email: form.email.trim(),
          role: form.role,
          clinicId: form.linkedClinicId || clinicOptions[0]?.id || '',
          dentistId: form.linkedDentistId || undefined,
          fullName: form.name.trim() || undefined,
          password: form.password.trim(),
          cpf: form.cpf.trim() || undefined,
          phone: form.whatsapp.trim() || undefined,
          accessToken: submitAccessToken,
        })
        if (!result.ok) {
          if (result.code === 'unauthorized') return setError('Sessao expirada. Saia e entre novamente.')
          if (result.code === 'forbidden') return setError('Sem permissao para criar usuarios.')
          if (result.code === 'network_error') return setError(result.error)
          return setError(normalizeUserCreationError(result.error))
        }
        await reloadSupabaseUsers(isSupabaseMode, setSupabaseUsers)
        setModalOpen(false)
        addToast({ type: 'success', title: 'Usuario criado', message: 'Acesso liberado com email e senha cadastrados.' })
        return
      }

      if (isSupabaseMode && editingUser) {
        if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo invalido.')
        if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp invalido.')
        const result = await updateProfile(editingUser.id, {
          full_name: form.name.trim() || null,
          cpf: form.cpf.trim() || null,
          phone: form.whatsapp.trim() || null,
          role: form.role,
          clinic_id: form.linkedClinicId.trim() || null,
          dentist_id: form.linkedDentistId.trim() || null,
          is_active: form.isActive,
        })
        if (!result.ok) return setError(result.error)
        await reloadSupabaseUsers(isSupabaseMode, setSupabaseUsers)
        setModalOpen(false)
        if (currentUser?.id === editingUser.id) {
          await getAuthProvider().getCurrentUser()
        }
        addToast({ type: 'success', title: 'Usuario atualizado' })
        return
      }

      if (!form.name.trim() || !form.email.trim()) return setError('Nome e email sao obrigatorios.')
      if (!editingUser && !form.password.trim()) return setError('Senha e obrigatoria para novo usuario.')
      if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo invalido.')
      if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp invalido.')
      const basePayload = {
        name: form.name.trim(),
        username: form.username.trim() || undefined,
        email: form.email.trim(),
        cpf: form.cpf.trim() || undefined,
        cep: form.cep.trim() || undefined,
        birthDate: form.birthDate || undefined,
        phone: form.phone.trim() || undefined,
        whatsapp: form.whatsapp.trim() || undefined,
        addressLine: composeAddressLine({
          street: form.street,
          number: form.number,
          district: form.district,
          city: form.city,
          state: form.state,
        }) || undefined,
        role: form.role,
        isActive: form.isActive,
        linkedDentistId: form.linkedDentistId || undefined,
        linkedClinicId: form.linkedClinicId || undefined,
      }
      const result = editingUser
        ? updateUser(editingUser.id, { ...basePayload, ...(form.password.trim() ? { password: form.password.trim() } : {}) })
        : createUser({ ...basePayload, password: form.password.trim() })
      if (!result.ok) return setError(result.error)
      setModalOpen(false)
      addToast({ type: 'success', title: editingUser ? 'Usuario atualizado' : 'Usuario criado' })
    } finally {
      setSubmittingUser(false)
    }
  }

  const linkage = (user: User) => {
    if (user.role === 'dentist_client') return dentistOptions.find((item) => item.id === user.linkedDentistId)?.name ?? '-'
    if (user.role === 'clinic_client') return clinicOptions.find((item) => item.id === user.linkedClinicId)?.tradeName ?? '-'
    if (user.role === 'lab_tech') return 'Laboratorio'
    return '-'
  }

  const saveTheme = (theme: AppThemeMode) => {
    applyTheme(theme)
    const next = addAuditEntry({ ...settingsState, theme }, { action: 'theme_changed', actor: currentUser?.email, details: theme })
    void persistSettings(next)
    setSettingsState(next)
  }

  const saveLab = () => {
    if (!labForm.tradeName.trim() || !labForm.legalName.trim() || !isValidCnpj(labForm.cnpj) || !labForm.email.trim() || !labForm.phone.trim() || !labForm.addressLine.trim()) {
      addToast({ type: 'error', title: 'Preencha os dados obrigatorios do laboratorio.' })
      return
    }
    if (!isValidFixedPhone(labForm.phone)) {
      addToast({ type: 'error', title: 'Telefone fixo do laboratorio invalido.' })
      return
    }
    if (labForm.whatsapp.trim() && !isValidMobilePhone(labForm.whatsapp)) {
      addToast({ type: 'error', title: 'Celular/WhatsApp do laboratorio invalido.' })
      return
    }
    const next = addAuditEntry({ ...settingsState, labCompany: { ...labForm, cnpj: formatCnpj(labForm.cnpj), updatedAt: new Date().toISOString() } }, { action: 'lab_profile_updated', actor: currentUser?.email, details: labForm.tradeName })
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'success', title: 'Cadastro salvo' })
  }

  const saveGuideAutomation = () => {
    const leadDays = Math.max(0, Math.trunc(settingsState.guideAutomation?.leadDays ?? 10))
    const next = addAuditEntry(
      {
        ...settingsState,
        guideAutomation: {
          enabled: settingsState.guideAutomation?.enabled !== false,
          leadDays,
        },
      },
      {
        action: 'settings.guide_automation.updated',
        actor: currentUser?.email,
        details: `enabled=${settingsState.guideAutomation?.enabled !== false}; leadDays=${leadDays}`,
      },
    )
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'success', title: 'Automacao de guias salva' })
  }

  const saveAiGateway = () => {
    const ai = settingsState.aiGateway
    const next = addAuditEntry(
      {
        ...settingsState,
        aiGateway: {
          enabled: ai.enabled !== false,
          modules: {
            clinica: ai.modules?.clinica !== false,
            lab: ai.modules?.lab !== false,
            gestao: ai.modules?.gestao !== false,
            comercial: ai.modules?.comercial !== false,
          },
          provider: ai.provider === 'http' || ai.provider === 'openai' ? ai.provider : 'mock',
          model: ai.model?.trim() || 'gpt-4.1-mini',
          apiBaseUrl: ai.apiBaseUrl?.trim() || '',
          apiKey: ai.apiKey ?? '',
        },
      },
      {
        action: 'settings.ai_gateway.updated',
        actor: currentUser?.email,
        details: `enabled=${ai.enabled !== false}; provider=${ai.provider}; model=${ai.model}`,
      },
    )
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'success', title: 'Configuracoes de IA salvas' })
  }

  const addPriceProduct = () => {
    const productType = priceForm.productFlow === 'alinhador' ? 'alinhador_12m' : 'biomodelo'
    const name = priceForm.customName.trim()
    if (!name) {
      addToast({ type: 'error', title: 'Informe o nome do produto.' })
      return
    }
    if (priceForm.pricingMode === 'unit' && parsePriceInput(priceForm.unitPrice) <= 0) {
      addToast({ type: 'error', title: 'Informe um preco por unidade valido.' })
      return
    }
    if (priceForm.pricingMode === 'arch') {
      const upper = parsePriceInput(priceForm.upperPrice)
      const lower = parsePriceInput(priceForm.lowerPrice)
      if (priceForm.archScope === 'superior' && upper <= 0) {
        addToast({ type: 'error', title: 'Informe preco da arcada superior.' })
        return
      }
      if (priceForm.archScope === 'inferior' && lower <= 0) {
        addToast({ type: 'error', title: 'Informe preco da arcada inferior.' })
        return
      }
      if (priceForm.archScope === 'ambas' && upper <= 0 && lower <= 0) {
        addToast({ type: 'error', title: 'Informe preco por arcada superior e/ou inferior.' })
        return
      }
    }
    if (priceForm.pricingMode === 'tooth') {
      if (parsePriceInput(priceForm.toothUnitPrice) <= 0) {
        addToast({ type: 'error', title: 'Informe o preco por dente.' })
        return
      }
      if (!priceForm.selectedTeeth.length) {
        addToast({ type: 'error', title: 'Selecione ao menos um dente para esta politica.' })
        return
      }
    }
    const now = new Date().toISOString()
    const nextCatalog = [
      {
        id: `price_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        name,
        productType: productType || undefined,
        pricingMode: priceForm.pricingMode,
        archScope: priceForm.pricingMode === 'arch' ? priceForm.archScope : undefined,
        unitPrice: priceForm.pricingMode === 'unit' ? parsePriceInput(priceForm.unitPrice) : undefined,
        upperPrice: priceForm.pricingMode === 'arch' && priceForm.archScope !== 'inferior' ? parsePriceInput(priceForm.upperPrice) : undefined,
        lowerPrice: priceForm.pricingMode === 'arch' && priceForm.archScope !== 'superior' ? parsePriceInput(priceForm.lowerPrice) : undefined,
        toothUnitPrice: priceForm.pricingMode === 'tooth' ? parsePriceInput(priceForm.toothUnitPrice) : undefined,
        selectedTeeth: priceForm.pricingMode === 'tooth' ? priceForm.selectedTeeth : undefined,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      ...(settingsState.priceCatalog ?? []),
    ]
    const next = addAuditEntry(
      {
        ...settingsState,
        priceCatalog: nextCatalog,
      },
      { action: 'settings.pricing.add', actor: currentUser?.email, details: `Produto: ${name}` },
    )
    void persistSettings(next)
    setSettingsState(next)
    setPriceForm({
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
    addToast({ type: 'success', title: 'Produto adicionado na politica de preco.' })
  }

  const removePriceProduct = (id: string) => {
    const current = settingsState.priceCatalog ?? []
    const target = current.find((item) => item.id === id)
    if (!target) return
    if (!window.confirm(`Excluir o produto ${target.name} da politica de preco?`)) return
    const next = addAuditEntry(
      {
        ...settingsState,
        priceCatalog: current.filter((item) => item.id !== id),
      },
      { action: 'settings.pricing.delete', actor: currentUser?.email, details: `Produto: ${target.name}` },
    )
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'info', title: 'Produto removido da politica de preco.' })
  }

  const togglePriceProductActive = (id: string, isActive: boolean) => {
    const current = settingsState.priceCatalog ?? []
    const target = current.find((item) => item.id === id)
    if (!target) return
    const nextCatalog = current.map((item) =>
      item.id === id ? { ...item, isActive, updatedAt: new Date().toISOString() } : item,
    )
    const next = addAuditEntry(
      {
        ...settingsState,
        priceCatalog: nextCatalog,
      },
      { action: 'settings.pricing.toggle', actor: currentUser?.email, details: `${target.name}: ${isActive ? 'ativo' : 'inativo'}` },
    )
    void persistSettings(next)
    setSettingsState(next)
  }

  const exportBackup = () => {
    downloadFile(`backup_orthoscan_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ db: JSON.parse(localStorage.getItem(DB_KEY) ?? '{}'), settings: settingsState }, null, 2), 'application/json')
  }

  const modalPermissions = groupedPermissionsForRole(form.role)
  const showLinkTab = !isSupabaseMode || ROLE_REQUIRES_LINK.includes(form.role)
  const availableRoleList = isSupabaseMode && !editingUser ? INVITE_ROLE_LIST : ROLE_LIST
  const dentistsForSelect = useMemo(() => {
    if (form.role !== 'dentist_client') return dentistOptions
    if (!form.linkedClinicId) return dentistOptions
    return dentistOptions.filter((dentist) => (dentist.clinicId ? dentist.clinicId === form.linkedClinicId : true))
  }, [dentistOptions, form.linkedClinicId, form.role])

  const reportRows = useMemo<Record<string, unknown>[]>(() => {
    const byDataset: Record<ReportDatasetKey, Record<string, unknown>[]> = {
      patients: db.patients as unknown as Record<string, unknown>[],
      dentists: db.dentists as unknown as Record<string, unknown>[],
      clinics: db.clinics as unknown as Record<string, unknown>[],
      users: users as unknown as Record<string, unknown>[],
      scans: db.scans as unknown as Record<string, unknown>[],
      cases: db.cases as unknown as Record<string, unknown>[],
      labItems: db.labItems as unknown as Record<string, unknown>[],
    }
    return byDataset[reportDataset] ?? []
  }, [db.cases, db.clinics, db.dentists, db.labItems, db.patients, db.scans, reportDataset, users])

  const reportFieldOptions = useMemo<ReportFieldOption[]>(() => {
    const keys = new Set<string>()
    reportRows.forEach((row) => {
      const flattened = flattenForReport(row)
      Object.keys(flattened).forEach((key) => keys.add(key))
    })
    return Array.from(keys)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({ key, label: prettifyFieldLabel(key) }))
  }, [reportRows])

  const reportProductTypeOptions = useMemo(() => {
    const options = new Set<string>()
    reportRows.forEach((row) => {
      const value = reportRowProductType(row)
      if (value) options.add(value)
    })
    return Array.from(options).sort((a, b) => a.localeCompare(b))
  }, [reportRows])

  const reportStatusOptions = useMemo(() => {
    const options = new Set<string>()
    reportRows.forEach((row) => {
      const value = reportRowProductionStatus(row)
      if (value) options.add(value)
    })
    return Array.from(options).sort((a, b) => a.localeCompare(b))
  }, [reportRows])

  useEffect(() => {
    setSelectedReportFields((current) => {
      const allowed = new Set(reportFieldOptions.map((item) => item.key))
      const valid = current.filter((key) => allowed.has(key))
      if (valid.length > 0) return valid
      const preferred = ['id', 'name', 'fullName', 'email', 'createdAt']
      const defaults = preferred.filter((key) => allowed.has(key))
      if (defaults.length > 0) return defaults
      return reportFieldOptions.slice(0, 8).map((item) => item.key)
    })
  }, [reportFieldOptions])

  const exportReport = async () => {
    if (exportingReport) return
    if (!selectedReportFields.length) {
      addToast({ type: 'error', title: 'Selecione ao menos um campo para exportar.' })
      return
    }
    if (reportStartDate && reportEndDate && reportStartDate > reportEndDate) {
      addToast({ type: 'error', title: 'A data inicial deve ser menor ou igual a data final.' })
      return
    }
    const startDate = reportStartDate ? new Date(`${reportStartDate}T00:00:00`) : null
    const endDate = reportEndDate ? new Date(`${reportEndDate}T23:59:59`) : null
    const filteredRows = reportRows.filter((row) => {
      if (!startDate && !endDate) return true
      const created = createdAtDate(row)
      if (!created) return false
      if (startDate && created < startDate) return false
      if (endDate && created > endDate) return false
      return true
    }).filter((row) => {
      if (!reportProductType) return true
      return reportRowProductType(row) === reportProductType
    }).filter((row) => {
      if (!reportProductionStatus) return true
      return reportRowProductionStatus(row) === reportProductionStatus
    })
    if (!filteredRows.length) {
      addToast({ type: 'error', title: 'Nenhum registro encontrado para os filtros selecionados.' })
      return
    }
    setExportingReport(true)
    try {
      const ExcelJS = await loadExcelJS()
      const headers = selectedReportFields
      const table = [
        headers.map((field) => prettifyFieldLabel(field)),
        ...filteredRows.map((row) => {
          const flattened = flattenForReport(row)
          return headers.map((field) => String(flattened[field] ?? ''))
        }),
      ]
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('Relatorio')
      table.forEach((line) => {
        worksheet.addRow(line)
      })
      const datasetLabel = REPORT_DATASETS.find((item) => item.key === reportDataset)?.label ?? reportDataset
      const fileName = `relatorio_${datasetLabel.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`
      const content = await workbook.xlsx.writeBuffer()
      const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      addToast({ type: 'success', title: `Relatorio gerado com ${filteredRows.length} registro(s).` })
    } catch (error) {
      console.error(error)
      addToast({ type: 'error', title: 'Falha ao preparar exportacao. Tente novamente.' })
    } finally {
      setExportingReport(false)
    }
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Configuracoes']}>
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Configuracoes</h1>
        <p className="mt-2 text-sm text-slate-500">Gestao de cadastro, usuarios, atualizacao e diagnostico do sistema.</p>
      </section>
      <section className="mt-6">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'registration', label: 'Cadastro' },
            { id: 'users', label: 'Usuarios' },
            { id: 'pricing', label: 'Politica de preco' },
            { id: 'system_update', label: 'Atualizacao do sistema' },
            { id: 'system_diagnostics', label: 'Diagnostico do sistema' },
          ].map((item) => (
            <button key={item.id} type="button" onClick={() => setMainTab(item.id as MainTab)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mainTab === item.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{item.label}</button>
          ))}
        </div>
      </section>

      {mainTab === 'users' ? <section className="mt-4 space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Usuarios</h2>
              <p className="text-sm text-slate-500">Tabela limpa com Perfil, status e vinculo.</p>
            </div>
            {canManageUsers ? <Button onClick={openNew}>+ Novo usuario</Button> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Usuario</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Perfil</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Vinculo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((user) => <tr key={user.id} className="bg-white transition hover:bg-brand-50/40">
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-brand-100 p-2 text-brand-700"><UserRound className="h-4 w-4" /></div>
                      <div><p className="text-sm font-semibold text-slate-900">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p><div className="mt-2"><Badge tone="info">{profileLabel(user.role)}</Badge></div></div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-700">{profileLabel(user.role)}</td>
                  <td className="px-5 py-4"><Badge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td className="px-5 py-4 text-sm text-slate-700">{linkage(user)}</td>
                  <td className="px-5 py-4"><div className="flex flex-wrap gap-2">
                    {canManageUsers ? <Button size="sm" variant="secondary" onClick={() => openEdit(user)} title="Editar"><PenLine className="h-4 w-4" /></Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (DATA_MODE === 'supabase') {
                        if (user.role === 'master_admin' && user.isActive && currentUser?.id !== user.id) {
                          return addToast({ type: 'error', title: 'Nao e permitido desativar outro master admin.' })
                        }
                        const result = await setProfileActive(user.id, !user.isActive)
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        await reloadSupabaseUsers(isSupabaseMode, setSupabaseUsers)
                        return
                      }
                      setUserActive(user.id, !user.isActive)
                    }} title={user.isActive ? 'Desativar' : 'Ativar'}>{user.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (DATA_MODE === 'supabase') {
                        const result = await requestPasswordReset({ email: user.email })
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        if (result.warning) return addToast({ type: 'error', title: result.warning })
                        return addToast({ type: 'success', title: `Token enviado para ${user.email}` })
                      }
                      const p = generatePassword()
                      resetUserPassword(user.id, p)
                      addToast({ type: 'info', title: `Senha temporaria: ${p}` })
                    }} title="Redefinir senha"><LockKeyhole className="h-4 w-4" /></Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (DATA_MODE === 'supabase') {
                        const result = await sendAccessEmail({ email: user.email, fullName: user.name })
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        return addToast({ type: 'success', title: `Acesso enviado para ${user.email}` })
                      }
                      addToast({ type: 'info', title: `Acesso enviado para ${user.email}` })
                    }} title="Enviar acesso por email"><Mail className="h-4 w-4" /></Button> : null}
                    {canDeleteUsers ? <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => {
                      if (DATA_MODE === 'supabase') {
                        if (user.role === 'master_admin') return addToast({ type: 'error', title: 'Nao e permitido excluir o master admin.' })
                        const result = await softDeleteProfile(user.id)
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        await reloadSupabaseUsers(isSupabaseMode, setSupabaseUsers)
                        return
                      }
                      softDeleteUser(user.id)
                    }} title="Excluir"><Trash2 className="h-4 w-4" /></Button> : null}
                  </div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Perfis e permissoes</h2>
          <div className="mt-4 space-y-4">
            {ROLE_LIST.map((role) => {
              const grouped = groupedPermissionsForRole(role)
              return <div key={role} className="rounded-lg border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">{profileLabel(role)}</p>
                <p className="mt-1 text-xs text-slate-500">{profileDescription(role)}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {MODULE_ORDER.filter((module) => (grouped[module] ?? []).length > 0).map((module) => <div key={`${role}_${module}`} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{module}</p>
                    <div className="mt-2 flex flex-wrap gap-2">{(grouped[module] ?? []).map((permission) => <Badge key={permission} tone="neutral">{permissionLabel(permission)}</Badge>)}</div>
                  </div>)}
                </div>
              </div>
            })}
          </div>
        </Card>
      </section> : null}

      {mainTab === 'registration' ? <section className="mt-4 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Tema</h2>
          <div className="mt-3 flex gap-2"><Button variant={settingsState.theme === 'light' ? 'primary' : 'secondary'} onClick={() => saveTheme('light')}>Light</Button><Button variant={settingsState.theme === 'dark' ? 'primary' : 'secondary'} onClick={() => saveTheme('dark')}>Dark</Button></div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Cadastro do laboratorio</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Nome do laboratorio *</label><Input value={labForm.tradeName} onChange={(event) => setLabForm((c) => ({ ...c, tradeName: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Razao social *</label><Input value={labForm.legalName} onChange={(event) => setLabForm((c) => ({ ...c, legalName: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">CNPJ *</label><Input value={labForm.cnpj} onChange={(event) => setLabForm((c) => ({ ...c, cnpj: formatCnpj(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Email empresarial *</label><Input type="email" value={labForm.email} onChange={(event) => setLabForm((c) => ({ ...c, email: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Telefone fixo *</label><Input value={labForm.phone} onChange={(event) => setLabForm((c) => ({ ...c, phone: formatFixedPhone(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label><Input value={labForm.whatsapp} onChange={(event) => setLabForm((c) => ({ ...c, whatsapp: formatMobilePhone(event.target.value) }))} /><WhatsappLink value={labForm.whatsapp} className="mt-2 text-xs font-semibold" /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Endereco completo *</label><Input value={labForm.addressLine} onChange={(event) => setLabForm((c) => ({ ...c, addressLine: event.target.value }))} /></div>
          </div>
          <div className="mt-4"><Button onClick={saveLab}>Salvar cadastro do laboratorio</Button></div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Automacao de guias</h2>
          <p className="mt-1 text-sm text-slate-500">
            Define quando o sistema gera automaticamente as guias/OS de reposicao com base na data prevista de troca.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.guideAutomation?.enabled !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    guideAutomation: {
                      enabled: event.target.checked,
                      leadDays: current.guideAutomation?.leadDays ?? 10,
                    },
                  }))
                }
              />
              Ativar geracao automatica de guias
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Gerar com antecedencia de (dias)
              </label>
              <Input
                type="number"
                min={0}
                value={String(settingsState.guideAutomation?.leadDays ?? 10)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSettingsState((current) => ({
                    ...current,
                    guideAutomation: {
                      enabled: current.guideAutomation?.enabled !== false,
                      leadDays: Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
                    },
                  }))
                }}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={saveGuideAutomation}>Salvar automacao de guias</Button>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">AI Gateway</h2>
          <p className="mt-1 text-sm text-slate-500">Configure provedor de IA e chaves de ativacao por modulo.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.aiGateway?.enabled !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      enabled: event.target.checked,
                    },
                  }))
                }
              />
              Ativar IA global
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Provider</label>
              <select
                value={settingsState.aiGateway?.provider ?? 'mock'}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      provider: event.target.value as 'mock' | 'http' | 'openai',
                    },
                  }))
                }
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="mock">Mock (local)</option>
                <option value="http">HTTP</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.aiGateway?.modules?.clinica !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      modules: { ...current.aiGateway.modules, clinica: event.target.checked },
                    },
                  }))
                }
              />
              Modulo Clinica
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.aiGateway?.modules?.lab !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      modules: { ...current.aiGateway.modules, lab: event.target.checked },
                    },
                  }))
                }
              />
              Modulo Laboratorio
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.aiGateway?.modules?.gestao !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      modules: { ...current.aiGateway.modules, gestao: event.target.checked },
                    },
                  }))
                }
              />
              Modulo Gestao
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settingsState.aiGateway?.modules?.comercial !== false}
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      modules: { ...current.aiGateway.modules, comercial: event.target.checked },
                    },
                  }))
                }
              />
              Modulo Comercial
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Model</label>
              <Input
                value={settingsState.aiGateway?.model ?? ''}
                placeholder="gpt-4.1-mini"
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      model: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">API Base URL</label>
              <Input
                value={settingsState.aiGateway?.apiBaseUrl ?? ''}
                placeholder="https://api.openai.com/v1/responses"
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      apiBaseUrl: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">API Key</label>
              <Input
                type="password"
                value={settingsState.aiGateway?.apiKey ?? ''}
                placeholder="sk-..."
                onChange={(event) =>
                  setSettingsState((current) => ({
                    ...current,
                    aiGateway: {
                      ...current.aiGateway,
                      apiKey: event.target.value,
                    },
                  }))
                }
              />
              <p className="mt-1 text-xs text-slate-500">No modo local, a IA usa mock e nao envia chamadas externas.</p>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={saveAiGateway}>Salvar configuracoes de IA</Button>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Ajuda e LGPD</h2>
          <p className="mt-1 text-sm text-slate-500">Tutoriais rapidos e documentos legais para entrega/operacao.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/app/help" className="text-sm font-semibold text-brand-700 hover:text-brand-500">Abrir Ajuda</Link>
            <span className="text-slate-300">|</span>
            <Link to="/legal/terms" className="text-sm font-semibold text-brand-700 hover:text-brand-500">Termos</Link>
            <span className="text-slate-300">|</span>
            <Link to="/legal/privacy" className="text-sm font-semibold text-brand-700 hover:text-brand-500">Privacidade</Link>
            <span className="text-slate-300">|</span>
            <Link to="/legal/lgpd" className="text-sm font-semibold text-brand-700 hover:text-brand-500">Direitos LGPD</Link>
          </div>
        </Card>
      </section> : null}

      {mainTab === 'pricing' ? <section className="mt-4 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Politica de preco por produto</h2>
          <p className="mt-1 text-sm text-slate-500">Cadastre produtos e defina regra de cobranca por unidade, arcada ou dentes do modelo enviado.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Produto</label>
              <Input
                value={priceForm.customName}
                onChange={(event) => setPriceForm((current) => ({ ...current, customName: event.target.value }))}
                placeholder="Ex.: Contencao premium, Guia cirurgico, Alinhador"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Fluxo do produto</label>
              <select
                value={priceForm.productFlow}
                onChange={(event) => setPriceForm((current) => ({ ...current, productFlow: event.target.value as 'alinhador' | 'impressoes' }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="alinhador">Alinhadores (fluxo de placas)</option>
                <option value="impressoes">Impressões e demais produtos</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Modo de cobranca</label>
              <select
                value={priceForm.pricingMode}
                onChange={(event) => setPriceForm((current) => ({ ...current, pricingMode: event.target.value as PricingMode }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="unit">Unidade</option>
                <option value="arch">Arcada</option>
                <option value="tooth">Dente</option>
              </select>
            </div>
            {priceForm.pricingMode === 'unit' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Preco por unidade (R$)</label>
                <Input value={priceForm.unitPrice} onChange={(event) => setPriceForm((current) => ({ ...current, unitPrice: event.target.value }))} />
              </div>
            ) : null}
            {priceForm.pricingMode === 'arch' ? (
              <>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Aplicacao por arcada</label>
                  <select
                    value={priceForm.archScope}
                    onChange={(event) => setPriceForm((current) => ({ ...current, archScope: event.target.value as PricingArchScope }))}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="ambas">Ambas</option>
                    <option value="superior">Somente superior</option>
                    <option value="inferior">Somente inferior</option>
                  </select>
                </div>
                {priceForm.archScope !== 'inferior' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Preco arcada superior (R$)</label>
                  <Input value={priceForm.upperPrice} onChange={(event) => setPriceForm((current) => ({ ...current, upperPrice: event.target.value }))} />
                </div>
                ) : null}
                {priceForm.archScope !== 'superior' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Preco arcada inferior (R$)</label>
                  <Input value={priceForm.lowerPrice} onChange={(event) => setPriceForm((current) => ({ ...current, lowerPrice: event.target.value }))} />
                </div>
                ) : null}
              </>
            ) : null}
            {priceForm.pricingMode === 'tooth' ? (
              <>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Preco por dente (R$)</label>
                  <Input value={priceForm.toothUnitPrice} onChange={(event) => setPriceForm((current) => ({ ...current, toothUnitPrice: event.target.value }))} />
                </div>
                <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-medium text-slate-700">Selecao de dentes (modelo enviado)</p>
                  <div className="grid grid-cols-8 gap-2">
                    {TOOTH_OPTIONS.map((tooth) => {
                      const checked = priceForm.selectedTeeth.includes(tooth)
                      return (
                        <label key={tooth} className={`cursor-pointer rounded border px-2 py-1 text-center text-xs ${checked ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setPriceForm((current) => ({
                                ...current,
                                selectedTeeth: event.target.checked
                                  ? [...current.selectedTeeth, tooth]
                                  : current.selectedTeeth.filter((item) => item !== tooth),
                              }))
                            }
                            className="sr-only"
                          />
                          {tooth}
                        </label>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <div className="mt-4">
            <Button onClick={addPriceProduct}>Adicionar produto</Button>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Produtos cadastrados</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Produto</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Modo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Preco</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(settingsState.priceCatalog ?? []).map((item) => (
                  <tr key={item.id} className="bg-white">
                    <td className="px-5 py-4 text-sm text-slate-800">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.productType === 'alinhador_12m' ? 'Fluxo: Alinhadores' : 'Fluxo: Impressões e demais'}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {item.pricingMode === 'unit'
                        ? 'Unidade'
                        : item.pricingMode === 'arch'
                          ? `Arcada (${item.archScope === 'superior' ? 'Superior' : item.archScope === 'inferior' ? 'Inferior' : 'Ambas'})`
                          : 'Dente'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {item.pricingMode === 'unit' ? formatCurrencyBrl(item.unitPrice) : null}
                      {item.pricingMode === 'arch' ? `Sup ${formatCurrencyBrl(item.upperPrice)} | Inf ${formatCurrencyBrl(item.lowerPrice)}` : null}
                      {item.pricingMode === 'tooth' ? `${formatCurrencyBrl(item.toothUnitPrice)} por dente (${(item.selectedTeeth ?? []).length} selecionados)` : null}
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => togglePriceProductActive(item.id, !item.isActive)}>
                          {item.isActive ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => removePriceProduct(item.id)}>
                          Excluir
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(settingsState.priceCatalog ?? []).length === 0 ? (
                  <tr>
                    <td className="px-5 py-6 text-sm text-slate-500" colSpan={5}>Nenhum produto cadastrado na politica de preco.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section> : null}

      {mainTab === 'system_update' ? <section className="mt-4 space-y-4">
        <Card><h2 className="text-lg font-semibold text-slate-900">Backup</h2><div className="mt-3"><Button onClick={exportBackup}>Gerar backup</Button></div></Card>
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Relatorios</h2><p className="mt-1 text-sm text-slate-500">Exporte os dados com selecao de campos e periodo de criacao.</p></div><Button onClick={() => setReportModalOpen(true)}>Abrir gerador de relatorio</Button></Card>
      </section> : null}

      {mainTab === 'system_diagnostics' ? <section className="mt-4"><Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-900">Diagnostico do sistema</h2><p className="mt-1 text-sm text-slate-500">Checklist automatico de recursos e dados.</p></div><Link to="/app/settings/diagnostics" className="inline-flex"><Button>Abrir diagnostico</Button></Link></Card></section> : null}

      {reportModalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 px-3 sm:px-4">
        <Card className="w-full max-w-5xl overflow-hidden p-0">
          <div className="flex items-center justify-between bg-brand-500 px-5 py-4 text-white">
            <h2 className="text-lg font-semibold">Gerar relatorio</h2>
            <button type="button" className="text-xl leading-none text-white/90 hover:text-white" onClick={() => setReportModalOpen(false)} aria-label="Fechar">x</button>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Base de dados</label><select value={reportDataset} onChange={(event) => setReportDataset(event.target.value as ReportDatasetKey)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{REPORT_DATASETS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Data inicial (criacao)</label><Input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Data final (criacao)</label><Input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} /></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Tipo de produto</label><select value={reportProductType} onChange={(event) => setReportProductType(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Todos</option>{reportProductTypeOptions.map((value) => <option key={value} value={value}>{PRODUCT_TYPE_LABEL[value as keyof typeof PRODUCT_TYPE_LABEL] ?? value}</option>)}</select></div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">Status de produção</label><select value={reportProductionStatus} onChange={(event) => setReportProductionStatus(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Todos</option>{reportStatusOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-semibold text-slate-900">Selecione os campos desejados</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setSelectedReportFields(reportFieldOptions.map((item) => item.key))}>Selecionar todos</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedReportFields([])}>Limpar</Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">{selectedReportFields.length} campo(s) selecionado(s)</p>
              <div className="mt-4 max-h-[48vh] overflow-auto rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {reportFieldOptions.map((field) => <label key={field.key} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                    <input type="checkbox" checked={selectedReportFields.includes(field.key)} onChange={(event) => setSelectedReportFields((current) => event.target.checked ? [...current, field.key] : current.filter((item) => item !== field.key))} />
                    <span>{field.label}</span>
                  </label>)}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReportModalOpen(false)}>Fechar</Button>
              <Button disabled={exportingReport} onClick={() => void exportReport()}>{exportingReport ? 'Preparando exportacao...' : 'Exportar planilha'}</Button>
            </div>
          </div>
        </Card>
      </div> : null}

      {modalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
        <Card className="w-full max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900">
            {editingUser ? 'Editar usuario' : 'Novo usuario'}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(isSupabaseMode
              ? [{ id: 'personal', label: 'Dados pessoais' }, { id: 'access', label: 'Acesso (usuario e senha)' }, { id: 'profile', label: 'Perfil e permissoes' }, ...(showLinkTab ? [{ id: 'link', label: 'Vinculo' }] : [])]
              : [{ id: 'personal', label: 'Dados pessoais' }, { id: 'access', label: 'Acesso (login e senha)' }, { id: 'profile', label: 'Perfil e permissoes' }, { id: 'link', label: 'Vinculo' }]
            ).map((tab) => <button key={tab.id} type="button" onClick={() => setModalTab(tab.id as ModalTab)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${modalTab === tab.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{tab.label}</button>)}
          </div>
          {modalTab === 'personal' ? <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Nome completo</label><Input aria-label="Nome completo" value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">CPF</label><Input value={form.cpf} placeholder="000.000.000-00" onChange={(event) => setForm((c) => ({ ...c, cpf: formatCpf(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Data de nascimento</label><Input type="date" value={form.birthDate} onChange={(event) => setForm((c) => ({ ...c, birthDate: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Telefone fixo</label><Input value={form.phone} onChange={(event) => setForm((c) => ({ ...c, phone: formatFixedPhone(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label><Input value={form.whatsapp} onChange={(event) => setForm((c) => ({ ...c, whatsapp: formatMobilePhone(event.target.value) }))} /><WhatsappLink value={form.whatsapp} className="mt-2 text-xs font-semibold" /></div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CEP</label>
              <div className="flex gap-2">
                <Input
                  value={form.cep}
                  placeholder="00000-000"
                  onChange={(event) => setForm((c) => ({ ...c, cep: formatCep(event.target.value) }))}
                  onBlur={resolveCep}
                />
                <Button type="button" variant="secondary" onClick={resolveCep}>Localizar</Button>
              </div>
              {cepStatus ? <p className="mt-1 text-xs text-slate-500">{cepStatus}</p> : null}
              {cepError ? <p className="mt-1 text-xs text-red-600">{cepError}</p> : null}
            </div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Logradouro</label><Input value={form.street} onChange={(event) => setForm((c) => ({ ...c, street: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Numero</label><Input value={form.number} onChange={(event) => setForm((c) => ({ ...c, number: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Bairro</label><Input value={form.district} onChange={(event) => setForm((c) => ({ ...c, district: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Cidade</label><Input value={form.city} onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Estado</label><Input value={form.state} onChange={(event) => setForm((c) => ({ ...c, state: event.target.value.toUpperCase().slice(0, 2) }))} /></div>
          </div> : null}
          {modalTab === 'access' ? <div className="mt-4 space-y-4">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Usuario</label><Input aria-label="Usuario" value={form.username} placeholder="nome.sobrenome" onChange={(event) => setForm((c) => ({ ...c, username: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Email (login)</label><Input aria-label="Email (login)" type="email" value={form.email} onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Senha</label><div className="flex items-center gap-2"><div className="relative flex-1"><Input aria-label="Senha" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))} className="pr-12" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><Button variant={passwordMode === 'manual' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPasswordMode('manual')}>Manual</Button><Button variant={passwordMode === 'auto' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setPasswordMode('auto'); setForm((c) => ({ ...c, password: generatePassword() })) }}>Auto</Button></div></div>
            <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setForm((c) => ({ ...c, password: generatePassword() }))}><WandSparkles className="mr-2 h-4 w-4" />Gerar senha automatica</Button><Button variant="ghost" size="sm" onClick={async () => {
              if (!form.email.trim()) return addToast({ type: 'error', title: 'Informe um email.' })
              if (DATA_MODE === 'supabase') {
                const result = await sendAccessEmail({ email: form.email.trim(), fullName: form.name.trim() || undefined })
                if (!result.ok) return addToast({ type: 'error', title: result.error })
                return addToast({ type: 'success', title: `Acesso enviado para ${form.email}` })
              }
              addToast({ type: 'info', title: `Acesso enviado para ${form.email || '-'}` })
            }}><Mail className="mr-2 h-4 w-4" />Enviar acesso por email</Button></div>
            {isSupabaseMode ? <p className="text-xs text-slate-500">No modo supabase, o login principal e por email + senha.</p> : null}
          </div> : null}
          {modalTab === 'profile' ? <div className="mt-4 space-y-4"><div><label className="mb-1 block text-sm font-medium text-slate-700">Perfil</label><select value={form.role} onChange={(event) => {
            const nextRole = event.target.value as Role
            setForm((c) => ({ ...c, role: nextRole, linkedDentistId: nextRole === 'dentist_client' ? c.linkedDentistId : '' }))
          }} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{availableRoleList.map((role) => <option key={role} value={role}>{profileLabel(role)}</option>)}</select>{isSupabaseMode ? <p className="mt-1 text-xs text-slate-500">Usuarios criados diretamente por admin com email e senha.</p> : null}{isSupabaseMode && form.role === 'dentist_admin' ? <div className="mt-3"><label className="mb-1 block text-sm font-medium text-slate-700">Clinica vinculada</label><select value={form.linkedClinicId} onChange={(event) => setForm((c) => ({ ...c, linkedClinicId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Selecione</option>{clinicOptions.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.tradeName}</option>)}</select></div> : null}</div><div className="rounded-lg border border-slate-200 p-4"><p className="text-sm font-semibold text-slate-900">{profileDescription(form.role)}</p><div className="mt-2 space-y-2">{MODULE_ORDER.filter((module) => (modalPermissions[module] ?? []).length > 0).map((module) => <div key={module}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{module}</p><div className="mt-1 flex flex-wrap gap-2">{(modalPermissions[module] ?? []).map((permission) => <Badge key={permission} tone="neutral">{permissionLabel(permission)}</Badge>)}</div></div>)}</div></div></div> : null}
          {modalTab === 'link' && showLinkTab ? <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Clinica vinculada</label><select value={form.linkedClinicId} onChange={(event) => setForm((c) => ({ ...c, linkedClinicId: event.target.value, linkedDentistId: '' }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Selecione</option>{clinicOptions.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.tradeName}</option>)}</select></div>{form.role === 'dentist_client' ? <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Dentista responsavel</label><select value={form.linkedDentistId} onChange={(event) => setForm((c) => ({ ...c, linkedDentistId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Selecione</option>{dentistsForSelect.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.name}</option>)}</select></div> : null}</div> : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={submitUser} disabled={submittingUser}>{submittingUser ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </Card>
      </div> : null}
    </AppShell>
  )
}
