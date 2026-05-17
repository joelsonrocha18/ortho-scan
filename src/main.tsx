import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import App from './App'
import './index.css'
import { initMonitoring } from './lib/monitoring'

const MONITORING_ENABLED = Boolean((import.meta.env.VITE_MONITORING_WEBHOOK_URL as string | undefined)?.trim())
const POSTHOG_TOKEN = (import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN as string | undefined)?.trim()
const POSTHOG_HOST = (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined)?.trim()
const POSTHOG_ENABLED = Boolean(POSTHOG_TOKEN && POSTHOG_HOST)

if (MONITORING_ENABLED) {
  initMonitoring()
}

if (POSTHOG_ENABLED) {
  posthog.init(POSTHOG_TOKEN!, {
    api_host: POSTHOG_HOST,
    defaults: '2026-01-30',
    capture_pageview: true,
    loaded: (client) => {
      client.capture('orthoscan_posthog_linked', {
        app: 'orthoscan',
        source: 'app_init',
      })
    },
  })
}

const app = <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {POSTHOG_ENABLED ? <PostHogProvider client={posthog}>{app}</PostHogProvider> : app}
  </StrictMode>,
)
