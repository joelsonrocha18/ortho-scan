import { pushAudit } from '../data/audit'
import { ensureMasterUserInDb, loadDb, saveDb } from '../data/db'
import { getSessionUserId, setSessionUserId, clearSession, setSessionProfile } from '../lib/auth'
import { logger } from '../lib/logger'
import { clearCurrentPushSubscription } from '../pwa/pushSubscriptionRepo'
import { createUnauthorizedError } from '../shared/errors'
import { validateSignInInput } from '../shared/validators'
import type { AuthProvider, SessionUser } from './session'

export const authLocal: AuthProvider = {
  async getCurrentUser(): Promise<SessionUser | null> {
    const userId = getSessionUserId()
    if (!userId) return null
    const db = loadDb()
    const user = db.users.find((item) => item.id === userId)
    if (!user || user.deletedAt || !user.isActive) return null
    const profile = {
      id: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.linkedClinicId,
      dentistId: user.linkedDentistId,
    }
    setSessionProfile(profile)
    return profile
  },
  async signIn(email: string, password: string) {
    const credentials = validateSignInInput({ email, password })
    const credential = credentials.email
    let db = loadDb()
    let user = db.users.find((item) => {
      if (!item.isActive || item.deletedAt) return false
      const emailMatch = item.email.toLowerCase() === credential
      const usernameMatch = (item.username ?? '').trim().toLowerCase() === credential
      return emailMatch || usernameMatch
    })
    if (!user) {
      db = ensureMasterUserInDb()
      user = db.users.find((item) => {
        if (!item.isActive || item.deletedAt) return false
        const emailMatch = item.email.toLowerCase() === credential
        const usernameMatch = (item.username ?? '').trim().toLowerCase() === credential
        return emailMatch || usernameMatch
      })
    }
    if (!user) {
      pushAudit(db, {
        entity: 'auth',
        entityId: credential,
        action: 'auth.sign_in_failed',
        message: `Falha de autenticação local para ${credential}. Usuário não encontrado.`,
      })
      saveDb(db)
      logger.warn('Tentativa de autenticação local sem usuário correspondente.', { flow: 'auth.sign_in', credential })
      throw new Error('Usuário não encontrado.')
    }
    if (!user.password) {
      logger.warn('Tentativa de autenticação local sem senha configurada.', { flow: 'auth.sign_in', userId: user.id })
      throw new Error('Senha não configurada para este usuário.')
    }
    const validPassword = credentials.password === user.password
    if (!validPassword) {
      pushAudit(db, {
        entity: 'auth',
        entityId: user.id,
        action: 'auth.sign_in_failed',
        message: `Falha de autenticação local para ${credential}. Senha inválida.`,
      })
      saveDb(db)
      logger.warn('Tentativa de autenticação local com senha inválida.', { flow: 'auth.sign_in', userId: user.id })
      throw createUnauthorizedError('Senha inválida.')
    }
    setSessionUserId(user.id)
    setSessionProfile({
      id: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.linkedClinicId,
      dentistId: user.linkedDentistId,
    })
    pushAudit(db, {
      entity: 'auth',
      entityId: user.id,
      action: 'auth.sign_in_succeeded',
      message: `Sessão local iniciada para ${user.email}.`,
    })
    saveDb(db)
    logger.info('Autenticacao local concluida.', { flow: 'auth.sign_in', userId: user.id, role: user.role })
  },
  async signInWithProvider() {
    throw createUnauthorizedError('Login social disponível apenas no modo Firebase.')
  },
  async signOut() {
    try {
      await clearCurrentPushSubscription()
    } catch (error) {
      logger.warn('Falha ao limpar notificações push durante o logout local.', {
        flow: 'auth.sign_out.push_cleanup',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    clearSession()
  },
}
