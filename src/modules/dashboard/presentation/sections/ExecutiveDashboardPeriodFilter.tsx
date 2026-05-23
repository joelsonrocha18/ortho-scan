import { CalendarDays } from 'lucide-react'
import type { DashboardDateRange } from '../../application/ports/DashboardRepository'

export type DashboardPeriodKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_12_months'

export type DashboardPeriodOption = {
  key: DashboardPeriodKey
  label: string
  detail: string
  range: DashboardDateRange
}

export function ExecutiveDashboardPeriodFilter(props: {
  options: DashboardPeriodOption[]
  selectedKey: DashboardPeriodKey
  onChange: (key: DashboardPeriodKey) => void
}) {
  const selected = props.options.find((option) => option.key === props.selectedKey) ?? props.options[0]

  return (
    <label className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <CalendarDays className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Periodo</span>
        <select
          value={props.selectedKey}
          onChange={(event) => props.onChange(event.target.value as DashboardPeriodKey)}
          className="mt-0.5 w-full appearance-none bg-transparent text-sm font-semibold text-slate-950 outline-none"
        >
          {props.options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="block truncate text-xs text-slate-500">{selected.detail}</span>
      </span>
    </label>
  )
}
