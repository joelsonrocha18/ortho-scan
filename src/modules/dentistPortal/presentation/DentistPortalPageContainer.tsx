import AppShell from '../../../layouts/AppShell'
import { StrategicNotificationsPanel } from '../../notifications'
import { InternalChatWidget } from '../../../shared/components/InternalChatWidget'
import { useDentistPortalController } from './hooks/useDentistPortalController'
import { DentistPortalApprovalsSection } from './sections/DentistPortalApprovalsSection'
import { DentistPortalCasesSection } from './sections/DentistPortalCasesSection'
import { DentistPortalDocumentsSection } from './sections/DentistPortalDocumentsSection'
import { DentistPortalHeaderSection } from './sections/DentistPortalHeaderSection'

function DentistPortalPageContainer() {
  const controller = useDentistPortalController()

  return (
    <AppShell breadcrumb={['Inicio', 'Portal dentista']}>
      {!controller.data ? null : (
        <div className="space-y-6">
          <DentistPortalHeaderSection
            trackedCases={controller.data.trackedCases.length}
            pendingApprovals={controller.data.pendingApprovals.length}
            documents={controller.data.documents.length}
          />

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <DentistPortalApprovalsSection approvals={controller.data.pendingApprovals} onApprove={controller.approveVersion} />
            <StrategicNotificationsPanel title="Alertas do portal" notifications={controller.data.notifications} emptyLabel="Sem alertas relevantes para o dentista." />
          </section>

          <DentistPortalCasesSection cases={controller.data.trackedCases} />
          <DentistPortalDocumentsSection documents={controller.data.documents} />
          <InternalChatWidget
            currentUserId={controller.currentUser?.id}
            currentUserRole="dentist_client"
            recipientRole="lab_tech"
          />
        </div>
      )}
    </AppShell>
  )
}

export default DentistPortalPageContainer
