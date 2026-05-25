import Card from '../../../../components/Card'

type CaseTreatmentTabProps = {
  currentTray: number
  totalTrays: number
  adherenceRate?: number
}

export default function CaseTreatmentTab({ currentTray, totalTrays, adherenceRate = 100 }: CaseTreatmentTabProps) {
  const progress = totalTrays > 0 ? Math.round((currentTray / totalTrays) * 100) : 0
  return (
    <Card className="rounded-lg">
      <h2 className="text-lg font-semibold text-slate-950">Tratamento</h2>
      <p className="mt-1 text-sm text-slate-600">Progresso de bandejas, confirmações, selfies e alertas de atraso.</p>
      <div className="mt-5">
        <div className="flex justify-between text-sm text-slate-600">
          <span>Bandeja {currentTray} de {totalTrays}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-3 rounded-full bg-slate-100">
          <div className="h-3 rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Adesão</p>
          <p className="text-2xl font-semibold text-slate-950">{adherenceRate}%</p>
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Nenhuma selfie recente vinculada.</div>
      </div>
    </Card>
  )
}
