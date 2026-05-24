import { DATA_MODE } from '../data/dataMode'
import type { Role } from '../types/User'
import { completeInviteFirebase, validateInviteFirebase } from './inviteRepo'

export async function createOnboardingInvite(_payload: {
  fullName: string
  cpf?: string
  phone?: string
  role: Role
  clinicId: string
  dentistId?: string
}) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Convites remotos disponíveis apenas no modo Firebase.' }
  }
  return {
    ok: false as const,
    error: 'Criação de convite por link requer Firebase Cloud Function (use convites de entidade no Firebase).',
  }
}

export async function validateOnboardingInvite(token: string) {
  if (DATA_MODE === 'firebase') {
    return validateInviteFirebase(token)
  }
  return { ok: false as const, error: 'Convite inválido.', expired: false, used: false }
}

export async function completeOnboardingInvite(payload: {
  token: string
  email: string
  password: string
  fullName?: string
  dentist?: {
    name?: string
    gender?: 'masculino' | 'feminino'
    cro?: string
    phone?: string
    whatsapp?: string
    email?: string
    notes?: string
  }
}) {
  if (DATA_MODE === 'firebase') {
    return completeInviteFirebase({
      code: payload.token,
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName ?? '',
    })
  }
  return { ok: false as const, error: 'Modo local: use cadastro interno.' }
}

export async function completeOnboardingInviteSocial(token: string, displayName?: string) {
  if (DATA_MODE !== 'firebase') return { ok: false as const, error: 'Apenas modo Firebase suporta este fluxo.' }
  const { completeInviteForSocial } = await import('./inviteRepo')
  return completeInviteForSocial(token, displayName)
}
