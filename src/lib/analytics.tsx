import type { ReactNode } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { DATA_MODE } from '../data/dataMode'
import {
  registerStructuredLogSink,
  sanitizeForLog,
  type StructuredLogRecord,
} from '../shared/observability'
import type { SessionUser } from '../auth/session'

const POSTHOG_TOKEN = (import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN as string | undefined)?.trim()
const POSTHOG_HOST = (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined)?.trim()
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined)?.trim()

export const ANALYTICS_ENABLED = Boolean(POSTHOG_TOKEN && POSTHOG_HOST)

let analyticsInitialized = false
let unregisterStructuredLogSink: (() => void) | null = null
let identifiedUserId: string | null = null

function compactProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function sanitizeAnalyticsProperties(properties: Record<string, unknown>) {
  const sanitized = sanitizeForLog(compactProperties(properties))
  return typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { value: sanitized }
}

function captureStructuredLog(record: StructuredLogRecord) {
  if (record.category !== 'business' && record.level === 'info') return

  captureAnalyticsEvent(record.event, {
    ...record.context,
    logLevel: record.level,
    logCategory: record.category,
    message: record.message,
    env: record.env,
    release: record.release,
    actorRole: record.actor?.role,
    actorClinicId: record.actor?.clinicId,
    actorDentistId: record.actor?.dentistId,
    errorName: record.error?.name,
    errorCode: record.error?.code,
    errorMessage: record.error?.message,
  })
}

export function initAnalytics() {
  if (!ANALYTICS_ENABLED || analyticsInitialized) return

  try {
    posthog.init(POSTHOG_TOKEN!, {
      api_host: POSTHOG_HOST,
      defaults: '2026-01-30',
      capture_pageview: true,
      person_profiles: 'identified_only',
      loaded: () => {
        if (analyticsInitialized) return

        unregisterStructuredLogSink = registerStructuredLogSink(captureStructuredLog)
        analyticsInitialized = true
        captureAnalyticsEvent('orthoscan_posthog_linked', {
          source: 'app_init',
          path: window.location.pathname,
        })
      },
    })
  } catch {
    analyticsInitialized = false
  }
}

export function captureAnalyticsEvent(event: string, properties: Record<string, unknown> = {}) {
  if (!ANALYTICS_ENABLED || !analyticsInitialized || !event.trim()) return
  try {
    posthog.capture(event, sanitizeAnalyticsProperties({
      app: 'orthoscan',
      dataMode: DATA_MODE,
      release: RELEASE,
      ...properties,
    }))
  } catch {
    return
  }
}

export function identifyAnalyticsUser(user: SessionUser | null | undefined) {
  if (!ANALYTICS_ENABLED || !analyticsInitialized || !user?.id) return
  if (identifiedUserId === user.id) return
  try {
    posthog.identify(user.id, sanitizeAnalyticsProperties({
      role: user.role,
      clinicId: user.clinicId,
      dentistId: user.dentistId,
      dataMode: DATA_MODE,
      release: RELEASE,
    }))
    identifiedUserId = user.id
  } catch {
    return
  }
}

export function resetAnalytics() {
  if (!ANALYTICS_ENABLED || !analyticsInitialized) return
  try {
    posthog.reset()
    identifiedUserId = null
  } catch {
    return
  }
}

export function disposeAnalytics() {
  unregisterStructuredLogSink?.()
  unregisterStructuredLogSink = null
  analyticsInitialized = false
  identifiedUserId = null
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return ANALYTICS_ENABLED ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : children
}
