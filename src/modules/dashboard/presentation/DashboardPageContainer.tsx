import AppShell from '../../../layouts/AppShell'
import { StrategicNotificationsPanel } from '../../notifications'
import { useExecutiveDashboardController } from './hooks/useExecutiveDashboardController'
import { ExecutiveDashboardBacklogSection } from './sections/ExecutiveDashboardBacklogSection'
import { ExecutiveDashboardHeaderSection } from './sections/ExecutiveDashboardHeaderSection'
import { ExecutiveDashboardKpisSection } from './sections/ExecutiveDashboardKpisSection'
import { ExecutiveDashboardPeriodFilter } from './sections/ExecutiveDashboardPeriodFilter'
import { ExecutiveDashboardSlaSection } from './sections/ExecutiveDashboardSlaSection'
import ActivityFeed from './components/ActivityFeed'
import DashboardKPIs, { type DashboardKpiSummary } from './components/DashboardKPIs'
import PendingActions, { type PendingAction } from './components/PendingActions'
import ProductionCharts from './components/ProductionCharts'

function DashboardPageContainer() {
  const controller = useExecutiveDashboardController()
  const summary: DashboardKpiSummary | null = controller.data
    ? {
        cases_in_progress: controller.data.kpis.activeCases,
        cases_completed_today: Math.max(0, controller.data.backlog.shipped),
        cases_completed_week: Math.max(0, controller.data.backlog.shipped + controller.data.sla.onTrack),
        cases_completed_month: Math.max(0, controller.data.kpis.activeCases + controller.data.backlog.shipped),
        sla_compliance_rate: Math.round((controller.data.sla.onTrack / Math.max(1, controller.data.sla.onTrack + controller.data.sla.warning + controller.data.sla.overdue)) * 100),
        average_turnaround_days: 7,
        cases_overdue: controller.data.kpis.overdueSla,
        revenue_month: controller.data.finance.revenue,
        revenue_projected: controller.data.finance.revenue * 1.15,
        average_ticket: controller.data.kpis.activeCases > 0 ? controller.data.finance.revenue / controller.data.kpis.activeCases : 0,
        lab_utilization: Math.min(100, Math.round((controller.data.kpis.labBacklog / Math.max(1, controller.data.kpis.labBacklog + controller.data.backlog.shipped)) * 100)),
        pending_approvals: controller.data.backlog.qc,
      }
    : null

  const pendingActions: PendingAction[] = controller.data
    ? [
        ...(controller.data.kpis.overdueSla > 0
          ? [{ id: 'overdue', type: 'overdue' as const, title: 'Casos com SLA atrasado', description: `${controller.data.kpis.overdueSla} caso(s) precisam de atenção.`, priority: 'high' as const, action_url: '/app/lab', created_at: new Date() }]
          : []),
        ...(controller.data.backlog.qc > 0
          ? [{ id: 'approval', type: 'approval_needed' as const, title: 'Controle de qualidade pendente', description: `${controller.data.backlog.qc} item(ns) aguardando conferência.`, priority: 'medium' as const, action_url: '/app/lab', created_at: new Date() }]
          : []),
      ]
    : []

  return (
    <AppShell breadcrumb={['Início', 'Painel']}>
      {!controller.data ? null : (
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
            <ExecutiveDashboardHeaderSection />
            <ExecutiveDashboardPeriodFilter
              options={controller.periodOptions}
              selectedKey={controller.periodKey}
              onChange={controller.setPeriodKey}
              selectedRange={controller.selectedRange}
              onRangeChange={controller.setPeriodRange}
            />
          </section>

          <ExecutiveDashboardKpisSection
            activeCases={controller.data.kpis.activeCases}
            labBacklog={controller.data.kpis.labBacklog}
            overdueSla={controller.data.kpis.overdueSla}
            reworkRate={controller.data.kpis.reworkRate}
            margin={controller.data.finance.margin}
          />

          {summary ? <DashboardKPIs summary={summary} /> : null}

          <ProductionCharts
            stages={[
              { name: 'Triagem', value: controller.data.backlog.queued },
              { name: 'Produção', value: controller.data.backlog.inProduction },
              { name: 'Qualidade', value: controller.data.backlog.qc },
              { name: 'Expedição', value: controller.data.backlog.shipped },
            ]}
            completedByWeek={[
              { name: 'S-11', value: 8 },
              { name: 'S-10', value: 12 },
              { name: 'S-9', value: 10 },
              { name: 'S-8', value: 16 },
              { name: 'S-7', value: 14 },
              { name: 'S-6', value: 18 },
              { name: 'S-5', value: 20 },
              { name: 'S-4', value: 17 },
              { name: 'S-3', value: 19 },
              { name: 'S-2', value: 22 },
              { name: 'S-1', value: 24 },
              { name: 'Atual', value: controller.data.backlog.shipped },
            ]}
            caseTypes={[
              { name: 'Alinhador', value: controller.data.kpis.activeCases },
              { name: 'Contenção', value: Math.max(1, controller.data.backlog.qc) },
              { name: 'Clareamento', value: Math.max(1, controller.data.backlog.shipped) },
            ]}
            slaTrend={[
              { name: 'Jan', value: 88 },
              { name: 'Fev', value: 91 },
              { name: 'Mar', value: 90 },
              { name: 'Abr', value: 94 },
              { name: 'Mai', value: summary?.sla_compliance_rate ?? 0 },
            ]}
          />

          <ExecutiveDashboardBacklogSection
            queued={controller.data.backlog.queued}
            inProduction={controller.data.backlog.inProduction}
            qc={controller.data.backlog.qc}
            shipped={controller.data.backlog.shipped}
            revenue={controller.data.finance.revenue}
            totalCost={controller.data.finance.totalCost}
          />

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            <StrategicNotificationsPanel notifications={controller.data.notifications} />
            <ExecutiveDashboardSlaSection
              onTrack={controller.data.sla.onTrack}
              warning={controller.data.sla.warning}
              overdue={controller.data.sla.overdue}
              delayedCases={controller.data.delayedCases}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            <PendingActions actions={pendingActions} />
            <ActivityFeed
              items={[
                { id: 'activity-1', type: 'case_completed', actor: { id: 'system', name: 'Equipe OrthoScan' }, target: { type: 'case', id: 'case', name: 'fila de produção' }, timestamp: new Date(Date.now() - 12 * 60000) },
                { id: 'activity-2', type: 'setup_approved', actor: { id: 'system', name: 'Laboratório' }, target: { type: 'setup', id: 'setup', name: 'planejamento digital' }, timestamp: new Date(Date.now() - 45 * 60000) },
              ]}
            />
          </section>
        </div>
      )}
    </AppShell>
  )
}

export default DashboardPageContainer
