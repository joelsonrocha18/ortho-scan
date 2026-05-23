import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../app/ToastProvider'
import { DATA_MODE } from '../../../../data/dataMode'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import { useSupabaseSyncTick } from '../../../../lib/useSupabaseSyncTick'
import { nowIsoDate } from '../../../../shared/utils'
import { LoadExecutiveDashboardUseCase } from '../../application/useCases/LoadExecutiveDashboard'
import { createDashboardRepository } from '../../infra'
import type { ExecutiveDashboardView } from '../../domain/services/ExecutiveDashboardService'

export function useExecutiveDashboardController() {
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const isFirebaseMode = DATA_MODE === 'firebase'
  const isRemoteMode = isSupabaseMode || isFirebaseMode
  const currentUser = useMemo(() => getCurrentUser(db), [db])
  const currentUserKey = `${currentUser?.id ?? ''}::${currentUser?.role ?? ''}::${currentUser?.linkedClinicId ?? ''}::${currentUser?.linkedDentistId ?? ''}`
  const repository = useMemo(() => createDashboardRepository(currentUser), [currentUser])
  const loadExecutiveDashboard = useMemo(() => new LoadExecutiveDashboardUseCase(repository), [repository])
  const [data, setData] = useState<ExecutiveDashboardView | null>(null)
  const [todayKey, setTodayKey] = useState(() => nowIsoDate())
  const supabaseSyncTick = useSupabaseSyncTick()
  const refreshSignature = isRemoteMode
    ? `${todayKey}::${supabaseSyncTick}::${currentUserKey}`
    : `${todayKey}::${db.cases.map((item) => item.updatedAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}::${db.scans.map((item) => item.updatedAt).join('|')}::${db.patients.map((item) => item.updatedAt).join('|')}::${currentUserKey}`

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextToday = nowIsoDate()
      setTodayKey((current) => (current === nextToday ? current : nextToday))
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    void (async () => {
      const result = await loadExecutiveDashboard.execute()
      if (!result.ok) {
        addToast({ type: 'error', title: 'Painel', message: result.error })
        return
      }
      setData(result.data)
    })()
  }, [addToast, loadExecutiveDashboard, refreshSignature])

  return {
    data,
  }
}
