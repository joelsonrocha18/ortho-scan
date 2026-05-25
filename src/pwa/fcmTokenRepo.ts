import { getFunctions, httpsCallable } from 'firebase/functions'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { firebaseApp } from '../lib/firebaseClient'
import { logger } from '../lib/logger'
import type { SubscribeUserResult } from './types'

const FCM_VAPID_KEY = (import.meta.env.VITE_FCM_VAPID_KEY as string | undefined)?.trim()

type RegisterFcmTokenInput = {
  token: string
  platform: 'web'
}

function getBrowserPlatform(): RegisterFcmTokenInput['platform'] {
  return 'web'
}

export async function registerCurrentUserFcmToken(registration?: ServiceWorkerRegistration | null): Promise<SubscribeUserResult> {
  if (!firebaseApp) return { ok: true }
  if (!FCM_VAPID_KEY) return { ok: true }

  const supported = await isSupported().catch(() => false)
  if (!supported) return { ok: true }

  try {
    const token = await getToken(getMessaging(firebaseApp), {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration ?? undefined,
    })

    if (!token) return { ok: false, error: 'Token FCM nao retornado pelo navegador.' }

    const registerFcmToken = httpsCallable<RegisterFcmTokenInput, { success: boolean }>(
      getFunctions(firebaseApp),
      'registerFcmToken',
    )
    await registerFcmToken({ token, platform: getBrowserPlatform() })
    return { ok: true }
  } catch (error) {
    logger.error('Falha ao registrar token FCM.', { flow: 'fcm.register_token' }, error)
    return { ok: false, error: error instanceof Error ? error.message : 'Falha ao registrar token FCM.' }
  }
}
