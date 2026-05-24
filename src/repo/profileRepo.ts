import { DATA_MODE } from '../data/dataMode'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { createUserWithEmailAndPassword, deleteUser, updateProfile as updateFirebaseAuthProfile } from 'firebase/auth'
import { auth, db as firestoreDb } from '../lib/firebaseClient'
import { nowIsoDateTime } from '../shared/utils/date'
import type { Role } from '../types/User'
import { createCaseFromScanFirebase } from '../data/scanRepo'
import { approveScanFirebase, createScanFirebase, deleteScanFirebase, rejectScanFirebase } from '../data/scanRepo'
import { deleteCaseFirebase, getCaseFirebase, updateCaseFirebase } from '../data/caseRepo'
import { listLabOrdersFirebase } from '../modules/lab/infra/firebase/FirestoreLabRepository'
import { getCanonicalLabOrders } from '../modules/lab/domain/services/ProductionQueueService'
import { generateCaseLabOrderFirebase } from './caseLabFirebase'
import type { Scan } from '../types/Scan'
import type { LabItem } from '../types/Lab'

export type ProfileRecord = {
  user_id: string
  login_email?: string | null
  role: string
  clinic_id: string | null
  dentist_id: string | null
  full_name: string | null
  cpf: string | null
  phone: string | null
  onboarding_completed_at: string | null
  is_active: boolean
  deleted_at: string | null
  created_at?: string
  updated_at?: string
}

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase não configurado. Verifique as variáveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

function mapProfileDoc(userId: string, data: Record<string, unknown>): ProfileRecord {
  return {
    user_id: userId,
    login_email: (data.loginEmail as string | undefined) ?? (data.login_email as string | undefined) ?? null,
    role: String(data.role ?? 'dentist_client'),
    clinic_id: (data.clinicId as string | undefined) ?? (data.clinic_id as string | undefined) ?? null,
    dentist_id: (data.dentistId as string | undefined) ?? (data.dentist_id as string | undefined) ?? null,
    full_name: (data.fullName as string | undefined) ?? (data.full_name as string | undefined) ?? null,
    cpf: (data.cpf as string | null | undefined) ?? null,
    phone: (data.phone as string | null | undefined) ?? null,
    onboarding_completed_at:
      (data.onboardingCompletedAt as string | undefined) ?? (data.onboarding_completed_at as string | undefined) ?? null,
    is_active: Boolean(data.isActive ?? data.is_active ?? true),
    deleted_at: (data.deletedAt as string | undefined) ?? (data.deleted_at as string | undefined) ?? null,
    created_at: (data.createdAt as string | undefined) ?? (data.created_at as string | undefined),
    updated_at: (data.updatedAt as string | undefined) ?? (data.updated_at as string | undefined),
  }
}

export async function getProfileByUserId(userId: string) {
  if (DATA_MODE !== 'firebase') return null
  try {
    const snapshot = await getDoc(doc(getFirestoreDb(), 'profiles', userId))
    if (!snapshot.exists()) return null
    return mapProfileDoc(snapshot.id, snapshot.data())
  } catch {
    return null
  }
}

export async function listProfiles(options?: { includeDeleted?: boolean }) {
  if (DATA_MODE !== 'firebase') return []
  const snapshot = await getDocs(collection(getFirestoreDb(), 'profiles'))
  return snapshot.docs
    .map((item) => mapProfileDoc(item.id, item.data()))
    .filter((profile) => (options?.includeDeleted ? true : !profile.deleted_at))
}

export async function setProfileActive(userId: string, isActive: boolean) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Disponível apenas no modo Firebase.' }
  await updateDoc(doc(getFirestoreDb(), 'profiles', userId), {
    isActive,
    is_active: isActive,
    updatedAt: nowIsoDateTime(),
    updated_at: nowIsoDateTime(),
  })
  return { ok: true as const }
}

export async function softDeleteProfile(userId: string) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Disponível apenas no modo Firebase.' }
  const now = nowIsoDateTime()
  await updateDoc(doc(getFirestoreDb(), 'profiles', userId), {
    deletedAt: now,
    deleted_at: now,
    isActive: false,
    is_active: false,
    updatedAt: now,
    updated_at: now,
  })
  return { ok: true as const }
}

export async function restoreProfile(userId: string) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Disponível apenas no modo Firebase.' }
  const now = nowIsoDateTime()
  await updateDoc(doc(getFirestoreDb(), 'profiles', userId), {
    deletedAt: null,
    deleted_at: null,
    isActive: true,
    is_active: true,
    updatedAt: now,
    updated_at: now,
  })
  return { ok: true as const }
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<ProfileRecord, 'full_name' | 'cpf' | 'phone' | 'role' | 'clinic_id' | 'dentist_id' | 'is_active'>>,
) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Disponível apenas no modo Firebase.' }
  const now = nowIsoDateTime()
  await updateDoc(doc(getFirestoreDb(), 'profiles', userId), {
    ...(patch.full_name !== undefined ? { fullName: patch.full_name, full_name: patch.full_name } : {}),
    ...(patch.cpf !== undefined ? { cpf: patch.cpf } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.clinic_id !== undefined ? { clinicId: patch.clinic_id, clinic_id: patch.clinic_id } : {}),
    ...(patch.dentist_id !== undefined ? { dentistId: patch.dentist_id, dentist_id: patch.dentist_id } : {}),
    ...(patch.is_active !== undefined ? { isActive: patch.is_active, is_active: patch.is_active } : {}),
    updatedAt: now,
    updated_at: now,
  })
  return { ok: true as const }
}

export async function inviteUser(payload: {
  email: string
  role: string
  clinicId: string
  dentistId?: string
  fullName?: string
  password?: string
  cpf?: string
  phone?: string
  accessToken?: string
}) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Convite de usuário remoto disponível apenas no modo Firebase.' }
  }
  if (!auth) return { ok: false as const, error: 'Firebase Auth não configurado.' }
  const email = payload.email.trim()
  const password = payload.password?.trim()
  if (!email) return { ok: false as const, error: 'E-mail é obrigatório.' }
  if (!password || password.length < 8) {
    return { ok: false as const, error: 'Senha deve ter no mínimo 8 caracteres.' }
  }

  let userCredential
  try {
    userCredential = await createUserWithEmailAndPassword(auth, email, password)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code: unknown }).code)
      if (code === 'auth/email-already-in-use') return { ok: false as const, error: 'E-mail já cadastrado.', code: 'invite_failed' }
      if (code === 'auth/invalid-email') return { ok: false as const, error: 'E-mail inválido.', code: 'invite_failed' }
      if (code === 'auth/weak-password') return { ok: false as const, error: 'Senha muito fraca.', code: 'invite_failed' }
    }
    return { ok: false as const, error: 'Falha ao criar usuário.', code: 'invite_failed' }
  }

  const user = userCredential.user
  const now = nowIsoDateTime()
  try {
    if (payload.fullName?.trim()) {
      await updateFirebaseAuthProfile(user, { displayName: payload.fullName.trim() })
    }
    await setDoc(doc(getFirestoreDb(), 'profiles', user.uid), {
      role: payload.role as Role,
      clinicId: payload.clinicId,
      clinic_id: payload.clinicId,
      dentistId: payload.dentistId ?? null,
      dentist_id: payload.dentistId ?? null,
      loginEmail: email,
      login_email: email,
      email,
      fullName: payload.fullName?.trim() ?? null,
      full_name: payload.fullName?.trim() ?? null,
      cpf: payload.cpf?.trim() ?? null,
      phone: payload.phone?.trim() ?? null,
      isActive: true,
      is_active: true,
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now,
    })
    return { ok: true as const, data: { userId: user.uid } }
  } catch (error) {
    try {
      await deleteUser(user)
    } catch {
      // ignore cleanup failure
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Falha ao salvar perfil do usuário.',
      code: 'invite_failed',
    }
  }
}

export async function createScanSupabase(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  try {
    const created = await createScanFirebase(scan)
    return { ok: true as const, id: created.id }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Falha ao criar exame.' }
  }
}

export async function createCaseFromScanSupabase(
  scan: Scan,
  payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  },
) {
  return createCaseFromScanFirebase(scan.id, payload)
}

export async function patchCaseDataSupabase(
  caseId: string,
  patch: Record<string, unknown>,
  options?: { status?: string; phase?: string },
) {
  const current = await getCaseFirebase(caseId)
  if (!current) return { ok: false as const, error: 'Caso não encontrado.' }
  const updated = await updateCaseFirebase(caseId, {
    ...current,
    ...(patch as Partial<typeof current>),
    status: (options?.status as typeof current.status | undefined) ?? current.status,
    phase: (options?.phase as typeof current.phase | undefined) ?? current.phase,
  })
  if (!updated) return { ok: false as const, error: 'Falha ao atualizar caso.' }
  return { ok: true as const }
}

export async function listCaseLabItemsSupabase(caseId: string): Promise<LabItem[]> {
  const orders = await listLabOrdersFirebase()
  return getCanonicalLabOrders(orders.filter((item) => item.caseId === caseId))
}

export async function generateCaseLabOrderSupabase(caseId: string) {
  return generateCaseLabOrderFirebase(caseId)
}

export async function updateScanStatusSupabase(scanId: string, status: 'aprovado' | 'reprovado') {
  if (status === 'aprovado') {
    const result = await approveScanFirebase(scanId)
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? 'Falha ao aprovar exame.' }
  }
  const result = await rejectScanFirebase(scanId)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? 'Falha ao reprovar exame.' }
}

export async function deleteScanSupabase(scanId: string) {
  const result = await deleteScanFirebase(scanId)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? 'Falha ao excluir exame.' }
}

export async function deleteCaseSupabase(caseId: string) {
  const result = await deleteCaseFirebase(caseId)
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? 'Falha ao excluir caso.' }
}

export async function deleteLabItemSupabase(labItemId: string) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Disponível apenas no modo Firebase.' }
  const now = nowIsoDateTime()
  await updateDoc(doc(getFirestoreDb(), 'lab_items', labItemId), {
    deletedAt: now,
    deleted_at: now,
    updatedAt: now,
    updated_at: now,
  })
  return { ok: true as const }
}

export async function normalizeTreatmentIdsSupabase() {
  return { ok: true as const, message: 'Normalização não necessária no Firebase.' }
}
