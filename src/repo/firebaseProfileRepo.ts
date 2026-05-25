import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail, signOut } from 'firebase/auth'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { allPermissions, normalizePermissions, permissionsForRole } from '../auth/permissions'
import { auth as firebaseAuth, db as firestoreDb, firebaseApp } from '../lib/firebaseClient'
import { nowIsoDateTime } from '../shared/utils/date'
import type { Role, User } from '../types/User'

type FirebaseProfileDocument = {
  id?: string
  user_id?: string
  email?: string | null
  loginEmail?: string | null
  login_email?: string | null
  fullName?: string | null
  full_name?: string | null
  name?: string | null
  cpf?: string | null
  phone?: string | null
  role?: string | null
  clinicId?: string | null
  clinic_id?: string | null
  dentistId?: string | null
  dentist_id?: string | null
  permissions?: string[] | null
  permissionOverrides?: string[] | null
  permission_overrides?: string[] | null
  isActive?: boolean | null
  is_active?: boolean | null
  deletedAt?: string | null
  deleted_at?: string | null
  createdAt?: string | null
  created_at?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

type FirebaseProfilePatch = {
  fullName?: string | null
  cpf?: string | null
  phone?: string | null
  role?: Role
  clinicId?: string | null
  dentistId?: string | null
  permissions?: string[]
  isActive?: boolean
  deletedAt?: string | null
}

const ROLE_VALUES: Role[] = ['master_admin', 'dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']

function getFirestoreDb() {
  if (!firestoreDb) throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  return firestoreDb
}

function normalizeEmail(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function normalizeRole(value: unknown): Role {
  return typeof value === 'string' && ROLE_VALUES.includes(value as Role) ? value as Role : 'dentist_client'
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function profileName(profile: FirebaseProfileDocument, fallback: string) {
  return normalizeText(profile.fullName) || normalizeText(profile.full_name) || normalizeText(profile.name) || fallback
}

function profileEmail(profile: FirebaseProfileDocument) {
  return normalizeEmail(profile.loginEmail ?? profile.login_email ?? profile.email)
}

function profilePermissions(profile: FirebaseProfileDocument, role: Role) {
  const source = profile.permissions ?? profile.permissionOverrides ?? profile.permission_overrides
  return normalizePermissions(source) ?? permissionsForRole(role)
}

function profileToUser(id: string, profile: FirebaseProfileDocument): User | null {
  const email = profileEmail(profile)
  if (!email) return null
  const deletedAt = profile.deletedAt ?? profile.deleted_at ?? null
  const role = normalizeRole(profile.role)

  return {
    id,
    name: profileName(profile, email || id),
    email,
    role,
    permissions: profilePermissions(profile, role),
    isActive: profile.isActive ?? profile.is_active ?? true,
    linkedClinicId: profile.clinicId ?? profile.clinic_id ?? undefined,
    linkedDentistId: profile.dentistId ?? profile.dentist_id ?? undefined,
    cpf: profile.cpf ?? undefined,
    whatsapp: profile.phone ?? undefined,
    deletedAt: typeof deletedAt === 'string' ? deletedAt : undefined,
    createdAt: profile.createdAt ?? profile.created_at ?? '',
    updatedAt: profile.updatedAt ?? profile.updated_at ?? '',
  }
}

function sanitizePermissions(permissions: string[] | undefined, role: Role) {
  const selected = permissions ? (normalizePermissions(permissions) ?? []) : permissionsForRole(role)
  return allPermissions.filter((permission) => selected.includes(permission))
}

function buildProfilePatch(patch: FirebaseProfilePatch) {
  const now = nowIsoDateTime()
  const next: Record<string, unknown> = {
    updatedAt: now,
    updated_at: now,
  }

  if ('fullName' in patch) {
    next.fullName = patch.fullName
    next.full_name = patch.fullName
  }
  if ('cpf' in patch) next.cpf = patch.cpf
  if ('phone' in patch) next.phone = patch.phone
  if (patch.role) next.role = patch.role
  if ('clinicId' in patch) {
    next.clinicId = patch.clinicId
    next.clinic_id = patch.clinicId
  }
  if ('dentistId' in patch) {
    next.dentistId = patch.dentistId
    next.dentist_id = patch.dentistId
  }
  if ('permissions' in patch) {
    const role = patch.role ?? 'dentist_client'
    const permissions = sanitizePermissions(patch.permissions, role)
    next.permissions = permissions
    next.permissionOverrides = permissions
    next.permission_overrides = permissions
  }
  if ('isActive' in patch) {
    next.isActive = patch.isActive
    next.is_active = patch.isActive
  }
  if ('deletedAt' in patch) {
    next.deletedAt = patch.deletedAt
    next.deleted_at = patch.deletedAt
  }

  return next
}

export async function listFirebaseProfiles(options?: { includeDeleted?: boolean }) {
  const snapshot = await getDocs(collection(getFirestoreDb(), 'profiles'))
  return snapshot.docs
    .map((item) => profileToUser(item.id, item.data() as FirebaseProfileDocument))
    .filter((user): user is User => Boolean(user))
    .filter((user) => options?.includeDeleted || !user.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function createFirebaseProfile(payload: {
  email: string
  password: string
  fullName: string
  cpf?: string
  phone?: string
  role: Role
  clinicId?: string
  dentistId?: string
  permissions?: string[]
}) {
  if (!firebaseApp) return { ok: false as const, error: 'Firebase não configurado.' }
  const email = normalizeEmail(payload.email)
  const password = payload.password.trim()
  const fullName = payload.fullName.trim()
  if (!fullName) return { ok: false as const, error: 'Nome é obrigatório.' }
  if (!email) return { ok: false as const, error: 'E-mail é obrigatório.' }
  if (!password) return { ok: false as const, error: 'Senha é obrigatória.' }
  if (password.length < 6) return { ok: false as const, error: 'Senha deve ter no mínimo 6 caracteres.' }

  const secondaryApp = initializeApp(firebaseApp.options, `user-create-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const secondaryAuth = getAuth(secondaryApp)

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    const now = nowIsoDateTime()
    const permissions = sanitizePermissions(payload.permissions, payload.role)
    const profile = {
      id: credential.user.uid,
      user_id: credential.user.uid,
      email,
      loginEmail: email,
      login_email: email,
      fullName,
      full_name: fullName,
      cpf: payload.cpf?.trim() || null,
      phone: payload.phone?.trim() || null,
      role: payload.role,
      clinicId: payload.clinicId || null,
      clinic_id: payload.clinicId || null,
      dentistId: payload.dentistId || null,
      dentist_id: payload.dentistId || null,
      permissions,
      permissionOverrides: permissions,
      permission_overrides: permissions,
      isActive: true,
      is_active: true,
      deletedAt: null,
      deleted_at: null,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now,
    }
    await setDoc(doc(getFirestoreDb(), 'profiles', credential.user.uid), profile, { merge: true })
    return { ok: true as const, user: profileToUser(credential.user.uid, profile as FirebaseProfileDocument) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao criar usuário no Firebase.'
    return { ok: false as const, error: normalizeFirebaseAuthError(message) }
  } finally {
    await signOut(secondaryAuth).catch(() => undefined)
    await deleteApp(secondaryApp).catch(() => undefined)
  }
}

export async function updateFirebaseProfile(userId: string, patch: FirebaseProfilePatch) {
  try {
    await setDoc(doc(getFirestoreDb(), 'profiles', userId), buildProfilePatch(patch), { merge: true })
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Falha ao atualizar usuário no Firebase.' }
  }
}

export async function setFirebaseProfileActive(userId: string, isActive: boolean) {
  return updateFirebaseProfile(userId, { isActive })
}

export async function softDeleteFirebaseProfile(userId: string) {
  return updateFirebaseProfile(userId, { isActive: false, deletedAt: nowIsoDateTime() })
}

export async function sendFirebasePasswordReset(email: string) {
  if (!firebaseAuth) return { ok: false as const, error: 'Firebase Auth não configurado.' }
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return { ok: false as const, error: 'E-mail é obrigatório.' }
  try {
    await sendPasswordResetEmail(firebaseAuth, normalizedEmail)
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar redefinição de senha.'
    return { ok: false as const, error: normalizeFirebaseAuthError(message) }
  }
}

function normalizeFirebaseAuthError(message: string) {
  const text = message.toLowerCase()
  if (text.includes('auth/email-already-in-use')) return 'E-mail já cadastrado no Firebase.'
  if (text.includes('auth/invalid-email')) return 'E-mail inválido.'
  if (text.includes('auth/weak-password')) return 'Senha fraca. Use no mínimo 6 caracteres.'
  if (text.includes('auth/operation-not-allowed')) return 'Criação por e-mail e senha não está habilitada no Firebase Auth.'
  if (text.includes('permission') || text.includes('permiss')) return 'Sem permissão para alterar usuários no Firebase.'
  return message
}
