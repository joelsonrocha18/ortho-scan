import { captureAnalyticsEvent } from './analytics'
import { sanitizeForLog } from '../shared/observability'

type MonitoringEvent = {
  type: 'error' | 'unhandledrejection'
  message: string
  stack?: string
  url: string
  userAgent: string
  release?: string
  ts: string
}

const explicitEndpoint = (import.meta.env.VITE_MONITORING_ENDPOINT as string | undefined)?.trim()
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const monitoringEnabled = (import.meta.env.VITE_MONITORING_ENABLED as string | undefined)?.trim() === 'true' || Boolean(explicitEndpoint)
const release = (import.meta.env.VITE_RELEASE as string | undefined)?.trim()

function resolveMonitoringEndpoint() {
  if (explicitEndpoint) return explicitEndpoint
  if (!monitoringEnabled || !supabaseUrl) return ''
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/frontend-monitoring`
}

function sanitizeMonitoringEvent(event: MonitoringEvent) {
  return sanitizeForLog(event) as MonitoringEvent
}

function sendMonitoringEvent(event: MonitoringEvent) {
  const payload = sanitizeMonitoringEvent(event)
  captureAnalyticsEvent(payload.type === 'error' ? 'frontend.error' : 'frontend.unhandledrejection', {
    message: payload.message,
    url: payload.url,
    release: payload.release,
    monitoringType: payload.type,
  })

  const endpoint = resolveMonitoringEndpoint()
  if (!endpoint) return

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      app: 'orthoscan',
    }),
    keepalive: true,
  }).catch(() => undefined)
}

export function initMonitoring() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    const payload: MonitoringEvent = {
      type: 'error',
      message: event.message || 'Erro desconhecido',
      stack: event.error?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      release,
      ts: new Date().toISOString(),
    }
    sendMonitoringEvent(payload)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const payload: MonitoringEvent = {
      type: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      release,
      ts: new Date().toISOString(),
    }
    sendMonitoringEvent(payload)
  })
}
