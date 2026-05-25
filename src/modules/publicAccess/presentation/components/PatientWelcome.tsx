import Card from '../../../../components/Card'
import type { PatientPortalSummary } from '../../domain/models/PatientPortal'

export default function PatientWelcome({ summary }: { summary: PatientPortalSummary }) {
  return (
    <Card className="rounded-lg bg-white">
      <p className="text-sm font-medium text-olive-700">Olá, {summary.patientName}</p>
      <h2 className="mt-2 text-2xl font-semibold text-slate-950">Seu tratamento está em acompanhamento</h2>
      <p className="mt-2 text-sm text-slate-600">
        {summary.dentistName ? `Dentista responsável: ${summary.dentistName}. ` : ''}
        {summary.productLabel ?? 'Tratamento'} com {summary.totalTrays} bandejas planejadas.
      </p>
      <div className="mt-4 rounded-lg border border-olive-200 bg-olive-50 p-3 text-sm text-olive-900">
        Próxima ação: {summary.nextChangeDate ? `troca prevista para ${summary.nextChangeDate}.` : 'aguarde a próxima orientação da clínica.'}
      </div>
    </Card>
  )
}
