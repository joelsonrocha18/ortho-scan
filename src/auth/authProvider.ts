import { DATA_MODE } from '../data/dataMode'
import { captureAnalyticsEvent, identifyAnalyticsUser, resetAnalytics } from '../lib/analytics'
import type { AuthProvider } from './session'

let providerPromise: Promise<AuthProvider> | null = null

async function loadAuthProvider(): Promise<AuthProvider> {
  if (!providerPromise) {
    providerPromise = DATA_MODE === 'firebase'
      ? import('./authFirebase').then((module) => module.authFirebase)
      : DATA_MODE === 'supabase'
        ? import('./authSupabase').then((module) => module.authSupabase)
        : import('./authLocal').then((module) => module.authLocal)
  }
  return providerPromise
}

export function getAuthProvider(): AuthProvider {
  return {
    async getCurrentUser() {
      const user = await (await loadAuthProvider()).getCurrentUser()
      identifyAnalyticsUser(user)
      return user
    },
    async signIn(email, password) {
      const provider = await loadAuthProvider()
      await provider.signIn(email, password)
      const user = await provider.getCurrentUser()
      identifyAnalyticsUser(user)
      captureAnalyticsEvent('auth.sign_in_succeeded', {
        role: user?.role,
        clinicId: user?.clinicId,
        dentistId: user?.dentistId,
      })
    },
    async signOut() {
      const provider = await loadAuthProvider()
      const user = await provider.getCurrentUser().catch(() => null)
      captureAnalyticsEvent('auth.sign_out', {
        role: user?.role,
        clinicId: user?.clinicId,
        dentistId: user?.dentistId,
      })
      await provider.signOut()
      resetAnalytics()
    },
  }
}
