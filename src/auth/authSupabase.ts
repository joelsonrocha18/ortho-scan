import type { AuthProvider, SessionUser } from './session'
import { supabase } from '../lib/supabaseClient'
import { setSessionProfile, clearSession, setSupabaseAccessToken } from '../lib/auth'
import { getProfileByUserId } from '../repo/profileRepo'
import { logger } from '../lib/logger'
import { clearCurrentPushSubscription } from '../pwa/pushSubscriptionRepo'
import { createUnauthorizedError } from '../shared/errors'
import { validateSignInInput } from '../shared/validators'

export const authSupabase: AuthProvider = {
  async getCurrentUser(): Promise<SessionUser | null> {
    try {
      if (!supabase) return null
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session?.access_token) {
        setSupabaseAccessToken(sessionData.session.access_token)
      }
      const { data, error } = await supabase.auth.getUser()
      if (error || !data?.user) return null
      const profile = await getProfileByUserId(data.user.id)
      const session = {
        id: data.user.id,
        email: data.user.email ?? undefined,
        role: profile?.role ?? 'dentist_client',
        clinicId: profile?.clinic_id ?? undefined,
        dentistId: profile?.dentist_id ?? undefined,
      }
      setSessionProfile(session)
      logger.info('Sessão Supabase carregada.', { flow: 'auth.get_current_user', userId: session.id, role: session.role })
      return session
    } catch (error) {
      logger.error('Falha ao carregar sessão Supabase.', { flow: 'auth.get_current_user' }, error)
      return null
    }
  },
  async signIn(email: string, password: string) {
    const credentials = validateSignInInput({ email, password })
    if (!supabase) throw new Error('Supabase não configurado.')
    const { data, error } = await supabase.auth.signInWithPassword(credentials)
    if (error) {
      logger.warn('Falha de autenticação Supabase.', { flow: 'auth.sign_in', email: credentials.email, status: error.status })
      throw createUnauthorizedError(error.message)
    }
    if (data.session?.access_token) {
      setSupabaseAccessToken(data.session.access_token)
    }
    logger.info('Autenticacao Supabase concluida.', { flow: 'auth.sign_in', email: credentials.email })
  },
  async signInWithProvider(provider) {
    if (!supabase) throw new Error('Supabase nÃ£o configurado.')
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/app/dashboard` },
    })
    if (error) throw createUnauthorizedError(error.message)
  },
  async signOut() {
    if (!supabase) return
    try {
      await clearCurrentPushSubscription()
    } catch (error) {
      logger.warn('Falha ao limpar notificações push durante o logout Supabase.', {
        flow: 'auth.sign_out.push_cleanup',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    await supabase.auth.signOut()
    clearSession()
  },
}
