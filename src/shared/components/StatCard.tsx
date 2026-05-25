import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type StatCardProps = {
  title: string
  value: number | string
  change?: { value: number; direction: 'up' | 'down' }
  icon?: ReactNode
  color?: 'default' | 'success' | 'warning' | 'danger'
  sparkline?: number[]
  onClick?: () => void
}

const colorClasses: Record<NonNullable<StatCardProps['color']>, string> = {
  default: 'border-slate-200 bg-white text-brand-600',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
}

export default function StatCard({ title, value, change, icon, color = 'default', sparkline, onClick }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        {icon ? <div className={cn('rounded-lg border p-2', colorClasses[color])}>{icon}</div> : null}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        {change ? (
          <span className={cn('inline-flex items-center gap-1 text-sm font-medium', change.direction === 'up' ? 'text-emerald-600' : 'text-rose-600')}>
            {change.direction === 'up' ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {change.value}%
          </span>
        ) : (
          <span className="text-sm text-slate-400">Sem comparação</span>
        )}
        {sparkline && sparkline.length > 1 ? (
          <svg viewBox="0 0 80 28" className="h-7 w-20 text-brand-500" aria-hidden="true">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              points={sparkline
                .map((point, index) => {
                  const max = Math.max(...sparkline)
                  const min = Math.min(...sparkline)
                  const x = (index / (sparkline.length - 1)) * 80
                  const y = 26 - ((point - min) / Math.max(1, max - min)) * 24
                  return `${x},${y}`
                })
                .join(' ')}
            />
          </svg>
        ) : null}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:shadow-md">
        {content}
      </button>
    )
  }

  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">{content}</div>
}
