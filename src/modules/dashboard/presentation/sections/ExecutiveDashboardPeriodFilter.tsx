import { CalendarDays, ChevronDown } from 'lucide-react'
import type { DashboardDateRange } from '../../application/ports/DashboardRepository'

export type DashboardPeriodKey =
  | 'custom'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_12_months'
  | `month_${number}_${number}`

export type DashboardPeriodOption = {
  key: DashboardPeriodKey
  label: string
  detail: string
  range: DashboardDateRange
  group: string
}

export function ExecutiveDashboardPeriodFilter(props: {
  options: DashboardPeriodOption[]
  selectedKey: DashboardPeriodKey
  onChange: (key: DashboardPeriodKey) => void
  selectedRange: DashboardDateRange
  onRangeChange: (range: DashboardDateRange) => void
}) {
  const selected = props.options.find((option) => option.key === props.selectedKey) ?? props.options[0]
  const groups = props.options.reduce<Array<{ label: string; options: DashboardPeriodOption[] }>>((acc, option) => {
    const group = acc.find((item) => item.label === option.group)
    if (group) {
      group.options.push(option)
    } else {
      acc.push({ label: option.group, options: [option] })
    }
    return acc
  }, [])

  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <CalendarDays className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Período</span>
        <span className="relative mt-0.5 block">
          <select
            value={props.selectedKey}
            onChange={(event) => props.onChange(event.target.value as DashboardPeriodKey)}
            className="w-full cursor-pointer appearance-none rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 pr-8 text-sm font-semibold text-slate-950 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100"
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </span>
        <span className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <input
            type="date"
            value={props.selectedRange.startDate}
            onChange={(event) => props.onRangeChange({ ...props.selectedRange, startDate: event.target.value })}
            className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            aria-label="Data inicial"
          />
          <span className="text-xs font-medium text-slate-500">até</span>
          <input
            type="date"
            value={props.selectedRange.endDate}
            onChange={(event) => props.onRangeChange({ ...props.selectedRange, endDate: event.target.value })}
            className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            aria-label="Data final"
          />
        </span>
        <span className="mt-1 block truncate text-xs text-slate-500">{selected.detail}</span>
      </span>
    </div>
  )
}
