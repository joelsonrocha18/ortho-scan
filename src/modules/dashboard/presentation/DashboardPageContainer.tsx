import AppShell from '../../../layouts/AppShell'
import { StrategicNotificationsPanel } from '../../notifications'
import { useExecutiveDashboardController } from './hooks/useExecutiveDashboardController'
import { ExecutiveDashboardBacklogSection } from './sections/ExecutiveDashboardBacklogSection'
import { ExecutiveDashboardHeaderSection } from './sections/ExecutiveDashboardHeaderSection'
import { ExecutiveDashboardKpisSection } from './sections/ExecutiveDashboardKpisSection'
import { ExecutiveDashboardSlaSection } from './sections/ExecutiveDashboardSlaSection'

function DashboardPageContainer() {
  const controller = useExecutiveDashboardController()

  return (
    <AppShell breadcrumb={['Início', 'Painel']}>
      {!controller.data ? null : (
        <div className="space-y-6">
          <ExecutiveDashboardHeaderSection
            activeCases={controller.data.kpis.activeCases}
            overdueSla={controller.data.kpis.overdueSla}
            reworkRate={controller.data.kpis.reworkRate}
          />

          <ExecutiveDashboardKpisSection
            activeCases={controller.data.kpis.activeCases}
            labBacklog={controller.data.kpis.labBacklog}
            overdueSla={controller.data.kpis.overdueSla}
            reworkRate={controller.data.kpis.reworkRate}
            margin={controller.data.finance.margin}
          />

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <ExecutiveDashboardSlaSection
              onTrack={controller.data.sla.onTrack}
              warning={controller.data.sla.warning}
              overdue={controller.data.sla.overdue}
              delayedCases={controller.data.delayedCases}
            />
            <StrategicNotificationsPanel notifications={controller.data.notifications} />
          </section>

          <ExecutiveDashboardBacklogSection
            queued={controller.data.backlog.queued}
            inProduction={controller.data.backlog.inProduction}
            qc={controller.data.backlog.qc}
            shipped={controller.data.backlog.shipped}
            revenue={controller.data.finance.revenue}
            totalCost={controller.data.finance.totalCost}
          />
        </div>
      )}
    </AppShell>
  )
}

export default DashboardPageContainer
