import Card from '../../../../components/Card'
import type { CaseTimelineEntry } from '../../../../types/Case'

type CaseHistoryTimelineSectionProps = {
  entries: CaseTimelineEntry[]
}

function toneClasses(entry: CaseTimelineEntry) {
  if (entry.type === 'status_changed') return 'border-blue-200 bg-blue-50 text-blue-900'
  if (entry.type === 'installation_registered' || entry.type === 'delivery_registered') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (entry.type === 'note_added') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (entry.type === 'audit') return 'border-slate-200 bg-slate-50 text-slate-800'
  return 'border-slate-200 bg-white text-slate-900'
}

export function CaseHistoryTimelineSection({ entries }: CaseHistoryTimelineSectionProps) {
  return (
    <section className="mt-6">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Histórico do caso</h2>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            {entries.length} evento{entries.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-4 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum evento registrado.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className={`rounded-xl border px-3 py-2.5 ${toneClasses(entry)}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold">{entry.title}</p>
                  <p className="text-xs opacity-75">{new Date(entry.at).toLocaleString('pt-BR')}</p>
                </div>
                {entry.description ? <p className="mt-1 text-sm">{entry.description}</p> : null}
                {(entry.actorName || entry.actorEmail) ? (
                  <p className="mt-2 text-xs opacity-75">
                    {entry.actorName || entry.actorEmail}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </section>
  )
}
