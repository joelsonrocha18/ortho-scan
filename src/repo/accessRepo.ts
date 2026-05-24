import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebaseClient'
import { DATA_MODE } from '../data/dataMode'
import { logger } from '../lib/logger'

export async function sendAccessEmail(_payload: { email: string; fullName?: string }) {
  if (DATA_MODE !== 'firebase') {
    return { ok: false as const, error: 'Envio de e-mail de acesso requer Cloud Function (migração pendente).' }
  }
  return {
    ok: false as const,
    error: 'Envio automático de e-mail de acesso será disponibilizado via Firebase Cloud Functions.',
  }
}

export async function requestPasswordReset(payload: { email: string }) {
  if (DATA_MODE !== 'firebase' || !auth) {
    return { ok: false as const, error: 'Redefinição de senha disponível apenas no modo Firebase.' }
  }
  try {
    await sendPasswordResetEmail(auth, payload.email.trim())
    return { ok: true as const }
  } catch (error) {
    logger.warn('Falha ao solicitar redefinição de senha Firebase.', { email: payload.email }, error)
    return { ok: true as const, warning: 'Se o e-mail existir, um link de redefinição será enviado.' }
  }
}

export async function completePasswordReset(_payload: { token: string; newPassword: string }) {
  return {
    ok: false as const,
    error: 'Conclusão de reset por token customizado requer Cloud Function. Use o link enviado por e-mail do Firebase Auth.',
  }
}
