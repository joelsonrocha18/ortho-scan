import { PublicAccessShell } from './components/PublicAccessShell'
import { PatientPortalAccessCard } from './components/PatientPortalAccessCard'
import { usePatientAccessController } from './hooks/usePatientAccessController'

function PatientAccessPageContainer() {
  const controller = usePatientAccessController()

  return (
    <PublicAccessShell eyebrow="Pacientes" title="Área do Paciente" accent="olive">
      <PatientPortalAccessCard
        cpf={controller.form.cpf}
        birthDate={controller.form.birthDate}
        accessCode={controller.form.accessCode}
        submitting={controller.submitting}
        onCpfChange={controller.updateCpf}
        onBirthDateChange={controller.updateBirthDate}
        onAccessCodeChange={controller.updateAccessCode}
        onSubmit={controller.submitAccess}
      />
    </PublicAccessShell>
  )
}

export default PatientAccessPageContainer
