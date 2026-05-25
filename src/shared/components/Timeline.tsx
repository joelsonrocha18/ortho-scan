import type { ReactNode } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { Clock } from 'lucide-react'
import { cn } from '../../lib/cn'

export type TimelineItem = {
  id: string
  date: Timestamp | Date | string
  title: string
  description?: string
  icon?: ReactNode
  color?: string
  actor?: { name: string; avatar_url?: string }
  attachments?: string[]
}

type TimelineProps = {
  items: TimelineItem[]
  orientation?: 'vertical' | 'horizontal'
  showConnectors?: boolean
}

function formatDate(date: TimelineItem['date']) {
  if (typeof date === 'string') return date
  const value = date instanceof Date ? date : date.toDate()
  return value.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function Timeline({ items, orientation = 'vertical', showConnectors = true }: TimelineProps) {
  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nenhum evento registrado.</div>
  }

  return (
    <ol className={cn('gap-4', orientation === 'horizontal' ? 'grid overflow-x-auto md:grid-flow-col md:auto-cols-fr' : 'space-y-4')}>
      {items.map((item, index) => (
        <li key={item.id} className={cn('relative', orientation === 'vertical' && 'pl-10')}>
          {orientation === 'vertical' && showConnectors && index < items.length - 1 ? <span className="absolute left-4 top-8 h-full w-px bg-slate-200" aria-hidden="true" /> : null}
          <span
            className={cn('absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-4 ring-white', item.color)}
            aria-hidden="true"
          >
            {item.icon ?? <Clock className="h-4 w-4" />}
          </span>
          <article className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{item.title}</h3>
              <time className="text-xs text-slate-500">{formatDate(item.date)}</time>
            </div>
            {item.description ? <p className="mt-1 text-sm text-slate-600">{item.description}</p> : null}
            {item.actor ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                {item.actor.avatar_url ? <img src={item.actor.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
                <span>{item.actor.name}</span>
              </div>
            ) : null}
            {item.attachments && item.attachments.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.attachments.map((attachment) => (
                  <img key={attachment} src={attachment} alt="" loading="lazy" className="h-16 w-16 rounded-md object-cover" />
                ))}
              </div>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  )
}
