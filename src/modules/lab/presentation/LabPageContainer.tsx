import RegisterDeliveryLotModal from '../../../components/cases/RegisterDeliveryLotModal'
import LabFilters from '../../../components/lab/LabFilters'
import LabItemModal from '../../../components/lab/LabItemModal'
import LabKpiRow from '../../../components/lab/LabKpiRow'
import AppShell from '../../../layouts/AppShell'
import { LabAdvanceModal } from './modals/LabAdvanceModal'
import { LabProductionConfirmModal } from './modals/LabProductionConfirmModal'
import { useLabPageController } from './hooks/useLabPageController'
import { LabPageHeaderSection } from './sections/LabPageHeaderSection'
import { LabAlertsSection } from './sections/LabAlertsSection'
import { LabBoardSection } from './sections/LabBoardSection'

function LabPageContainer() {
  const controller = useLabPageController()

  return (
    <AppShell breadcrumb={['Início', 'Laboratório']}>
      <LabPageHeaderSection
        canWrite={controller.canWrite}
        exportingPatientReport={controller.exportingPatientReport}
        preferredBrotherPrinter={controller.preferredBrotherPrinter}
        onConfigurePrinter={controller.handleConfigureBrotherPrinter}
        onExportPatientReport={() => void controller.handleExportPatientReport()}
        onOpenDelivery={() => controller.setDeliveryOpen(true)}
      />

      <section className="mt-6">
        <LabFilters
          search={controller.search}
          priority={controller.priority}
          overdueOnly={controller.overdueOnly}
          alertsOnly={controller.alertsOnly}
          status={controller.status}
          origin={controller.originFilter}
          onSearchChange={controller.setSearch}
          onPriorityChange={controller.setPriority}
          onOverdueOnlyChange={controller.setOverdueOnly}
          onAlertsOnlyChange={controller.setAlertsOnly}
          onStatusChange={controller.setStatus}
          onOriginChange={controller.setOriginFilter}
        />
      </section>

      <section className="mt-6">
        <LabKpiRow kpis={controller.kpis} />
      </section>

      <LabAlertsSection alertsOnly={controller.alertsOnly} alertSummaries={controller.alertSummaries} />

      <LabBoardSection
        boardTab={controller.boardTab}
        pipelineItems={controller.pipelineItems}
        reworkItems={controller.reworkItems}
        remainingBankItems={controller.remainingBankItems}
        caseById={controller.caseById}
        guideAutomationLeadDays={controller.guideAutomationLeadDays}
        canWrite={controller.canWrite}
        onBoardTabChange={controller.setBoardTab}
        onRefresh={() => void controller.refreshOverview()}
        onOpenDetails={(item) => controller.setModal({ open: true, mode: 'edit', item })}
        onPrintLabel={controller.handlePrintSticker}
        onMoveStatus={controller.handleMoveStatus}
        onAdvanceRequest={controller.handleAdvanceRequest}
        resolveOrderProductLabel={controller.resolveOrderProductLabel}
      />

      <LabItemModal
        mode={controller.modal.mode}
        item={controller.modal.item}
        open={controller.modal.open}
        cases={controller.cases}
        patientOptions={controller.patientOptions}
        readOnly={!controller.canWrite}
        onClose={() => controller.setModal({ open: false, mode: 'create', item: null })}
        onCreate={controller.handleCreate}
        onSave={controller.handleSave}
        onDelete={controller.handleDelete}
        onReprintGuide={controller.handleReprintGuide}
        reprintGuideLabel={controller.modal.open && controller.modal.mode === 'edit' && controller.modal.item ? controller.getGuideReprintLabel(controller.modal.item) : undefined}
        allowDelete={controller.canDeleteLab}
      />

      <RegisterDeliveryLotModal
        open={controller.deliveryOpen}
        caseOptions={controller.deliveryCaseOptions}
        selectedCaseId={controller.deliveryCaseId}
        isSelectedRework={controller.selectedDeliveryIsRework}
        selectedProductLabel={controller.selectedDeliveryProductLabel}
        selectedArch={controller.selectedDeliveryItem?.arch ?? ''}
        requiresArchQuantities={controller.selectedDeliveryRequiresArchQuantities}
        initialUpperQty={controller.deliveryInitialUpperQty}
        initialLowerQty={controller.deliveryInitialLowerQty}
        onCaseChange={controller.setDeliveryCaseId}
        onClose={() => controller.setDeliveryOpen(false)}
        onConfirm={controller.handleRegisterShipment}
      />

      <LabProductionConfirmModal
        open={controller.productionConfirm.open}
        productLabel={controller.productionConfirm.productLabel}
        archLabel={controller.productionConfirm.archLabel}
        onCancel={() => controller.resolveProductionConfirmation(false)}
        onConfirm={() => controller.resolveProductionConfirmation(true)}
      />

      <LabAdvanceModal
        open={controller.advanceModalOpen}
        target={controller.advanceTarget}
        upperQty={controller.advanceUpperQty}
        lowerQty={controller.advanceLowerQty}
        onUpperQtyChange={controller.setAdvanceUpperQty}
        onLowerQtyChange={controller.setAdvanceLowerQty}
        onClose={() => controller.setAdvanceModalOpen(false)}
        onConfirm={controller.handleAdvanceConfirm}
      />

    </AppShell>
  )
}

export default LabPageContainer
