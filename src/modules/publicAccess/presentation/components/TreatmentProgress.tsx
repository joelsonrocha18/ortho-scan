import type { PatientPortalSummary } from '../../domain/models/PatientPortal'

export default function TreatmentProgress({ summary }: { summary: PatientPortalSummary }) {
  const current = Math.max(summary.currentTrays.upper, summary.currentTrays.lower)
  const total = Math.max(1, summary.totalTrays)
  const progress = Math.min(100, Math.round((current / total) * 100))

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
        <span>Progresso do tratamento</span>
        <span>{progress}%</span>
      </div>
      <div className="mt-3 h-3 rounded-full bg-slate-100">
        <div className="h-3 rounded-full bg-olive-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {Array.from({ length: Math.min(total, 40) }, (_, index) => {
          const trayNumber = index + 1
          return <span key={trayNumber} className={`h-2 flex-1 rounded-full ${trayNumber <= current ? 'bg-olive-500' : 'bg-slate-200'}`} title={`Bandeja ${trayNumber}`} />
        })}
      </div>
    </section>
  )
}
