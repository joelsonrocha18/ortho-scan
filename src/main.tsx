import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { AnalyticsProvider, initAnalytics } from './lib/analytics'
import { initMonitoring } from './lib/monitoring'

initAnalytics()
initMonitoring()

const app = <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalyticsProvider>{app}</AnalyticsProvider>
  </StrictMode>,
)
