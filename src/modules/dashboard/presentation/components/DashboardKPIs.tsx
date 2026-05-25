import { AlertTriangle, CheckCircle2, Clock, DollarSign, Factory, TrendingUp } from 'lucide-react'
import StatCard from '../../../../shared/components/StatCard'

export type DashboardKpiSummary = {
  cases_in_progress: number
  cases_completed_today: number
  cases_completed_week: number
  cases_completed_month: number
  sla_compliance_rate: number
  average_turnaround_days: number
  cases_overdue: number
  revenue_month: number
  revenue_projected: number
  average_ticket: number
  lab_utilization: number
  pending_approvals: number
}

type DashboardKPIsProps = {
  summary: DashboardKpiSummary
  onFilter?: (filter: string) => void
}

function currency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function DashboardKPIs({ summary, onFilter }: DashboardKPIsProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="KPIs executivos">
      <StatCard title="Casos em andamento" value={summary.cases_in_progress} icon={<Factory className="h-5 w-5" />} sparkline={[12, 16, 14, summary.cases_in_progress]} onClick={() => onFilter?.('in_progress')} />
      <StatCard title="SLA em dia" value={`${summary.sla_compliance_rate}%`} color="success" icon={<CheckCircle2 className="h-5 w-5" />} change={{ value: 4, direction: 'up' }} onClick={() => onFilter?.('sla')} />
      <StatCard title="Atrasados" value={summary.cases_overdue} color={summary.cases_overdue > 0 ? 'danger' : 'success'} icon={<AlertTriangle className="h-5 w-5" />} onClick={() => onFilter?.('overdue')} />
      <StatCard title="Receita mensal" value={currency(summary.revenue_month)} icon={<DollarSign className="h-5 w-5" />} change={{ value: 9, direction: 'up' }} />
      <StatCard title="Concluídos hoje" value={summary.cases_completed_today} icon={<TrendingUp className="h-5 w-5" />} />
      <StatCard title="Concluídos na semana" value={summary.cases_completed_week} />
      <StatCard title="Aprovações pendentes" value={summary.pending_approvals} color="warning" icon={<Clock className="h-5 w-5" />} />
      <StatCard title="Utilização do lab" value={`${summary.lab_utilization}%`} sparkline={[62, 70, 68, summary.lab_utilization]} />
    </section>
  )
}
