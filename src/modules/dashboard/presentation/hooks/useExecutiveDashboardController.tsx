import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../app/ToastProvider'
import { DATA_MODE } from '../../../../data/dataMode'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
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
  return `${range.startDate.split('-').reverse().join('/')} até ${range.endDate.split('-').reverse().join('/')}`
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

  const option = (key: DashboardPeriodKey, label: string, start: Date, end: Date, group: string): DashboardPeriodOption => {
    const range = { startDate: toIsoDate(start), endDate: toIsoDate(end) }
    return { key, label, detail: formatRange(range), range, group }
  }

  const monthOptions = Array.from({ length: 13 }, (_, index) => {
    const monthDate = new Date(current.getFullYear(), current.getMonth() - 12 + index, 1)
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
    return option(
      `month_${monthDate.getFullYear()}_${monthDate.getMonth()}`,
      `${monthName(monthDate)}/${monthDate.getFullYear()}`,
      monthStart,
      monthEnd,
      String(monthDate.getFullYear()),
    )
  })

  return [
    ...monthOptions,
    option('custom', 'Personalizado', thisMonthStart, thisMonthEnd, 'Atalhos'),
    option('today', 'Hoje', current, current, 'Atalhos'),
    option('yesterday', 'Ontem', yesterday, yesterday, 'Atalhos'),
    option('this_week', 'Esta semana', thisWeekStart, thisWeekEnd, 'Atalhos'),
    option('last_week', 'Semana passada', lastWeekStart, lastWeekEnd, 'Atalhos'),
    option('this_month', `Este mês (${monthName(current)})`, thisMonthStart, thisMonthEnd, 'Atalhos'),
    option('last_month', `Mês anterior (${monthName(lastMonthStart)})`, lastMonthStart, lastMonthEnd, 'Atalhos'),
    option('last_12_months', 'Últimos 12 meses', last12MonthsStart, current, 'Atalhos'),
  ]
}

export function useExecutiveDashboardController() {
  const { db } = useDb()
  const { addToast } = useToast()
  const isFirebaseMode = DATA_MODE === 'firebase'
  const isRemoteMode = isFirebaseMode
  const currentUser = useMemo(() => getCurrentUser(db), [db])
  const currentUserKey = `${currentUser?.id ?? ''}::${currentUser?.role ?? ''}::${currentUser?.linkedClinicId ?? ''}::${currentUser?.linkedDentistId ?? ''}`
  const repository = useMemo(() => createDashboardRepository(currentUser), [currentUser])
  const loadExecutiveDashboard = useMemo(() => new LoadExecutiveDashboardUseCase(repository), [repository])
  const [data, setData] = useState<ExecutiveDashboardView | null>(null)
  const [periodKey, setPeriodKey] = useState<DashboardPeriodKey>('this_month')
  const [customRange, setCustomRange] = useState<DashboardDateRange>(() => {
    const currentMonth = buildPeriodOptions().find((option) => option.key === 'this_month')
    return currentMonth?.range ?? { startDate: nowIsoDate(), endDate: nowIsoDate() }
  })
  const [todayKey, setTodayKey] = useState(() => nowIsoDate())
  const periodOptions = useMemo(() => buildPeriodOptions(new Date(`${todayKey}T00:00:00`)), [todayKey])
  const selectedPeriod = periodKey === 'custom'
    ? {
        key: 'custom' as const,
        label: 'Personalizado',
        detail: formatRange(customRange),
        range: customRange,
        group: 'Atalhos',
      }
    : periodOptions.find((option) => option.key === periodKey) ?? periodOptions.find((option) => option.key === 'this_month') ?? periodOptions[0]
  const periodSignature = `${selectedPeriod.range.startDate}::${selectedPeriod.range.endDate}`
  const refreshSignature = isRemoteMode
    ? `${todayKey}::${periodKey}::${periodSignature}::${currentUserKey}`
    : `${todayKey}::${periodKey}::${periodSignature}::${db.cases.map((item) => item.updatedAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}::${db.scans.map((item) => item.updatedAt).join('|')}::${db.patients.map((item) => item.updatedAt).join('|')}::${currentUserKey}`

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
    selectedRange: selectedPeriod.range,
    setPeriodRange: (range: DashboardDateRange) => {
      setCustomRange(range)
      setPeriodKey('custom')
    },
  }
}
