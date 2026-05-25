import type { Permission } from './permissions'

export type SessionUser = {
  id: string
  email?: string
  role: string
  permissions?: Permission[]
  clinicId?: string
  dentistId?: string
}

export type SocialAuthProvider = 'google' | 'apple'

export interface AuthProvider {
  getCurrentUser(): Promise<SessionUser | null>
  signIn(email: string, password: string): Promise<void>
  signInWithProvider(provider: SocialAuthProvider): Promise<void>
  signOut(): Promise<void>
}
