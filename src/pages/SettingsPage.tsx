import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Apple, Chrome, ExternalLink, Eye, EyeOff, LockKeyhole, Mail, Pause, PenLine, Play, RefreshCw, Send, ShieldCheck, Trash2, UserRound, WandSparkles } from 'lucide-react'
import { getAuthProvider } from '../auth/authProvider'
import { can, groupedPermissionsForRole, permissionLabel, profileDescription, profileLabel, type Permission, type PermissionModule } from '../auth/permissions'
import { useToast } from '../app/ToastProvider'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import { DATA_MODE } from '../data/dataMode'
import AppShell from '../layouts/AppShell'
import { getCurrentUser } from '../lib/auth'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatCnpj, isValidCnpj } from '../lib/cnpj'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
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
import { listClinicsFirebase } from '../repo/clinicRepo'
import { listDentistsFirebase } from '../data/dentistRepo'

type ClinicOption = { id: string; tradeName: string }
type DentistOption = { id: string; name: string; clinicId: string | null }
import { inviteUser, listProfiles, setProfileActive, softDeleteProfile, updateProfile } from '../repo/profileRepo'
import type { AccessMethod, Role, User } from '../types/User'
import { useDb } from '../lib/useDb'
import { sendWhatsappServiceMessage } from '../lib/whatsappService'

type MainTab = 'registration' | 'users' | 'pricing' | 'whatsapp'
type ModalTab = 'personal' | 'access' | 'profile' | 'link'
type PasswordMode = 'auto' | 'manual'
type SettingsUserForm = {
  name: string
  accessMethod: AccessMethod
  username: string
  email: string
  password: string
  cpf: string
  cep: string
  birthDate: string
  phone: string
  whatsapp: string
  street: string
  number: string
  district: string
  city: string
  state: string
  addressLine: string
  role: Role
  isActive: boolean
  linkedDentistId: string
  linkedClinicId: string
  sendAccessEmail: boolean
}
const ROLE_LIST: Role[] = ['master_admin', 'dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']
const PASSWORD_ACCESS_METHODS: AccessMethod[] = ['username', 'email']
const SOCIAL_ACCESS_METHODS: AccessMethod[] = ['google', 'apple']
const ACCESS_METHOD_OPTIONS: Array<{
  id: AccessMethod
  label: string
  description: string
  icon: typeof UserRound
}> = [
  { id: 'username', label: 'Usuário', description: 'Login por usuário e senha.', icon: UserRound },
  { id: 'email', label: 'E-mail', description: 'Login por e-mail e senha.', icon: Mail },
  { id: 'google', label: 'Conta Google', description: 'Autenticação pela conta Google.', icon: Chrome },
  { id: 'apple', label: 'Conta Apple', description: 'Autenticação pela conta Apple.', icon: Apple },
]

function accessMethodLabel(accessMethod?: AccessMethod, username?: string) {
  const resolved = accessMethod ?? (username ? 'username' : 'email')
  return ACCESS_METHOD_OPTIONS.find((option) => option.id === resolved)?.label ?? 'E-mail'
}
const MODULE_ORDER: PermissionModule[] = [
  'Painel',
  'Agenda',
  'Pacientes',
  'Exames',
  'Alinhadores',
  'Laboratório',
  'Dentistas',
  'Clínicas',
  'Usuários',
  'Configurações',
  'Documentos',
  'IA',
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

// In Firebase mode, collaborator onboarding is for operational profiles only (no admin).
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

function normalizeEmail(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function isValidEmail(value?: string | null) {
  const email = normalizeEmail(value)
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeServiceUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function buildWhatsappQrUrl(baseUrl?: string, adminToken?: string) {
  const normalizedBaseUrl = normalizeServiceUrl(baseUrl ?? '')
  if (!normalizedBaseUrl || !adminToken?.trim()) return ''
  const params = new URLSearchParams({ token: adminToken.trim() })
  return `${normalizedBaseUrl}/qr?${params.toString()}`
}

function PermissionStatusBadge() {
  return (
    <span className="inline-flex min-w-[72px] items-center justify-center rounded bg-lime-600 px-2 py-0.5 text-[10px] font-bold uppercase leading-4 text-white shadow-sm">
      Permitido
    </span>
  )
}

function permissionEnvironmentLabel(permission: Permission) {
  return `Ambiente ${permissionLabel(permission)}`
}

function PermissionMatrix({ grouped }: { grouped: Partial<Record<PermissionModule, Permission[]>> }) {
  const modules = MODULE_ORDER.filter((module) => (grouped[module] ?? []).length > 0)

  if (modules.length === 0) {
    return <p className="px-4 py-3 text-sm text-slate-500">Nenhum módulo permitido para este perfil.</p>
  }

  return (
    <div className="divide-y divide-slate-200">
      {modules.map((module) => (
        <div key={module} className="grid grid-cols-[120px_minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex items-start justify-end bg-slate-100 px-4 py-4 text-right text-xs font-medium text-slate-600">
            {module}
          </div>
          <div className="px-4 py-3">
            <div className="divide-y divide-dotted divide-slate-300">
              {(grouped[module] ?? []).map((permission) => (
                <div key={permission} className="flex min-h-7 items-center gap-2 py-1.5 text-xs text-slate-900 sm:text-sm">
                  <PermissionStatusBadge />
                  <span>{permissionEnvironmentLabel(permission)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function normalizeUserCreationError(error: string) {
  const text = (error ?? '').toLowerCase()
  if (text.includes('idx_profiles_short_id_unique')) {
    return 'Conflito interno ao gerar identificador do usuário. Tente novamente.'
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

async function reloadFirebaseUsers(isFirebaseMode: boolean, onLoaded: (users: User[]) => void) {
  if (!isFirebaseMode) return
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
  const isFirebaseMode = DATA_MODE === 'firebase'

  const dentistsLocal = useMemo(() => db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt), [db.dentists])
  const clinicsLocal = useMemo(() => db.clinics.filter((item) => !item.deletedAt), [db.clinics])
  const [clinicsFirebase, setClinicsFirebase] = useState<ClinicOption[]>([])
  const [dentistsFirebase, setDentistsFirebase] = useState<DentistOption[]>([])
  const clinicOptions = useMemo<ClinicOption[]>(() => {
    if (isFirebaseMode) return clinicsFirebase
    return clinicsLocal.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName }))
  }, [clinicsLocal, clinicsFirebase, isFirebaseMode])
  const dentistOptions = useMemo<DentistOption[]>(() => {
    if (isFirebaseMode) return dentistsFirebase
    return dentistsLocal.map((dentist) => ({ id: dentist.id, name: dentist.name, clinicId: dentist.clinicId ?? null }))
  }, [dentistsLocal, dentistsFirebase, isFirebaseMode])

  const [firebaseUsers, setFirebaseUsers] = useState<User[]>([])
  const users = useMemo(() => {
    if (isFirebaseMode) return firebaseUsers
    return [...db.users].sort((a, b) => a.name.localeCompare(b.name))
  }, [db.users, isFirebaseMode, firebaseUsers])

  const [mainTab, setMainTab] = useState<MainTab>('registration')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>('personal')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('auto')
  const [submittingUser, setSubmittingUser] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const defaultAccessMethod: AccessMethod = DATA_MODE === 'local' ? 'username' : 'email'
  const buildEmptyUserForm = (): SettingsUserForm => ({
    name: '',
    accessMethod: defaultAccessMethod,
    username: '',
    email: '',
    password: isFirebaseMode ? '' : generatePassword(),
    cpf: '',
    cep: '',
    birthDate: '',
    phone: '',
    whatsapp: '',
    street: '',
    number: '',
    district: '',
    city: '',
    state: '',
    addressLine: '',
    role: 'receptionist',
    isActive: true,
    linkedDentistId: '',
    linkedClinicId: '',
    sendAccessEmail: true,
  })
  const [form, setForm] = useState<SettingsUserForm>(() => buildEmptyUserForm())
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')
  const [settingsState, setSettingsState] = useState(() => loadSystemSettings())
  const [labForm, setLabForm] = useState<LabCompanyProfile>(() => loadSystemSettings().labCompany)
  const [whatsappServiceForm, setWhatsappServiceForm] = useState(() => {
    const service = loadSystemSettings().whatsappService
    return {
      enabled: service?.enabled === true,
      baseUrl: service?.baseUrl ?? '',
      adminToken: service?.adminToken ?? '',
    }
  })
  const [whatsappQrFrameKey, setWhatsappQrFrameKey] = useState(0)
  const [whatsappTestPhone, setWhatsappTestPhone] = useState('')
  const [whatsappTestMessage, setWhatsappTestMessage] = useState('Teste de envio pelo WhatsApp ORTHOSCAN.')
  const [whatsappSending, setWhatsappSending] = useState(false)
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
    if (!isFirebaseMode) return
    await saveSystemSettingsSupabase(next)
  }

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) {
      setClinicsFirebase([])
      setDentistsFirebase([])
      return
    }
    Promise.all([
      listClinicsFirebase({ includeDeleted: false }),
      listDentistsFirebase({ includeDeleted: false, includeInactive: false }),
    ]).then(([clinics, dentists]) => {
      if (!active) return
      setClinicsFirebase(clinics.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName })))
      setDentistsFirebase(
        dentists.map((dentist) => ({
          id: dentist.id,
          name: dentist.name,
          clinicId: dentist.clinicId ?? null,
        })),
      )
    })
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  useEffect(() => {
    if (!isFirebaseMode) return
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
      setWhatsappServiceForm({
        enabled: normalized.whatsappService?.enabled === true,
        baseUrl: normalized.whatsappService?.baseUrl ?? '',
        adminToken: normalized.whatsappService?.adminToken ?? '',
      })
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) {
      setFirebaseUsers([])
      return
    }
    reloadFirebaseUsers(isFirebaseMode, (loadedUsers) => {
      if (!active) return
      setFirebaseUsers(loadedUsers)
    })
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  const openNew = () => {
    setEditingUser(null)
    setModalTab('personal')
    setPasswordMode(isFirebaseMode ? 'manual' : 'auto')
    setForm(buildEmptyUserForm())
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
    setForm({ name: user.name, accessMethod: user.accessMethod ?? (user.username ? 'username' : 'email'), username: user.username ?? '', email: user.email, password: '', cpf: user.cpf ?? '', cep: user.cep ?? '', street: addressParts.street, number: addressParts.number, district: addressParts.district, city: addressParts.city, state: addressParts.state, birthDate: user.birthDate ?? '', phone: user.phone ?? '', whatsapp: user.whatsapp ?? '', addressLine: user.addressLine ?? '', role: user.role, isActive: user.isActive, linkedDentistId: user.linkedDentistId ?? '', linkedClinicId: user.linkedClinicId ?? '', sendAccessEmail: false })
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
      setCepError('CEP inválido.')
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
      const message = errorFetch instanceof Error ? errorFetch.message : 'Não foi possível localizar o CEP.'
      setCepError(message)
    }
  }

  const submitUser = async () => {
    if (submittingUser) return
    setSubmittingUser(true)
    setError(null)

    try {
      if (isFirebaseMode && !editingUser) {
        if (!form.name.trim()) return setError('Nome é obrigatório.')
        if (!form.email.trim()) return setError('E-mail é obrigatório.')
        if (form.accessMethod === 'username' && !form.username.trim()) return setError('Usuário é obrigatório para este método de acesso.')
        if (isPasswordAccess && !form.password.trim()) return setError('Senha é obrigatória.')
        if (isPasswordAccess && form.password.trim().length < 8) return setError('Senha deve ter no mínimo 8 caracteres.')
        if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo inválido.')
        if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp inválido.')
        if (!INVITE_ROLE_LIST.includes(form.role)) {
          return setError('Perfil não permitido para criação neste modo.')
        }
        if (ROLE_REQUIRES_CLINIC.includes(form.role) && !form.linkedClinicId.trim()) {
          return setError('Clínica vinculada é obrigatória para este perfil.')
        }
        if (form.role === 'dentist_client' && !form.linkedDentistId.trim()) {
          return setError('Dentista responsável é obrigatório para perfil Dentista Cliente.')
        }
        const result = await inviteUser({
          email: form.email.trim(),
          role: form.role,
          clinicId: form.linkedClinicId || clinicOptions[0]?.id || '',
          dentistId: form.linkedDentistId || undefined,
          fullName: form.name.trim() || undefined,
          password: isPasswordAccess ? form.password.trim() : undefined,
          cpf: form.cpf.trim() || undefined,
          phone: form.whatsapp.trim() || undefined,
        })
        if (!result.ok) {
          if (result.code === 'unauthorized') return setError('Sessão expirada. Saia e entre novamente.')
          if (result.code === 'forbidden') return setError('Sem permissão para criar usuários.')
          if (result.code === 'network_error') return setError(result.error)
          return setError(normalizeUserCreationError(result.error))
        }
        await reloadFirebaseUsers(isFirebaseMode, setFirebaseUsers)
        setModalOpen(false)
        addToast({ type: 'success', title: 'Usuário criado', message: 'Acesso liberado com e-mail e senha cadastrados.' })
        return
      }

      if (isFirebaseMode && editingUser) {
        if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo inválido.')
        if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp inválido.')
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
        await reloadFirebaseUsers(isFirebaseMode, setFirebaseUsers)
        setModalOpen(false)
        if (currentUser?.id === editingUser.id) {
          await getAuthProvider().getCurrentUser()
        }
        addToast({ type: 'success', title: 'Usuário atualizado' })
        return
      }

      if (!form.name.trim() || !form.email.trim()) return setError('Nome e e-mail são obrigatórios.')
      if (form.accessMethod === 'username' && !form.username.trim()) return setError('Usuário é obrigatório para este método de acesso.')
      if (!editingUser && isPasswordAccess && !form.password.trim()) return setError('Senha é obrigatória para novo usuário.')
      if (form.phone.trim() && !isValidFixedPhone(form.phone)) return setError('Telefone fixo inválido.')
      if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) return setError('Celular/WhatsApp inválido.')
      const basePayload = {
        name: form.name.trim(),
        accessMethod: form.accessMethod,
        username: form.accessMethod === 'username' ? form.username.trim() || undefined : undefined,
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
        : createUser({ ...basePayload, password: isPasswordAccess ? form.password.trim() : generatePassword() })
      if (!result.ok) return setError(result.error)
      setModalOpen(false)
      addToast({ type: 'success', title: editingUser ? 'Usuário atualizado' : 'Usuário criado' })
    } finally {
      setSubmittingUser(false)
    }
  }

  const linkage = (user: User) => {
    if (user.role === 'dentist_client') return dentistOptions.find((item) => item.id === user.linkedDentistId)?.name ?? '-'
    if (user.role === 'clinic_client') return clinicOptions.find((item) => item.id === user.linkedClinicId)?.tradeName ?? '-'
    if (user.role === 'lab_tech') return 'Laboratório'
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
      addToast({ type: 'error', title: 'Preencha os dados obrigatórios do laboratório.' })
      return
    }
    if (!isValidFixedPhone(labForm.phone)) {
      addToast({ type: 'error', title: 'Telefone fixo do laboratório inválido.' })
      return
    }
    if (labForm.whatsapp.trim() && !isValidMobilePhone(labForm.whatsapp)) {
      addToast({ type: 'error', title: 'Celular/WhatsApp do laboratório inválido.' })
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
    addToast({ type: 'success', title: 'Automação de guias salva' })
  }

  const saveWhatsappService = () => {
    const baseUrl = normalizeServiceUrl(whatsappServiceForm.baseUrl)
    const adminToken = whatsappServiceForm.adminToken.trim()
    if (whatsappServiceForm.enabled && (!baseUrl || !adminToken)) {
      addToast({ type: 'error', title: 'Informe a URL e o token do serviço de WhatsApp.' })
      return
    }
    const next = addAuditEntry(
      {
        ...settingsState,
        whatsappService: {
          enabled: whatsappServiceForm.enabled,
          baseUrl,
          adminToken,
        },
      },
      {
        action: 'settings.whatsapp_service.updated',
        actor: currentUser?.email,
        details: `enabled=${whatsappServiceForm.enabled}; baseUrl=${baseUrl || '-'}`,
      },
    )
    void persistSettings(next)
    setSettingsState(next)
    setWhatsappServiceForm((current) => ({ ...current, baseUrl, adminToken }))
    setWhatsappQrFrameKey((current) => current + 1)
    addToast({ type: 'success', title: 'WhatsApp salvo' })
  }

  const sendWhatsappTest = async () => {
    if (whatsappSending) return
    setWhatsappSending(true)
    try {
      const result = await sendWhatsappServiceMessage(
        {
          whatsappService: {
            enabled: whatsappServiceForm.enabled,
            baseUrl: normalizeServiceUrl(whatsappServiceForm.baseUrl),
            adminToken: whatsappServiceForm.adminToken.trim(),
          },
        },
        {
          to: whatsappTestPhone,
          message: whatsappTestMessage,
          kind: 'settings_test',
          metadata: { screen: 'settings' },
        },
      )
      if (!result.ok) {
        addToast({ type: 'error', title: 'Falha no teste do WhatsApp', message: result.error })
        return
      }
      addToast({ type: 'success', title: 'Mensagem enviada pelo WhatsApp' })
    } finally {
      setWhatsappSending(false)
    }
  }

  const saveAiGateway = () => {
    const next = addAuditEntry(
      {
        ...settingsState,
        aiGateway: {
          enabled: false,
          modules: {
            clinica: false,
            lab: false,
            gestao: false,
            comercial: false,
          },
          provider: 'mock',
          model: 'gpt-4.1-mini',
          apiBaseUrl: '',
          apiKey: '',
        },
      },
      {
        action: 'settings.ai_gateway.disabled',
        actor: currentUser?.email,
        details: 'Modo enxuto aplicado: IA removida do fluxo ativo.',
      },
    )
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'success', title: 'IA desativada no modo enxuto' })
  }

  const addPriceProduct = () => {
    const productType = priceForm.productFlow === 'alinhador' ? 'alinhador_12m' : 'biomodelo'
    const name = priceForm.customName.trim()
    if (!name) {
      addToast({ type: 'error', title: 'Informe o nome do produto.' })
      return
    }
    if (priceForm.pricingMode === 'unit' && parsePriceInput(priceForm.unitPrice) <= 0) {
      addToast({ type: 'error', title: 'Informe um preço por unidade válido.' })
      return
    }
    if (priceForm.pricingMode === 'arch') {
      const upper = parsePriceInput(priceForm.upperPrice)
      const lower = parsePriceInput(priceForm.lowerPrice)
      if (priceForm.archScope === 'superior' && upper <= 0) {
        addToast({ type: 'error', title: 'Informe o preço da arcada superior.' })
        return
      }
      if (priceForm.archScope === 'inferior' && lower <= 0) {
        addToast({ type: 'error', title: 'Informe o preço da arcada inferior.' })
        return
      }
      if (priceForm.archScope === 'ambas' && upper <= 0 && lower <= 0) {
        addToast({ type: 'error', title: 'Informe o preço por arcada superior e/ou inferior.' })
        return
      }
    }
    if (priceForm.pricingMode === 'tooth') {
      if (parsePriceInput(priceForm.toothUnitPrice) <= 0) {
        addToast({ type: 'error', title: 'Informe o preço por dente.' })
        return
      }
      if (!priceForm.selectedTeeth.length) {
      addToast({ type: 'error', title: 'Selecione ao menos um dente para esta política.' })
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
    addToast({ type: 'success', title: 'Produto adicionado à política de preço.' })
  }

  const removePriceProduct = (id: string) => {
    const current = settingsState.priceCatalog ?? []
    const target = current.find((item) => item.id === id)
    if (!target) return
    if (!window.confirm(`Excluir o produto ${target.name} da política de preço?`)) return
    const next = addAuditEntry(
      {
        ...settingsState,
        priceCatalog: current.filter((item) => item.id !== id),
      },
      { action: 'settings.pricing.delete', actor: currentUser?.email, details: `Produto: ${target.name}` },
    )
    void persistSettings(next)
    setSettingsState(next)
    addToast({ type: 'info', title: 'Produto removido da política de preço.' })
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

  const modalPermissions = groupedPermissionsForRole(form.role)
  const showLinkTab = !isFirebaseMode || ROLE_REQUIRES_LINK.includes(form.role)
  const availableRoleList = isFirebaseMode && !editingUser ? INVITE_ROLE_LIST : ROLE_LIST
  const dentistsForSelect = useMemo(() => {
    if (form.role !== 'dentist_client') return dentistOptions
    if (!form.linkedClinicId) return dentistOptions
    return dentistOptions.filter((dentist) => (dentist.clinicId ? dentist.clinicId === form.linkedClinicId : true))
  }, [dentistOptions, form.linkedClinicId, form.role])
  const isPasswordAccess = PASSWORD_ACCESS_METHODS.includes(form.accessMethod)
  const isSocialAccess = SOCIAL_ACCESS_METHODS.includes(form.accessMethod)
  const selectedAccessOption = ACCESS_METHOD_OPTIONS.find((item) => item.id === form.accessMethod) ?? ACCESS_METHOD_OPTIONS[0]
  const socialProviderLabel = form.accessMethod === 'apple' ? 'Apple' : 'Google'

  return (
    <AppShell breadcrumb={['Início', 'Configurações']}>
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Configurações</h1>
        
      </section>
      <section className="mt-6">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'registration', label: 'Cadastro' },
            { id: 'users', label: 'Usuários' },
            { id: 'pricing', label: 'Política de preço' },
            { id: 'whatsapp', label: 'WhatsApp' },
          ].map((item) => (
            <button key={item.id} type="button" onClick={() => setMainTab(item.id as MainTab)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mainTab === item.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{item.label}</button>
          ))}
        </div>
      </section>

      {mainTab === 'users' ? <section className="mt-4 space-y-4">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Usuários</h2>
              
            </div>
            {canManageUsers ? <Button onClick={openNew}>+ Novo usuário</Button> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Usuário</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Perfil</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Vínculo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((user) => <tr key={user.id} className="bg-white transition hover:bg-brand-50/40">
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-brand-100 p-2 text-brand-700"><UserRound className="h-4 w-4" /></div>
                      <div><p className="text-sm font-semibold text-slate-900">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p><p className="mt-1 text-xs text-slate-500">Acesso: {accessMethodLabel(user.accessMethod, user.username)}</p><div className="mt-2"><Badge tone="info">{profileLabel(user.role)}</Badge></div></div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-700">{profileLabel(user.role)}</td>
                  <td className="px-5 py-4"><Badge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td className="px-5 py-4 text-sm text-slate-700">{linkage(user)}</td>
                  <td className="px-5 py-4"><div className="flex flex-wrap gap-2">
                    {canManageUsers ? <Button size="sm" variant="secondary" onClick={() => openEdit(user)} title="Editar"><PenLine className="h-4 w-4" /></Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (isFirebaseMode) {
                        if (user.role === 'master_admin' && user.isActive && currentUser?.id !== user.id) {
                          return addToast({ type: 'error', title: 'Não é permitido desativar outro administrador master.' })
                        }
                        const result = await setProfileActive(user.id, !user.isActive)
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        await reloadFirebaseUsers(isFirebaseMode, setFirebaseUsers)
                        return
                      }
                      setUserActive(user.id, !user.isActive)
                    }} title={user.isActive ? 'Desativar' : 'Ativar'}>{user.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (isFirebaseMode) {
                        const result = await requestPasswordReset({ email: user.email })
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        if (result.warning) return addToast({ type: 'error', title: result.warning })
                        return addToast({ type: 'success', title: `Token enviado para ${user.email}` })
                      }
                      const p = generatePassword()
                      resetUserPassword(user.id, p)
                      addToast({ type: 'info', title: `Senha temporária: ${p}` })
                    }} title="Redefinir senha"><LockKeyhole className="h-4 w-4" /></Button> : null}
                    {canManageUsers ? <Button size="sm" variant="ghost" onClick={async () => {
                      if (isFirebaseMode) {
                        const result = await sendAccessEmail({ email: user.email, fullName: user.name })
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        return addToast({ type: 'success', title: `Acesso enviado para ${user.email}` })
                      }
                      addToast({ type: 'info', title: `Acesso enviado para ${user.email}` })
                    }} title="Enviar acesso por e-mail"><Mail className="h-4 w-4" /></Button> : null}
                    {canDeleteUsers ? <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => {
                      if (isFirebaseMode) {
                        if (user.role === 'master_admin') return addToast({ type: 'error', title: 'Não é permitido excluir o administrador master.' })
                        const result = await softDeleteProfile(user.id)
                        if (!result.ok) return addToast({ type: 'error', title: result.error })
                        await reloadFirebaseUsers(isFirebaseMode, setFirebaseUsers)
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
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Permissões</h2>
          </div>
          <div className="space-y-5 p-5">
            {ROLE_LIST.map((role) => {
              const grouped = groupedPermissionsForRole(role)
              return (
                <div key={role} className="overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="bg-slate-100 px-4 py-4 text-right text-xs font-medium text-slate-600">
                      Módulos Permitidos
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-lime-50 text-lime-700">
                        <ShieldCheck className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-lime-700">{profileLabel(role)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{profileDescription(role)}</p>
                      </div>
                    </div>
                  </div>
                  <PermissionMatrix grouped={grouped} />
                </div>
              )
            })}
          </div>
        </Card>
      </section> : null}

      {mainTab === 'registration' ? <section className="mt-4 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Tema</h2>
          <div className="mt-3 flex gap-2"><Button variant={settingsState.theme === 'light' ? 'primary' : 'secondary'} onClick={() => saveTheme('light')}>Claro</Button><Button variant={settingsState.theme === 'dark' ? 'primary' : 'secondary'} onClick={() => saveTheme('dark')}>Escuro</Button></div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Cadastro do laboratório</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Nome do laboratório *</label><Input value={labForm.tradeName} onChange={(event) => setLabForm((c) => ({ ...c, tradeName: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Razão social *</label><Input value={labForm.legalName} onChange={(event) => setLabForm((c) => ({ ...c, legalName: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">CNPJ *</label><Input value={labForm.cnpj} onChange={(event) => setLabForm((c) => ({ ...c, cnpj: formatCnpj(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">E-mail empresarial *</label><Input type="email" value={labForm.email} onChange={(event) => setLabForm((c) => ({ ...c, email: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Telefone fixo *</label><Input value={labForm.phone} onChange={(event) => setLabForm((c) => ({ ...c, phone: formatFixedPhone(event.target.value) }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label><Input value={labForm.whatsapp} onChange={(event) => setLabForm((c) => ({ ...c, whatsapp: formatMobilePhone(event.target.value) }))} /><WhatsappLink value={labForm.whatsapp} className="mt-2 text-xs font-semibold" /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Endereço completo *</label><Input value={labForm.addressLine} onChange={(event) => setLabForm((c) => ({ ...c, addressLine: event.target.value }))} /></div>
          </div>
          <div className="mt-4"><Button onClick={saveLab}>Salvar cadastro do laboratório</Button></div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Automação de guias</h2>
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
              Ativar geração automática de guias
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Gerar com antecedência de (dias)
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
            <Button onClick={saveGuideAutomation}>Salvar automação de guias</Button>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">IA</h2>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">
              O modo enxuto mantém a IA fora do fluxo ativo para evitar consumo acidental de provider, Edge Functions e suporte operacional.
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              A interface de IA foi removida desta operação. Se quisermos recolocar depois, fazemos isso com escopo e orçamento separados.
            </div>
          </div>
          <div className="mt-4">
            <Button variant="secondary" onClick={saveAiGateway}>Aplicar desativação da IA</Button>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">WhatsApp</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => setMainTab('whatsapp')} className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              Configurar QR Code
            </button>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Ajuda e LGPD</h2>
          
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

      {mainTab === 'whatsapp' ? <section className="mt-4 space-y-4">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Conexão do WhatsApp</h2>
              <p className="mt-1 text-sm text-slate-600">Configure o serviço de lembretes e escaneie o QR Code sem sair do sistema.</p>
            </div>
            <Badge tone={settingsState.whatsappService?.enabled ? 'success' : 'neutral'}>
              {settingsState.whatsappService?.enabled ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
              <input
                type="checkbox"
                checked={whatsappServiceForm.enabled}
                onChange={(event) => setWhatsappServiceForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Ativar painel de QR Code do WhatsApp
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">URL do serviço</label>
              <Input
                value={whatsappServiceForm.baseUrl}
                placeholder="Ex.: https://whatsapp.orthoscan.online"
                onChange={(event) => setWhatsappServiceForm((current) => ({ ...current, baseUrl: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Token administrativo</label>
              <Input
                value={whatsappServiceForm.adminToken}
                placeholder="ADMIN_TOKEN"
                onChange={(event) => setWhatsappServiceForm((current) => ({ ...current, adminToken: event.target.value }))}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={saveWhatsappService}>Salvar WhatsApp</Button>
            <Button type="button" variant="secondary" onClick={() => setWhatsappQrFrameKey((current) => current + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar QR
            </Button>
            {buildWhatsappQrUrl(settingsState.whatsappService?.baseUrl, settingsState.whatsappService?.adminToken) ? (
              <a href={buildWhatsappQrUrl(settingsState.whatsappService?.baseUrl, settingsState.whatsappService?.adminToken)} target="_blank" rel="noreferrer" className="inline-flex">
                <Button type="button" variant="ghost">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir em nova aba
                </Button>
              </a>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">QR Code</h2>
          {buildWhatsappQrUrl(settingsState.whatsappService?.baseUrl, settingsState.whatsappService?.adminToken) ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <iframe
                key={`${whatsappQrFrameKey}_${settingsState.whatsappService?.baseUrl ?? ''}_${settingsState.whatsappService?.adminToken ?? ''}`}
                title="QR Code do WhatsApp"
                src={buildWhatsappQrUrl(settingsState.whatsappService?.baseUrl, settingsState.whatsappService?.adminToken)}
                className="h-[460px] w-full bg-white"
              />
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Informe a URL do serviço e o token administrativo, salve, e o QR Code aparecerá aqui.
            </div>
          )}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            No celular da clínica, abra WhatsApp, entre em Aparelhos conectados e toque em Conectar aparelho.
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Teste de envio</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Destino do teste</label>
              <Input
                value={whatsappTestPhone}
                onChange={(event) => setWhatsappTestPhone(formatMobilePhone(event.target.value))}
                placeholder="(86) 99999-9999"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Mensagem</label>
              <Input value={whatsappTestMessage} onChange={(event) => setWhatsappTestMessage(event.target.value)} />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={whatsappSending || !whatsappServiceForm.enabled}
              onClick={sendWhatsappTest}
            >
              <Send className="mr-2 h-4 w-4" />
              {whatsappSending ? 'Enviando' : 'Enviar teste'}
            </Button>
          </div>
        </Card>
      </section> : null}

      {mainTab === 'pricing' ? <section className="mt-4 space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Política de preço por produto</h2>
          
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Produto</label>
              <Input
                value={priceForm.customName}
                onChange={(event) => setPriceForm((current) => ({ ...current, customName: event.target.value }))}
                placeholder="Ex.: Contenção premium, Guia cirúrgico, Alinhador"
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Modo de cobrança</label>
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
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
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
                    <td className="px-5 py-6 text-sm text-slate-500" colSpan={5}>Nenhum produto cadastrado na política de preço.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section> : null}

      {modalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
        <Card className="w-full max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900">
            {editingUser ? 'Editar usuário' : 'Novo usuário'}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {(isFirebaseMode
              ? [{ id: 'personal', label: 'Dados pessoais' }, { id: 'access', label: 'Acesso' }, { id: 'profile', label: 'Perfil e permissões' }, ...(showLinkTab ? [{ id: 'link', label: 'Vínculo' }] : [])]
              : [{ id: 'personal', label: 'Dados pessoais' }, { id: 'access', label: 'Acesso' }, { id: 'profile', label: 'Perfil e permissões' }, { id: 'link', label: 'Vínculo' }]
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
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Número</label><Input value={form.number} onChange={(event) => setForm((c) => ({ ...c, number: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Bairro</label><Input value={form.district} onChange={(event) => setForm((c) => ({ ...c, district: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Cidade</label><Input value={form.city} onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Estado</label><Input value={form.state} onChange={(event) => setForm((c) => ({ ...c, state: event.target.value.toUpperCase().slice(0, 2) }))} /></div>
          </div> : null}
          {modalTab === 'access' ? <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Método de acesso</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ACCESS_METHOD_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const active = form.accessMethod === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          accessMethod: option.id,
                          username: option.id === 'username' ? current.username : '',
                          password: PASSWORD_ACCESS_METHODS.includes(option.id) ? current.password : '',
                        }))
                        if (SOCIAL_ACCESS_METHODS.includes(option.id)) setPasswordMode('manual')
                      }}
                      className={`flex min-h-[76px] items-start gap-3 rounded-lg border px-3 py-3 text-left transition ${active ? 'border-brand-500 bg-baby-50 text-brand-800 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-baby-300 hover:bg-baby-50/40'}`}
                    >
                      <span className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg ${active ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs text-slate-500">{option.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {form.accessMethod === 'username' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Usuário</label>
                <Input aria-label="Usuário" value={form.username} placeholder="nome.sobrenome" onChange={(event) => setForm((c) => ({ ...c, username: event.target.value }))} />
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{isSocialAccess ? `E-mail da conta ${socialProviderLabel}` : 'E-mail'}</label>
              <Input aria-label="E-mail" type="email" value={form.email} placeholder={isSocialAccess ? `usuario@${form.accessMethod === 'apple' ? 'icloud.com' : 'gmail.com'}` : 'usuario@orthoscan.com'} onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))} />
            </div>

            {isPasswordAccess ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input aria-label="Senha" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))} className="pr-12" />
                      <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                    </div>
                    <Button variant={passwordMode === 'manual' ? 'secondary' : 'ghost'} size="sm" onClick={() => setPasswordMode('manual')}>Manual</Button>
                    <Button variant={passwordMode === 'auto' ? 'secondary' : 'ghost'} size="sm" onClick={() => { setPasswordMode('auto'); setForm((c) => ({ ...c, password: generatePassword() })) }}>Auto</Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setForm((c) => ({ ...c, password: generatePassword() }))}><WandSparkles className="mr-2 h-4 w-4" />Gerar senha automática</Button>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    if (!form.email.trim()) return addToast({ type: 'error', title: 'Informe um e-mail.' })
                    if (isFirebaseMode) {
                      const result = await sendAccessEmail({ email: form.email.trim(), fullName: form.name.trim() || undefined })
                      if (!result.ok) return addToast({ type: 'error', title: result.error })
                      return addToast({ type: 'success', title: `Acesso enviado para ${form.email}` })
                    }
                    addToast({ type: 'info', title: `Acesso enviado para ${form.email || '-'}` })
                  }}><Mail className="mr-2 h-4 w-4" />Enviar acesso por e-mail</Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-baby-200 bg-baby-50 px-4 py-3 text-sm text-brand-800">
                O usuário entrará com {selectedAccessOption.label}. Mantenha o e-mail igual ao da conta do provedor e habilite o provedor no Firebase.
              </div>
            )}
          </div> : null}
          {modalTab === 'profile' ? (
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Perfil</label>
                <select
                  value={form.role}
                  onChange={(event) => {
                    const nextRole = event.target.value as Role
                    setForm((c) => ({ ...c, role: nextRole, linkedDentistId: nextRole === 'dentist_client' ? c.linkedDentistId : '' }))
                  }}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  {availableRoleList.map((role) => <option key={role} value={role}>{profileLabel(role)}</option>)}
                </select>
                {isFirebaseMode ? <p className="mt-1 text-xs text-slate-500">Criação por e-mail e senha.</p> : null}
                {isFirebaseMode && form.role === 'dentist_admin' ? (
                  <div className="mt-3">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Clínica vinculada</label>
                    <select
                      value={form.linkedClinicId}
                      onChange={(event) => setForm((c) => ({ ...c, linkedClinicId: event.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">Selecione</option>
                      {clinicOptions.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.tradeName}</option>)}
                    </select>
                  </div>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
                <div className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-slate-200 sm:grid-cols-[160px_minmax(0,1fr)]">
                  <div className="bg-slate-100 px-4 py-4 text-right text-xs font-medium text-slate-600">
                    Módulos Permitidos
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-lime-50 text-lime-700">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-lime-700">{profileLabel(form.role)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{profileDescription(form.role)}</p>
                    </div>
                  </div>
                </div>
                <PermissionMatrix grouped={modalPermissions} />
              </div>
            </div>
          ) : null}
          {modalTab === 'link' && showLinkTab ? <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Clínica vinculada</label><select value={form.linkedClinicId} onChange={(event) => setForm((c) => ({ ...c, linkedClinicId: event.target.value, linkedDentistId: '' }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Selecione</option>{clinicOptions.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.tradeName}</option>)}</select></div>{form.role === 'dentist_client' ? <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium text-slate-700">Dentista responsável</label><select value={form.linkedDentistId} onChange={(event) => setForm((c) => ({ ...c, linkedDentistId: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Selecione</option>{dentistsForSelect.map((dentist) => <option key={dentist.id} value={dentist.id}>{dentist.name}</option>)}</select></div> : null}</div> : null}
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

