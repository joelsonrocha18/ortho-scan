import AppShell from '../../../layouts/AppShell'
import { StrategicNotificationsPanel } from '../../notifications'
import { useExecutiveDashboardController } from './hooks/useExecutiveDashboardController'
import { ExecutiveDashboardBacklogSection } from './sections/ExecutiveDashboardBacklogSection'
import { ExecutiveDashboardHeaderSection } from './sections/ExecutiveDashboardHeaderSection'
import { ExecutiveDashboardKpisSection } from './sections/ExecutiveDashboardKpisSection'
import { ExecutiveDashboardPeriodFilter } from './sections/ExecutiveDashboardPeriodFilter'
import { ExecutiveDashboardSlaSection } from './sections/ExecutiveDashboardSlaSection'

function DashboardPageContainer() {
  const controller = useExecutiveDashboardController()

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
            />
          </section>

          <ExecutiveDashboardKpisSection
            activeCases={controller.data.kpis.activeCases}
            labBacklog={controller.data.kpis.labBacklog}
            overdueSla={controller.data.kpis.overdueSla}
            reworkRate={controller.data.kpis.reworkRate}
            margin={controller.data.finance.margin}
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
        </div>
      )}
    </AppShell>
  )
}

export default DashboardPageContainer
