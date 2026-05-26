import { useEffect, useState } from 'react'

export function useRemoteSyncTick(intervalMs = 15000) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const refresh = () => setTick((current) => current + 1)
    const timer = window.setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [intervalMs])

  return tick
}
