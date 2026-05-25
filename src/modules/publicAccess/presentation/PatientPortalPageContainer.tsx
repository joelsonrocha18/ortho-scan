import Button from '../../../components/Button'
import Card from '../../../components/Card'
import { PublicAccessShell } from './components/PublicAccessShell'
import { usePatientPortalController } from './hooks/usePatientPortalController'
import { PatientPortalHeroSection } from './sections/PatientPortalHeroSection'
import { PatientPortalSummarySection } from './sections/PatientPortalSummarySection'
import { PatientPortalTrayScheduleSection } from './sections/PatientPortalTrayScheduleSection'
import HelpCenter from './components/HelpCenter'
import PatientWelcome from './components/PatientWelcome'
import TreatmentProgress from './components/TreatmentProgress'

function PatientPortalPageContainer() {
  const controller = usePatientPortalController()

  if (controller.loading) {
    return (
      <PublicAccessShell eyebrow="Pacientes" title="Carregando" accent="olive" layout="stacked">
        <Card className="bg-white p-6 text-slate-900">
          <p className="text-sm text-slate-600">Carregando...</p>
        </Card>
      </PublicAccessShell>
    )
  }

  if (!controller.snapshot) {
    return (
      <PublicAccessShell eyebrow="Pacientes" title="Portal indisponível" accent="olive" layout="stacked">
        <Card className="bg-white p-6 text-slate-900">
          <p className="text-sm text-slate-600">{controller.error || 'Sessão do paciente indisponível.'}</p>
          <div className="mt-5">
            <Button onClick={controller.backToAccess}>Solicitar novo acesso</Button>
          </div>
        </Card>
      </PublicAccessShell>
    )
  }

  return (
    <PublicAccessShell eyebrow="Pacientes" title="Área do Paciente" accent="olive" layout="stacked">
      <div className="space-y-4">
        <PatientPortalHeroSection summary={controller.snapshot.summary} accessCode={controller.snapshot.accessCode} />
        <PatientWelcome summary={controller.snapshot.summary} />
        <TreatmentProgress summary={controller.snapshot.summary} />
        <PatientPortalSummarySection summary={controller.snapshot.summary} />
        <PatientPortalTrayScheduleSection
          photoSlots={controller.snapshot.photoSlots}
          selectedTrayNumber={controller.uploadForm.trayNumber}
          capturedAt={controller.uploadForm.capturedAt}
          selectedFile={controller.uploadForm.file}
          uploading={controller.uploading}
          onSelectSlot={controller.selectPhotoSlot}
          onCapturedAtChange={controller.setCapturedAt}
          onFileSelected={controller.setFile}
          onBackFromReview={controller.clearSelectedFile}
          onSubmit={controller.submitPhoto}
        />
        <HelpCenter clinicName={controller.snapshot.summary.clinicName} />
      </div>
    </PublicAccessShell>
  )
}

export default PatientPortalPageContainer
