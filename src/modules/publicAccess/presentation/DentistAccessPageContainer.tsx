import { DentistAccessForm } from './components/DentistAccessForm'
import { PublicAccessShell } from './components/PublicAccessShell'

function DentistAccessPageContainer() {
  return (
    <PublicAccessShell eyebrow="Dentistas" title="Área do Parceiro" accent="brand">
      <DentistAccessForm />
    </PublicAccessShell>
  )
}

export default DentistAccessPageContainer
