import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DATA_MODE } from '../data/dataMode'
import { logger } from '../lib/logger'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebaseClient'
import { registerCurrentUserFcmToken } from './fcmTokenRepo'
import { clearCurrentPushSubscription, getCurrentBrowserPushSubscription, upsertCurrentUserPushSubscription } from './pushSubscriptionRepo'
import { getBrowserPushPermission, isWebPushSupported, urlBase64ToUint8Array } from './pushUtils'
import { ensureServiceWorkerRegistered } from './registerServiceWorker'
import type { NotificationBridgeMessage, PushPermissionState, SubscribeUserResult } from './types'

const WEB_PUSH_PUBLIC_KEY = (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined)?.trim()
const WEB_PUSH_ENABLED = ((import.meta.env.VITE_WEB_PUSH_ENABLED as string | undefined)?.trim().toLowerCase() ?? '') === 'true'

function createNotificationAudio() {
  const audio = new Audio('/notification.mp3')
  audio.preload = 'auto'
  return audio
}

function playFallbackBeep() {
  if (typeof window === 'undefined') return
  const legacyAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  const AudioContextCtor = window.AudioContext ?? legacyAudioContext
  if (!AudioContextCtor) return
  const audioContext = new AudioContextCtor()
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.value = 880
  gainNode.gain.value = 0.04

  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + 0.12)

  oscillator.onended = () => {
    void audioContext.close().catch(() => undefined)
  }
}

export function useNotifications() {
  const supported = useMemo(() => isWebPushSupported(), [])
  const hasPublicKey = Boolean(WEB_PUSH_PUBLIC_KEY)
  const enabled = supported && hasPublicKey && WEB_PUSH_ENABLED
  const [permission, setPermission] = useState<PushPermissionState>(getBrowserPushPermission())
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioPrimedRef = useRef(false)

  const refreshSubscriptionState = useCallback(async () => {
    if (!enabled) {
      setIsSubscribed(false)
      return null
    }

    const registration = await ensureServiceWorkerRegistered()
    const subscription = await registration?.pushManager.getSubscription().catch(() => null)
    setIsSubscribed(Boolean(subscription))
    return subscription ?? null
  }, [enabled])

  const primeAudio = useCallback(() => {
    if (!enabled || audioPrimedRef.current) return
    audioPrimedRef.current = true
    const audio = audioRef.current ?? createNotificationAudio()
    audioRef.current = audio
    audio.muted = true
    void audio.play().catch(() => {
      // iOS/Android ainda podem bloquear autoplay aqui; a reprodução em primeiro plano trata a alternativa.
    }).finally(() => {
      audio.pause()
      audio.currentTime = 0
      audio.muted = false
    })
  }, [enabled])

  const playForegroundSound = useCallback(async () => {
    if (!enabled || typeof document === 'undefined' || document.visibilityState !== 'visible') return

    const audio = audioRef.current ?? createNotificationAudio()
    audioRef.current = audio
    audio.currentTime = 0

    try {
      await audio.play()
    } catch (playError) {
      logger.warn('Falha ao tocar notification.mp3 em primeiro plano. Aplicando som alternativo.', {
        flow: 'pwa.push.play_sound',
        reason: playError instanceof Error ? playError.message : String(playError),
      })
      playFallbackBeep()
    }
  }, [enabled])

  const subscribeUser = useCallback(async (options?: { silent?: boolean }): Promise<SubscribeUserResult> => {
    setError(null)

    if (!enabled) {
      const message = 'Este navegador não suporta notificações push.'
      setPermission('unsupported')
      setError(message)
      return { ok: false, error: message }
    }

    const resolvedPermission = options?.silent ? Notification.permission : await Notification.requestPermission()
    setPermission(resolvedPermission)

    if (resolvedPermission !== 'granted') {
      const message = resolvedPermission === 'denied'
        ? 'As notificações foram bloqueadas neste navegador.'
        : 'A permissão de notificação ainda não foi concedida.'
      setIsSubscribed(false)
      if (!options?.silent) {
        setError(message)
      }
      return { ok: false, error: message }
    }

    if (!hasPublicKey) {
      const message = 'VITE_WEB_PUSH_PUBLIC_KEY ausente. Configure a chave VAPID pública no build.'
      setError(message)
      return { ok: false, error: message }
    }

    const vapidPublicKey = WEB_PUSH_PUBLIC_KEY as string

    if (DATA_MODE !== 'firebase' || !auth) {
      const message = 'As notificações push exigem modo Firebase e usuário autenticado.'
      setError(message)
      return { ok: false, error: message }
    }

    const user = auth.currentUser
    if (!user) {
      const message = 'Usuário autenticado não encontrado para vincular a subscription.'
      setError(message)
      return { ok: false, error: message }
    }

    setIsSyncing(true)
    try {
      const registration = await ensureServiceWorkerRegistered()
      if (!registration) {
        const message = 'Service worker não disponível para registrar notificações.'
        setError(message)
        return { ok: false, error: message }
      }

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        })
      }

      const result = await upsertCurrentUserPushSubscription(subscription)
      if (!result.ok) {
        setError(result.error)
        setIsSubscribed(false)
        return result
      }

      const fcmResult = await registerCurrentUserFcmToken(registration)
      if (!fcmResult.ok) {
        setError(fcmResult.error)
        return fcmResult
      }

      setIsSubscribed(true)
      return { ok: true }
    } catch (subscriptionError) {
      const message = subscriptionError instanceof Error ? subscriptionError.message : 'Falha ao registrar notificações push.'
      logger.error('Falha ao assinar notificações push.', { flow: 'pwa.push.subscribe' }, subscriptionError)
      setError(message)
      setIsSubscribed(false)
      return { ok: false, error: message }
    } finally {
      setIsSyncing(false)
    }
  }, [enabled, hasPublicKey])

  const unsubscribeUser = useCallback(async (): Promise<SubscribeUserResult> => {
    setError(null)
    setIsSyncing(true)
    try {
      const result = await clearCurrentPushSubscription()
      if (!result.ok) {
        setError(result.error)
        return result
      }
      setIsSubscribed(false)
      return { ok: true }
    } finally {
      setIsSyncing(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void ensureServiceWorkerRegistered()
    void refreshSubscriptionState()
  }, [enabled, refreshSubscriptionState])

  useEffect(() => {
    if (!enabled) return

    const syncPermissionState = () => {
      setPermission(getBrowserPushPermission())
      void refreshSubscriptionState()
    }

    window.addEventListener('focus', syncPermissionState)
    document.addEventListener('visibilitychange', syncPermissionState)

    return () => {
      window.removeEventListener('focus', syncPermissionState)
      document.removeEventListener('visibilitychange', syncPermissionState)
    }
  }, [enabled, refreshSubscriptionState])

  useEffect(() => {
    if (!enabled) return

    const options: AddEventListenerOptions = { once: true, capture: true }
    window.addEventListener('pointerdown', primeAudio, options)
    window.addEventListener('keydown', primeAudio, options)

    return () => {
      window.removeEventListener('pointerdown', primeAudio, options)
      window.removeEventListener('keydown', primeAudio, options)
    }
  }, [enabled, primeAudio])

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.serviceWorker) return

    const handleServiceWorkerMessage = (event: MessageEvent<NotificationBridgeMessage>) => {
      if (event.data?.type === 'arrimo.push.received') {
        void playForegroundSound()
        return
      }

      if (event.data?.type === 'arrimo.push.subscriptionchange' && permission === 'granted') {
        void subscribeUser({ silent: true })
      }
    }

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage as EventListener)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage as EventListener)
    }
  }, [enabled, permission, playForegroundSound, subscribeUser])

  useEffect(() => {
    if (DATA_MODE !== 'firebase' || !auth || !enabled) return

    void refreshSubscriptionState()

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setPermission(getBrowserPushPermission())
      if (!user) {
        void getCurrentBrowserPushSubscription().then((subscription) => {
          setIsSubscribed(Boolean(subscription))
        })
        return
      }
      if (Notification.permission === 'granted') {
        void subscribeUser({ silent: true })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [enabled, refreshSubscriptionState, subscribeUser])

  return {
    enabled,
    supported,
    hasPublicKey,
    permission,
    isSubscribed,
    isSyncing,
    error,
    subscribeUser,
    unsubscribeUser,
  }
}
