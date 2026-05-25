import { CheckCircle2, Circle } from 'lucide-react'
import Card from '../../../../components/Card'
import type { LabStageValue } from '../../../../types/Domain'

type CaseProductionTabProps = {
  currentStage?: LabStageValue
  assignedTechName?: string
  qcPassed?: boolean
}

const stages: Array<{ id: LabStageValue; label: string }> = [
  { id: 'queued', label: 'Triagem' },
  { id: 'in_production', label: 'Produção' },
  { id: 'qc', label: 'Qualidade' },
  { id: 'shipped', label: 'Expedição' },
  { id: 'delivered', label: 'Entregue' },
]

export default function CaseProductionTab({ currentStage = 'queued', assignedTechName = 'Não atribuído', qcPassed = false }: CaseProductionTabProps) {
  const currentIndex = stages.findIndex((stage) => stage.id === currentStage)
  return (
    <Card className="rounded-lg">
      <h2 className="text-lg font-semibold text-slate-950">Produção</h2>
      <p className="mt-1 text-sm text-slate-600">Etapas do laboratório, responsável técnico, fotos e checklist de QC.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-5">
        {stages.map((stage, index) => {
          const complete = index <= currentIndex
          return (
            <div key={stage.id} className="rounded-lg border border-slate-200 p-3">
              {complete ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
              <p className="mt-2 font-medium text-slate-900">{stage.label}</p>
            </div>
          )
        })}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Técnico responsável</p>
          <p className="font-semibold text-slate-950">{assignedTechName}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Controle de qualidade</p>
          <p className="font-semibold text-slate-950">{qcPassed ? 'Aprovado' : 'Pendente'}</p>
        </div>
      </div>
    </Card>
  )
}
