import {
  browserSessionPersistence,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User as FirebaseAuthUser,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../lib/firebaseClient'
import { clearSession, setSessionProfile } from '../lib/auth'
import { logger } from '../lib/logger'
import { clearCurrentPushSubscription } from '../pwa/pushSubscriptionRepo'
import { createUnauthorizedError } from '../shared/errors'
import { validateSignInInput } from '../shared/validators'
import type { AuthProvider, SessionUser, SocialAuthProvider } from './session'

type FirebaseProfileRecord = {
  role?: string
  clinicId?: string | null
  clinic_id?: string | null
  dentistId?: string | null
  dentist_id?: string | null
  loginEmail?: string | null
  login_email?: string | null
  email?: string | null
  isActive?: boolean
  is_active?: boolean
  deletedAt?: string | null
  deleted_at?: string | null
}

let authStateReady: Promise<FirebaseAuthUser | null> | null = null
let authObserverStarted = false

function firebaseNotConfiguredError() {
  return new Error('Firebase nao configurado. Configure VITE_FIREBASE_* antes de usar este modo.')
}

function buildSession(userId: string, fallbackEmail: string | null | undefined, profile?: FirebaseProfileRecord): SessionUser | null {
  const isActive = profile?.isActive ?? profile?.is_active ?? true
  const deletedAt = profile?.deletedAt ?? profile?.deleted_at ?? null
  if (!isActive || deletedAt) return null

  return {
    id: userId,
    email: profile?.loginEmail ?? profile?.login_email ?? profile?.email ?? fallbackEmail ?? undefined,
    role: profile?.role ?? 'dentist_client',
    clinicId: profile?.clinicId ?? profile?.clinic_id ?? undefined,
    dentistId: profile?.dentistId ?? profile?.dentist_id ?? undefined,
  }
}

async function loadFirebaseProfile(userId: string) {
  if (!db) return undefined
  const snapshot = await getDoc(doc(db, 'profiles', userId))
  return snapshot.exists() ? (snapshot.data() as FirebaseProfileRecord) : undefined
}

function ensureFirebaseAuthObserver() {
  if (!auth) return Promise.resolve(null)
  const firebaseAuth = auth
  if (authObserverStarted) return authStateReady ?? Promise.resolve(auth.currentUser)

  authObserverStarted = true
  authStateReady = new Promise<FirebaseAuthUser | null>((resolve) => {
    let initialResolved = false

    onAuthStateChanged(firebaseAuth, (user) => {
      if (!initialResolved) {
        initialResolved = true
        resolve(user)
      }

      void (async () => {
        if (!user) {
          clearSession()
          return
        }

        try {
          const profile = await loadFirebaseProfile(user.uid)
          const session = buildSession(user.uid, user.email, profile)
          if (session) {
            setSessionProfile(session)
          } else {
            clearSession()
          }
        } catch (error) {
          clearSession()
          logger.error('Falha ao sincronizar estado Firebase Auth.', { flow: 'auth.firebase.state_changed' }, error)
        }
      })()
    })
  })

  return authStateReady
}

async function resolveCurrentSession(): Promise<SessionUser | null> {
  if (!auth) return null
  const user = auth.currentUser ?? await ensureFirebaseAuthObserver()
  if (!user) return null
  const profile = await loadFirebaseProfile(user.uid)
  const session = buildSession(user.uid, user.email, profile)
  if (session) setSessionProfile(session)
  return session
}

function createFirebaseSocialProvider(provider: SocialAuthProvider) {
  if (provider === 'google') {
    const googleProvider = new GoogleAuthProvider()
    googleProvider.setCustomParameters({ prompt: 'select_account' })
    googleProvider.addScope('profile')
    googleProvider.addScope('email')
    return googleProvider
  }
  const appleProvider = new OAuthProvider('apple.com')
  appleProvider.addScope('email')
  appleProvider.addScope('name')
  return appleProvider
}

function isSocialPopupFallbackError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string' &&
    ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/operation-not-supported-in-this-environment', 'auth/interaction-not-supported'].includes((error as { code: string }).code)
}

async function signInWithFirebaseProvider(provider: SocialAuthProvider) {
  if (!auth) throw firebaseNotConfiguredError()
  const firebaseProvider = createFirebaseSocialProvider(provider)

  try {
    return await signInWithPopup(auth, firebaseProvider)
  } catch (error) {
    if (isSocialPopupFallbackError(error)) {
      logger.warn('Popup social login bloqueado; usando redirect.', {
        flow: 'auth.firebase.social_sign_in.fallback',
        provider,
        errorCode: (error as { code: string }).code,
      })
      await signInWithRedirect(auth, firebaseProvider)
      return null
    }
    throw error
  }
}

export const authFirebase: AuthProvider & {
  sendPasswordReset(email: string): Promise<void>
} = {
  async getCurrentUser(): Promise<SessionUser | null> {
    try {
      return await resolveCurrentSession()
    } catch (error) {
      logger.error('Falha ao carregar sessao Firebase.', { flow: 'auth.firebase.get_current_user' }, error)
      return null
    }
  },

  async signIn(email: string, password: string) {
    const credentials = validateSignInInput({ email, password })
    if (!auth) throw firebaseNotConfiguredError()

    try {
      await setPersistence(auth, browserSessionPersistence)
      const credential = await signInWithEmailAndPassword(auth, credentials.email, credentials.password)
      const profile = await loadFirebaseProfile(credential.user.uid)
      const session = buildSession(credential.user.uid, credential.user.email, profile)
      if (!session) {
        await firebaseSignOut(auth)
        clearSession()
        throw createUnauthorizedError('Usuario inativo ou sem permissao de acesso.')
      }
      setSessionProfile(session)
      logger.info('Autenticacao Firebase concluida.', {
        flow: 'auth.firebase.sign_in',
        userId: session.id,
        role: session.role,
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        logger.warn('Falha de autenticacao Firebase.', {
          flow: 'auth.firebase.sign_in',
          email: credentials.email,
          code: String(error.code),
        })
      }
      throw error instanceof Error ? createUnauthorizedError(error.message) : createUnauthorizedError('Falha de autenticacao Firebase.')
    }
  },

  async signInWithProvider(provider: SocialAuthProvider) {
    if (!auth) throw firebaseNotConfiguredError()

    try {
      await setPersistence(auth, browserSessionPersistence)
      const credential = await signInWithFirebaseProvider(provider)
      if (!credential) return
      const profile = await loadFirebaseProfile(credential.user.uid)
      const session = profile ? buildSession(credential.user.uid, credential.user.email, profile) : null
      if (!session) {
        await firebaseSignOut(auth)
        clearSession()
        throw createUnauthorizedError('Conta social sem perfil autorizado no sistema.')
      }
      setSessionProfile(session)
      logger.info('Autenticacao social Firebase concluida.', {
        flow: 'auth.firebase.social_sign_in',
        provider,
        userId: session.id,
        role: session.role,
      })
    } catch (error) {
      throw error instanceof Error ? createUnauthorizedError(error.message) : createUnauthorizedError('Falha de autenticacao social Firebase.')
    }
  },

  async signOut() {
    if (!auth) return
    try {
      await clearCurrentPushSubscription()
    } catch (error) {
      logger.warn('Falha ao limpar notificacoes push durante o logout Firebase.', {
        flow: 'auth.firebase.sign_out.push_cleanup',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    await firebaseSignOut(auth)
    clearSession()
  },

  async sendPasswordReset(email: string) {
    if (!auth) throw firebaseNotConfiguredError()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) throw new Error('Email obrigatorio.')
    await sendPasswordResetEmail(auth, normalizedEmail)
    logger.info('Recuperacao de senha Firebase solicitada.', {
      flow: 'auth.firebase.password_reset',
      email: normalizedEmail,
    })
  },
}
