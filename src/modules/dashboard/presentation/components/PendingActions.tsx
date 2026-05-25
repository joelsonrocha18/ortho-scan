import { Link } from 'react-router-dom'
import { AlertCircle, Box, CreditCard, ThumbsUp } from 'lucide-react'
import Badge from '../../../../components/Badge'
import Card from '../../../../components/Card'

export type PendingAction = {
  id: string
  type: 'approval_needed' | 'overdue' | 'low_stock' | 'payment_pending'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  action_url: string
  created_at: Date
}

const icons: Record<PendingAction['type'], typeof AlertCircle> = {
  approval_needed: ThumbsUp,
  overdue: AlertCircle,
  low_stock: Box,
  payment_pending: CreditCard,
}

export default function PendingActions({ actions }: { actions: PendingAction[] }) {
  const ordered = [...actions].sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority))

  return (
    <Card className="rounded-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Ações pendentes</h2>
        <Badge tone="info">{actions.length}</Badge>
      </div>
      <div className="space-y-3">
        {ordered.length === 0 ? <p className="text-sm text-slate-500">Nenhuma ação pendente.</p> : null}
        {ordered.map((action) => {
          const Icon = icons[action.type]
          return (
            <Link key={action.id} to={action.action_url} className="flex gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-brand-200 hover:bg-baby-50">
              <Icon className="mt-0.5 h-5 w-5 text-brand-600" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">{action.title}</span>
                <span className="block text-sm text-slate-600">{action.description}</span>
              </span>
              <Badge tone={action.priority === 'high' ? 'danger' : action.priority === 'medium' ? 'info' : 'neutral'}>{action.priority === 'high' ? 'Alta' : action.priority === 'medium' ? 'Média' : 'Baixa'}</Badge>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
