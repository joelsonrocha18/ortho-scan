import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../app/ToastProvider'
import { DATA_MODE } from '../../../../data/dataMode'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import { useSupabaseSyncTick } from '../../../../lib/useSupabaseSyncTick'
import { nowIsoDate } from '../../../../shared/utils'
import { LoadExecutiveDashboardUseCase } from '../../application/useCases/LoadExecutiveDashboard'
import { createDashboardRepository } from '../../infra'
import type { DashboardDateRange } from '../../application/ports/DashboardRepository'
import type { ExecutiveDashboardView } from '../../domain/services/ExecutiveDashboardService'
import type { DashboardPeriodKey, DashboardPeriodOption } from '../sections/ExecutiveDashboardPeriodFilter'

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfLocalWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  next.setHours(0, 0, 0, 0)
  return next
}

function monthName(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (letter) => letter.toUpperCase())
}

function formatRange(range: DashboardDateRange) {
  return `${range.startDate.split('-').reverse().join('/')} a ${range.endDate.split('-').reverse().join('/')}`
}

function buildPeriodOptions(today = new Date()): DashboardPeriodOption[] {
  const current = new Date(today)
  current.setHours(0, 0, 0, 0)
  const yesterday = new Date(current)
  yesterday.setDate(current.getDate() - 1)

  const thisWeekStart = startOfLocalWeek(current)
  const thisWeekEnd = new Date(thisWeekStart)
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6)

  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(thisWeekStart.getDate() - 7)
  const lastWeekEnd = new Date(thisWeekStart)
  lastWeekEnd.setDate(thisWeekStart.getDate() - 1)

  const thisMonthStart = new Date(current.getFullYear(), current.getMonth(), 1)
  const thisMonthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0)
  const lastMonthStart = new Date(current.getFullYear(), current.getMonth() - 1, 1)
  const lastMonthEnd = new Date(current.getFullYear(), current.getMonth(), 0)
  const last12MonthsStart = new Date(current.getFullYear(), current.getMonth() - 11, 1)

  const option = (key: DashboardPeriodKey, label: string, start: Date, end: Date): DashboardPeriodOption => {
    const range = { startDate: toIsoDate(start), endDate: toIsoDate(end) }
    return { key, label, detail: formatRange(range), range }
  }

  return [
    option('today', 'Hoje', current, current),
    option('yesterday', 'Ontem', yesterday, yesterday),
    option('this_week', 'Esta semana', thisWeekStart, thisWeekEnd),
    option('last_week', 'Semana passada', lastWeekStart, lastWeekEnd),
    option('this_month', `Este mes (${monthName(current)})`, thisMonthStart, thisMonthEnd),
    option('last_month', `Mes anterior (${monthName(lastMonthStart)})`, lastMonthStart, lastMonthEnd),
    option('last_12_months', 'Ultimos 12 meses', last12MonthsStart, current),
  ]
}

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
  const [periodKey, setPeriodKey] = useState<DashboardPeriodKey>('this_month')
  const [todayKey, setTodayKey] = useState(() => nowIsoDate())
  const periodOptions = useMemo(() => buildPeriodOptions(new Date(`${todayKey}T00:00:00`)), [todayKey])
  const selectedPeriod = periodOptions.find((option) => option.key === periodKey) ?? periodOptions[4]
  const supabaseSyncTick = useSupabaseSyncTick()
  const refreshSignature = isRemoteMode
    ? `${todayKey}::${periodKey}::${supabaseSyncTick}::${currentUserKey}`
    : `${todayKey}::${periodKey}::${db.cases.map((item) => item.updatedAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}::${db.scans.map((item) => item.updatedAt).join('|')}::${db.patients.map((item) => item.updatedAt).join('|')}::${currentUserKey}`

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextToday = nowIsoDate()
      setTodayKey((current) => (current === nextToday ? current : nextToday))
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    void (async () => {
      const result = await loadExecutiveDashboard.execute(selectedPeriod.range)
      if (!result.ok) {
        addToast({ type: 'error', title: 'Painel', message: result.error })
        return
      }
      setData(result.data)
    })()
  }, [addToast, loadExecutiveDashboard, refreshSignature, selectedPeriod.range])

  return {
    data,
    periodKey,
    periodOptions,
    setPeriodKey,
  }
}
