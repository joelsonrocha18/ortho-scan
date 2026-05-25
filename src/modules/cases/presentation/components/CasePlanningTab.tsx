import Card from '../../../../components/Card'
import { Setup3DViewer } from '../../../dentistPortal/presentation/components/Setup3DViewer'

type CasePlanningTabProps = {
  upperArchUrl?: string
  lowerArchUrl?: string
  revisionCount?: number
}

export default function CasePlanningTab({ upperArchUrl, lowerArchUrl, revisionCount = 0 }: CasePlanningTabProps) {
  return (
    <Card className="rounded-lg">
      <h2 className="text-lg font-semibold text-slate-950">Planejamento</h2>
      <p className="mt-1 text-sm text-slate-600">Visualizador 3D, IPR, attachments e histórico de revisões.</p>
      {upperArchUrl && lowerArchUrl ? (
        <div className="mt-4">
          <Setup3DViewer upperArchUrl={upperArchUrl} lowerArchUrl={lowerArchUrl} onApprove={() => undefined} onRequestChanges={() => undefined} />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nenhum arquivo de setup 3D vinculado ao caso.</div>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm text-slate-500">Revisões</p>
          <p className="text-2xl font-semibold text-slate-950">{revisionCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm text-slate-500">IPR</p>
          <p className="font-semibold text-slate-900">Sem desgastes pendentes</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm text-slate-500">Attachments</p>
          <p className="font-semibold text-slate-900">Mapa aguardando upload</p>
        </div>
      </div>
    </Card>
  )
}
