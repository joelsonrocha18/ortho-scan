import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { createUserWithEmailAndPassword, deleteUser, updateProfile, signOut as firebaseSignOut } from 'firebase/auth'
import { auth, db as firestoreDb } from '../lib/firebaseClient'
import { createEntityId } from '../shared/utils/id'
import { nowIsoDateTime } from '../shared/utils/date'
import type { Role } from '../types/User'
import type { Clinic } from '../types/Clinic'
import type { DentistClinic } from '../types/DentistClinic'

export type InviteEntityType = 'clinic' | 'dentist'
export type InviteStatus = 'active' | 'used' | 'expired'

export type Invite = {
  id: string
  code: string
  role: Role
  entityType: InviteEntityType
  entityId: string
  fullName?: string
  clinicId?: string
  dentistId?: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
  usedAt?: string
  usedByUserId?: string
  status: InviteStatus
}

type CreateInvitePayload = {
  role: Role
  entityType: InviteEntityType
  entityId: string
  fullName?: string
  clinicId?: string
  dentistId?: string
  expiresInDays?: number
}

type FirebaseInviteDocument = {
  id: string
  code: string
  role: Role
  entity_type: InviteEntityType
  entity_id: string
  full_name?: string
  clinic_id?: string
  dentist_id?: string
  created_at: string
  updated_at: string
  expires_at?: string
  used_at?: string
  used_by_user_id?: string
  status: InviteStatus
}

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

function randomAlphaNumeric(length: number) {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let result = ''
  const values = new Uint8Array(length)
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(values)
  } else {
    for (let i = 0; i < length; i += 1) {
      values[i] = Math.floor(Math.random() * 256)
    }
  }
  for (const byte of values) {
    result += chars[byte % chars.length]
  }
  return result
}

function createInviteCode() {
  return `INV-${randomAlphaNumeric(4)}-${randomAlphaNumeric(4)}`
}

function inviteToDocument(invite: Invite): FirebaseInviteDocument {
  return {
    id: invite.id,
    code: invite.code,
    role: invite.role,
    entity_type: invite.entityType,
    entity_id: invite.entityId,
    full_name: invite.fullName,
    clinic_id: invite.clinicId,
    dentist_id: invite.dentistId,
    created_at: invite.createdAt,
    updated_at: invite.updatedAt,
    expires_at: invite.expiresAt,
    used_at: invite.usedAt,
    used_by_user_id: invite.usedByUserId,
    status: invite.status,
  }
}

function mapInviteDocument(id: string, data: Partial<FirebaseInviteDocument>): Invite {
  return {
    id,
    code: String(data.code ?? ''),
    role: data.role ?? 'dentist_client',
    entityType: data.entity_type ?? 'dentist',
    entityId: String(data.entity_id ?? ''),
    fullName: data.full_name ?? undefined,
    clinicId: data.clinic_id ?? undefined,
    dentistId: data.dentist_id ?? undefined,
    createdAt: String(data.created_at ?? nowIsoDateTime()),
    updatedAt: String(data.updated_at ?? nowIsoDateTime()),
    expiresAt: data.expires_at ?? undefined,
    usedAt: data.used_at ?? undefined,
    usedByUserId: data.used_by_user_id ?? undefined,
    status: data.status ?? 'active',
  }
}

function buildInvitePreview(invite: Invite) {
  const roleLabel = getRoleLabel(invite.role)
  const clinicName = invite.entityType === 'clinic' ? invite.fullName ?? 'Clínica' : invite.fullName ?? 'Dentista'
  return {
    fullName: invite.fullName ?? clinicName,
    role: invite.role,
    roleLabel,
    clinicName,
  }
}

function getRoleLabel(role: Role) {
  switch (role) {
    case 'master_admin':
      return 'Administrador'
    case 'dentist_admin':
      return 'Administrador de dentista'
    case 'dentist_client':
      return 'Dentista'
    case 'clinic_client':
      return 'Clínica'
    case 'lab_tech':
      return 'Técnico de laboratório'
    case 'receptionist':
      return 'Recepcionista'
    default:
      return 'Usuário'
  }
}

function isExpired(invite: Invite) {
  return invite.expiresAt ? new Date(invite.expiresAt).getTime() < Date.now() : false
}

export async function createInviteFirebase(payload: CreateInvitePayload) {
  const now = nowIsoDateTime()
  const invite: Invite = {
    id: createEntityId('invite'),
    code: createInviteCode(),
    role: payload.role,
    entityType: payload.entityType,
    entityId: payload.entityId,
    fullName: payload.fullName,
    clinicId: payload.clinicId,
    dentistId: payload.dentistId,
    createdAt: now,
    updatedAt: now,
    expiresAt: payload.expiresInDays ? new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000).toISOString() : undefined,
    usedAt: undefined,
    usedByUserId: undefined,
    status: 'active',
  }
  await setDoc(doc(getFirestoreDb(), 'invitations', invite.id), inviteToDocument(invite))
  return { ok: true as const, invite }
}

export async function getInviteByCodeFirebase(code: string) {
  const invitations = collection(getFirestoreDb(), 'invitations')
  const q = query(invitations, where('code', '==', code))
  const snapshot = await getDocs(q)
  if (snapshot.docs.length === 0) return null
  return mapInviteDocument(snapshot.docs[0].id, snapshot.docs[0].data() as Partial<FirebaseInviteDocument>)
}

export async function listActiveInvitesByEntityFirebase(entityType: InviteEntityType) {
  const invitations = collection(getFirestoreDb(), 'invitations')
  const q = query(invitations, where('entity_type', '==', entityType), where('status', '==', 'active'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((item) => mapInviteDocument(item.id, item.data() as Partial<FirebaseInviteDocument>))
}

export async function validateInviteFirebase(code: string) {
  const invite = await getInviteByCodeFirebase(code)
  if (!invite) {
    return { ok: false as const, error: 'Convite inválido.', expired: false, used: false }
  }
  if (invite.status === 'used' || invite.usedAt) {
    return { ok: false as const, error: 'Este convite já foi utilizado.', expired: false, used: true }
  }
  if (isExpired(invite)) {
    return { ok: false as const, error: 'Este convite expirou. Solicite um novo convite.', expired: true, used: false }
  }
  return { ok: true as const, preview: buildInvitePreview(invite) }
}

export async function markInviteAsUsedFirebase(code: string, usedByUserId: string) {
  const invite = await getInviteByCodeFirebase(code)
  if (!invite) return { ok: false as const, error: 'Convite não encontrado.' }
  await updateDoc(doc(getFirestoreDb(), 'invitations', invite.id), {
    status: 'used',
    used_at: new Date().toISOString(),
    used_by_user_id: usedByUserId,
    updated_at: new Date().toISOString(),
  })
  return { ok: true as const }
}

export async function completeInviteFirebase(payload: {
  code: string
  email: string
  password: string
  fullName: string
}) {
  if (!auth) return { ok: false as const, error: 'Firebase nao configurado.' }
  const inviteCode = payload.code.trim()
  if (!inviteCode) return { ok: false as const, error: 'Código de convite obrigatório.' }

  const invite = await getInviteByCodeFirebase(inviteCode)
  if (!invite) return { ok: false as const, error: 'Convite inválido.' }
  if (invite.status === 'used' || invite.usedAt) return { ok: false as const, error: 'Este convite já foi utilizado.' }
  if (isExpired(invite)) return { ok: false as const, error: 'Este convite expirou.' }

  let userCredential
  try {
    userCredential = await createUserWithEmailAndPassword(auth, payload.email.trim(), payload.password)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code: unknown }).code)
      if (code === 'auth/email-already-in-use') {
        return { ok: false as const, error: 'E-mail já cadastrado.' }
      }
      if (code === 'auth/invalid-email') {
        return { ok: false as const, error: 'E-mail inválido.' }
      }
      if (code === 'auth/weak-password') {
        return { ok: false as const, error: 'Senha muito fraca.' }
      }
    }
    return { ok: false as const, error: 'Falha ao criar usuário.' }
  }

  const user = userCredential.user
  const now = nowIsoDateTime()
  const profileDoc = {
    id: user.uid,
    role: invite.role,
    clinicId: invite.entityType === 'clinic' ? invite.entityId : invite.clinicId,
    clinic_id: invite.entityType === 'clinic' ? invite.entityId : invite.clinicId,
    dentistId: invite.entityType === 'dentist' ? invite.entityId : invite.dentistId,
    dentist_id: invite.entityType === 'dentist' ? invite.entityId : invite.dentistId,
    loginEmail: payload.email.trim(),
    login_email: payload.email.trim(),
    email: payload.email.trim(),
    isActive: true,
    is_active: true,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now,
  }

  try {
    await updateProfile(user, { displayName: payload.fullName.trim() })
    await setDoc(doc(getFirestoreDb(), 'profiles', user.uid), profileDoc)
    const inviteResult = await markInviteAsUsedFirebase(inviteCode, user.uid)
    if (!inviteResult.ok) {
      throw new Error(inviteResult.error)
    }
    await firebaseSignOut(auth)
    return { ok: true as const }
  } catch (error) {
    try {
      await deleteUser(user)
    } catch {
      // Ignore cleanup failure.
    }
    await firebaseSignOut(auth)
    return { ok: false as const, error: error instanceof Error ? error.message : 'Falha ao concluir cadastro.' }
  }
}

export async function completeInviteForSocial(code: string, displayName?: string) {
  if (!auth) return { ok: false as const, error: 'Firebase nao configurado.' }
  const inviteCode = code.trim()
  if (!inviteCode) return { ok: false as const, error: 'Código de convite obrigatório.' }

  const invite = await getInviteByCodeFirebase(inviteCode)
  if (!invite) return { ok: false as const, error: 'Convite inválido.' }
  if (invite.status === 'used' || invite.usedAt) return { ok: false as const, error: 'Este convite já foi utilizado.' }
  if (isExpired(invite)) return { ok: false as const, error: 'Este convite expirou.' }

  const user = auth.currentUser
  if (!user) return { ok: false as const, error: 'Nenhum usuário autenticado no Firebase.' }

  const now = nowIsoDateTime()
  const profileDoc = {
    id: user.uid,
    role: invite.role,
    clinicId: invite.entityType === 'clinic' ? invite.entityId : invite.clinicId,
    clinic_id: invite.entityType === 'clinic' ? invite.entityId : invite.clinicId,
    dentistId: invite.entityType === 'dentist' ? invite.entityId : invite.dentistId,
    dentist_id: invite.entityType === 'dentist' ? invite.entityId : invite.dentistId,
    loginEmail: user.email ?? null,
    login_email: user.email ?? null,
    email: user.email ?? null,
    isActive: true,
    is_active: true,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now,
  }

  try {
    if (displayName && typeof displayName === 'string') {
      await updateProfile(user, { displayName: displayName.trim() })
    }
    await setDoc(doc(getFirestoreDb(), 'profiles', user.uid), profileDoc)
    const inviteResult = await markInviteAsUsedFirebase(inviteCode, user.uid)
    if (!inviteResult.ok) {
      throw new Error(inviteResult.error)
    }
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Falha ao concluir cadastro social.' }
  }
}
