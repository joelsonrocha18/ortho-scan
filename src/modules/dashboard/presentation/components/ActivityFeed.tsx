import { UserRound } from 'lucide-react'
import Card from '../../../../components/Card'

export type ActivityItem = {
  id: string
  type: 'case_created' | 'case_completed' | 'setup_approved' | 'patient_confirmed' | 'user_login'
  actor: { id: string; name: string; avatar_url?: string }
  target?: { type: string; id: string; name: string }
  timestamp: Date
}

function relativeTime(date: Date) {
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 60) return `há ${minutes} minutos`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} horas`
  return `há ${Math.round(hours / 24)} dias`
}

export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="rounded-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Atividades recentes</h2>
        <button type="button" className="text-sm font-medium text-brand-700 hover:text-brand-600">Ver mais</button>
      </div>
      <div className="space-y-4">
        {items.length === 0 ? <p className="text-sm text-slate-500">Nenhuma atividade recente.</p> : null}
        {items.slice(0, 20).map((item) => (
          <article key={item.id} className="flex gap-3">
            {item.actor.avatar_url ? <img src={item.actor.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-baby-50 text-brand-600"><UserRound className="h-4 w-4" /></span>}
            <div className="min-w-0">
              <p className="text-sm text-slate-700">
                <strong className="text-slate-900">{item.actor.name}</strong>
                {item.target ? ` atualizou ${item.target.name}` : ' acessou o sistema'}
              </p>
              <p className="text-xs text-slate-500">{relativeTime(item.timestamp)}</p>
            </div>
          </article>
        ))}
      </div>
    </Card>
  )
}
