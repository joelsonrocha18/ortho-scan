import { HeartPulse, Stethoscope } from 'lucide-react'
import { AudienceAccessCard } from './components/AudienceAccessCard'
import { PublicAccessShell } from './components/PublicAccessShell'

function PublicAccessHubPage() {
  return (
    <PublicAccessShell eyebrow="Portais" title="Escolha seu acesso" accent="baby">
      <div className="space-y-4">
        <AudienceAccessCard title="Dentistas" tone="brand" icon={Stethoscope} to="/acesso/dentistas" ctaLabel="Área do Parceiro" />
        <AudienceAccessCard title="Pacientes de alinhadores" tone="olive" icon={HeartPulse} to="/acesso/pacientes" ctaLabel="Área do Paciente" />
      </div>
    </PublicAccessShell>
  )
}

export default PublicAccessHubPage
