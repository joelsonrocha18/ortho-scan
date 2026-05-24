import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import { DATA_MODE } from '../data/dataMode'
import { useNotifications } from './useNotifications'

const PROMPT_DISMISSED_KEY = 'arrimo_push_prompt_dismissed'

export default function PushNotificationsBridge() {
  const location = useLocation()
  const { addToast } = useToast()
  const notifications = useNotifications()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setDismissed(sessionStorage.getItem(PROMPT_DISMISSED_KEY) === '1')
  }, [])

  const dismissPrompt = () => {
    sessionStorage.setItem(PROMPT_DISMISSED_KEY, '1')
    setDismissed(true)
  }

  const handleEnable = async () => {
    const result = await notifications.subscribeUser()
    if (result.ok) {
      dismissPrompt()
      addToast({
        type: 'success',
        title: 'Notificações ativadas',
        message: 'Alertas ativados neste dispositivo.',
      })
      return
    }

    addToast({
      type: 'error',
      title: 'Não foi possível ativar',
      message: result.error,
    })
  }

  const shouldRenderPrompt =
    DATA_MODE === 'firebase' &&
    notifications.enabled &&
    notifications.permission === 'default' &&
    !notifications.isSubscribed &&
    !dismissed &&
    location.pathname.startsWith('/app/')

  return shouldRenderPrompt ? (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70] w-[calc(100vw-2rem)] max-w-sm">
      <div className="pointer-events-auto rounded-2xl border border-brand-200 bg-white p-4 shadow-[0_22px_60px_-34px_rgba(1,82,125,0.45)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-baby-50 p-2 text-brand-700">
            <Bell className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">Ativar notificações</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void handleEnable()} disabled={notifications.isSyncing}>
                {notifications.isSyncing ? 'Ativando...' : 'Ativar agora'}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissPrompt}>
                Agora não
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null
}
