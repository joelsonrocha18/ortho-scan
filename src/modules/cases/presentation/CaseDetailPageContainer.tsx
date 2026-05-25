import AppShell from '../../../layouts/AppShell'
import { CaseAttachmentModal } from './modals/CaseAttachmentModal'
import { CaseTrayModal } from './modals/CaseTrayModal'
import { useCaseDetailController } from './hooks/useCaseDetailController'
import { CaseStateCard } from './components/CaseStateCard'
import { CaseHeaderSection } from './sections/CaseHeaderSection'
import { CaseWorkflowSection } from './sections/CaseWorkflowSection'
import { CaseReplacementSection } from './sections/CaseReplacementSection'
import { CaseReplenishmentForecastSection } from './sections/CaseReplenishmentForecastSection'
import { CaseClinicalInfoSection } from './sections/CaseClinicalInfoSection'
import { CaseScanFilesSection } from './sections/CaseScanFilesSection'
import { CaseLabProductionSection } from './sections/CaseLabProductionSection'
import { CaseTrayTimelineSection } from './sections/CaseTrayTimelineSection'
import { CaseAttachmentsSection } from './sections/CaseAttachmentsSection'
import { CaseFinancialSection } from './sections/CaseFinancialSection'
import { CaseHistoryTimelineSection } from './sections/CaseHistoryTimelineSection'
import { CasePlanningVersionsSection } from './sections/CasePlanningVersionsSection'
import { CaseDangerZoneSection } from './sections/CaseDangerZoneSection'
import { CaseCostSheet } from './components/CaseCostSheet'
import { InvoiceTriggerButton } from './components/InvoiceTriggerButton'

function CaseDetailPageContainer() {
  const controller = useCaseDetailController()

  if (controller.pageState === 'not_found') {
    return (
      <AppShell breadcrumb={['Início', 'Alinhadores']}>
        <CaseStateCard
          title="Pedido não encontrado"
          message="O pedido solicitado não existe ou foi removido."
          actionLabel="Voltar"
          onAction={controller.goBack}
        />
      </AppShell>
    )
  }

  if (controller.pageState === 'forbidden') {
    return (
      <AppShell breadcrumb={['Início', 'Alinhadores']}>
        <CaseStateCard
          title="Sem acesso"
          message="Seu perfil não permite visualizar este pedido."
          actionLabel="Voltar"
          onAction={controller.goBack}
        />
      </AppShell>
    )
  }

  if (!controller.currentCase) return null

  return (
    <AppShell breadcrumb={controller.breadcrumb}>
      <CaseHeaderSection
        patientDisplayName={controller.patientDisplayName}
        identification={
          controller.currentCase.treatmentCode
            ? `Identificação: ${controller.displayCaseCode} (${controller.displayTreatmentOrigin === 'interno' ? 'Interno ARRIMO' : 'Externo'})`
            : undefined
        }
        productLine={`Produto: ${controller.displayProductLabel} | Nº Caso: ${controller.displayCaseCode}`}
        planningLine={controller.planningLine}
        statusLabel={controller.statusLabel}
        statusTone={controller.statusTone}
        updatedAtLabel={controller.updatedAtLabel}
        progressCards={controller.headerProgressCards}
        summaryLines={controller.headerSummaryLines}
        canSharePatientPortalAccess={controller.canSharePatientPortalAccess}
        onSharePatientPortalAccess={controller.sharePatientPortalAccess}
        canConcludeTreatmentManually={controller.canConcludeTreatmentManually}
        onConcludeTreatment={controller.concludeTreatmentManually}
      />

      <CaseWorkflowSection
        visible={!controller.hasProductionOrder}
        statusLabel={controller.statusLabel}
        phase={controller.currentCase.phase}
        canWrite={controller.canWrite}
        budgetValue={controller.budgetValue}
        budgetNotes={controller.budgetNotes}
        contractNotes={controller.contractNotes}
        contractStatus={controller.currentContractStatus}
        contractApprovedAt={controller.currentContractApprovedAtLabel}
        onBudgetValueChange={controller.setBudgetValue}
        onBudgetNotesChange={controller.setBudgetNotes}
        onContractNotesChange={controller.setContractNotes}
        onConcludePlanning={controller.concludePlanning}
        onCloseBudget={controller.closeBudget}
        onApproveContract={controller.approveContract}
        onCreateLabOrder={controller.createLabOrder}
      />

      <CaseReplacementSection
        totalContratado={controller.replacementSummary.totalContratado}
        entreguePaciente={controller.replacementSummary.entreguePaciente}
        saldoRestante={controller.replacementSummary.saldoRestante}
        currentInstallation={controller.currentCase.installation}
        hasUpperArch={controller.hasUpperArch}
        hasLowerArch={controller.hasLowerArch}
        readyUpper={controller.readyToDeliverPatient.upper}
        readyLower={controller.readyToDeliverPatient.lower}
        installationDate={controller.installationDate}
        installationNote={controller.installationNote}
        installationDeliveredUpper={controller.installationDeliveredUpper}
        installationDeliveredLower={controller.installationDeliveredLower}
        totalUpper={controller.totalUpper}
        totalLower={controller.totalLower}
        canWrite={controller.canWrite}
        hasProductionOrder={controller.hasProductionOrder}
        hasDentistDelivery={controller.hasDentistDelivery}
        onInstallationDateChange={(value) => controller.setInstallationDate(value as `${number}-${number}-${number}`)}
        onInstallationNoteChange={controller.setInstallationNote}
        onInstallationDeliveredUpperChange={controller.setInstallationDeliveredUpper}
        onInstallationDeliveredLowerChange={controller.setInstallationDeliveredLower}
        onSaveInstallation={controller.saveInstallation}
      />

      <CaseReplenishmentForecastSection
        visible={controller.isAlignerCase}
        hasUpperArch={controller.hasUpperArch}
        hasLowerArch={controller.hasLowerArch}
        progressUpper={controller.progressUpper}
        progressLower={controller.progressLower}
        totalPlanned={Math.max(controller.progressUpper.total, controller.progressLower.total)}
        nextTrayRequired={controller.nextTrayRequired}
        maxPlannedTrays={controller.maxPlannedTrays}
        nextReplacementDueDate={controller.nextReplacementDueDate}
        hasInstallation={Boolean(controller.currentCase.installation?.installedAt)}
        alerts={controller.replenishmentAlerts}
      />

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CaseClinicalInfoSection
          currentCase={controller.currentCase}
          clinicName={controller.clinicName}
          dentistLabel={controller.dentistLabel}
          requesterLabel={controller.requesterLabel}
          isAlignerCase={controller.isAlignerCase}
          canWrite={controller.canWrite}
          changeEveryDaysInput={controller.changeEveryDaysInput}
          hasUpperArch={controller.hasUpperArch}
          hasLowerArch={controller.hasLowerArch}
          totalUpper={controller.totalUpper}
          totalLower={controller.totalLower}
          onChangeEveryDaysInput={controller.setChangeEveryDaysInput}
          onSaveChangeEveryDays={controller.saveChangeEveryDays}
        />
        <CaseScanFilesSection
          groupedScanFiles={controller.groupedScanFiles}
          hasUpperArch={controller.hasUpperArch}
          hasLowerArch={controller.hasLowerArch}
          canWriteLocalOnly={controller.canWriteLocalOnly}
          onOpenScanFile={controller.openScanFile}
          onMarkCaseFileError={controller.markCaseFileError}
          onClearCaseFileError={controller.clearCaseFileError}
        />
      </section>

      <CaseLabProductionSection
        visible={controller.isAlignerCase}
        canReadLab={controller.canReadLab}
        labSummary={controller.labSummary}
        deliveryLots={controller.currentCase.deliveryLots ?? []}
        linkedLabItems={controller.linkedLabItems}
        onNavigateToLabBank={controller.navigateToLabBank}
      />

      <CaseTrayTimelineSection
        trays={controller.displayTrays}
        changeSchedule={controller.changeSchedule}
        linkedLabItems={controller.linkedLabItems}
        patientPortalPhotosByTray={controller.patientPortalPhotosByTray}
        todayIso={controller.todayIso}
        canManageTray={controller.canManageTray}
        canEditActualDates={controller.canManageTray && Boolean(controller.currentCase.installation)}
        hasUpperArch={controller.hasUpperArch}
        hasLowerArch={controller.hasLowerArch}
        actualUpperByTray={controller.actualChangeDateUpperByTray}
        actualLowerByTray={controller.actualChangeDateLowerByTray}
        onOpenTrayModal={controller.openTrayModal}
        onSaveTrayDueDate={controller.saveTrayDueDate}
        onSaveActualChangeDate={controller.saveActualChangeDate}
        onDownloadPatientPhoto={controller.downloadPatientPortalPhoto}
      />

      <CaseAttachmentsSection
        attachments={controller.currentCase.attachments}
        canWriteLocalOnly={controller.canWriteLocalOnly}
        onOpenAttachmentModal={() => controller.setAttachmentModalOpen(true)}
      />

      <CasePlanningVersionsSection
        versions={controller.planningVersions}
        draftNote={controller.planningVersionNote}
        canPublish={controller.canWrite}
        canApprove={controller.canApprovePlanning}
        onDraftNoteChange={controller.setPlanningVersionNote}
        onPublish={controller.publishPlanningVersion}
        onApprove={controller.approvePlanningVersion}
      />

      <CaseFinancialSection
        financial={controller.financial}
        reworkSummary={controller.currentCase.reworkSummary}
      />

      <div className="mt-4 flex justify-end">
        <InvoiceTriggerButton
          caseId={controller.currentCase.id}
          status={controller.invoiceLabStage}
          onInvoice={controller.triggerInvoice}
        />
      </div>

      <CaseCostSheet
        caseId={controller.currentCase.id}
        costs={controller.costSheet.costs}
        laborHours={controller.costSheet.laborHours}
        laborRate={controller.costSheet.laborRate}
        projectedMargin={controller.costSheet.projectedMargin}
        actualMargin={controller.costSheet.actualMargin}
      />

      <CaseHistoryTimelineSection entries={controller.timelineEntries} />
      <CaseDangerZoneSection visible={controller.canDeleteCase} onDeleteCase={controller.handleDeleteCase} />

      <CaseAttachmentModal
        open={controller.attachmentModalOpen}
        canWriteLocalOnly={controller.canWriteLocalOnly}
        attachmentType={controller.attachmentType}
        attachmentNote={controller.attachmentNote}
        attachmentDate={controller.attachmentDate}
        attachmentFile={controller.attachmentFile}
        onAttachmentTypeChange={controller.setAttachmentType}
        onAttachmentNoteChange={controller.setAttachmentNote}
        onAttachmentDateChange={(value) => controller.setAttachmentDate(value as `${number}-${number}-${number}`)}
        onAttachmentFileChange={controller.setAttachmentFile}
        onClose={() => controller.setAttachmentModalOpen(false)}
        onSave={controller.handleAttachmentSave}
      />

      <CaseTrayModal
        open={Boolean(controller.selectedTray)}
        selectedTray={controller.selectedTray}
        canManageTray={controller.canManageTray}
        trayState={controller.trayState}
        reworkArch={controller.reworkArch}
        trayNote={controller.trayNote}
        hasLinkedLabItem={controller.selectedTrayHasLinkedLabItem}
        onClose={() => controller.setSelectedTray(null)}
        onTrayStateChange={controller.setSelectedTrayState}
        onReworkArchChange={controller.setReworkArch}
        onTrayNoteChange={controller.setTrayNote}
        onSave={controller.saveTrayChanges}
      />
    </AppShell>
  )
}

export default CaseDetailPageContainer
