import Button from '../../../../components/Button'
import Card from '../../../../components/Card'
import { formatPtBrDate } from '../../../../shared/utils/date'
import type { CaseDeliveryLot } from '../../../../types/Case'
import type { LabItem } from '../../../../types/Lab'

type LabSummary = {
  aguardando_iniciar: number
  em_producao: number
  controle_qualidade: number
  prontas: number
  entregues: number
  osItens: number
}

type CaseLabProductionSectionProps = {
  visible: boolean
  canReadLab: boolean
  labSummary: LabSummary
  deliveryLots: CaseDeliveryLot[]
  linkedLabItems: LabItem[]
  onNavigateToLabBank: () => void
}

export function CaseLabProductionSection({
  visible,
  canReadLab,
  labSummary,
  deliveryLots,
  linkedLabItems,
  onNavigateToLabBank,
}: CaseLabProductionSectionProps) {
  if (!visible) return null

  const statusLabel: Record<LabItem['status'], string> = {
    aguardando_iniciar: 'Aguardando iniciar',
    em_producao: 'Em produção',
    controle_qualidade: 'Controle de qualidade',
    prontas: 'Pronta para entregar',
  }

  const pendingItems = linkedLabItems
    .filter((item) => !item.deliveredToProfessionalAt)
    .sort((left, right) => {
      const dueCompare = left.dueDate.localeCompare(right.dueDate)
      if (dueCompare !== 0) return dueCompare
      return left.trayNumber - right.trayNumber
    })

  const deliveredLotsSorted = [...deliveryLots].sort((left, right) => right.deliveredToDoctorAt.localeCompare(left.deliveredToDoctorAt))

  return (
    <section className="mt-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900">LAB e entrega ao profissional</h2>
          {canReadLab ? (
            <Button size="sm" variant="secondary" onClick={onNavigateToLabBank}>
              Banco de reposições
            </Button>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Aguardando: {labSummary.aguardando_iniciar}</div>
          <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">Em produção: {labSummary.em_producao}</div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">CQ: {labSummary.controle_qualidade}</div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Prontas: {labSummary.prontas}</div>
          <div className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">Entregues: {labSummary.entregues}</div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Itens da OS: {labSummary.osItens}</p>

        <div className="mt-5 grid items-start gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Entrega ao profissional</h3>
            <div className="mt-3 space-y-3">
              {deliveredLotsSorted.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma entrega registrada.</p>
              ) : (
                deliveredLotsSorted.map((lot) => (
                  <div key={lot.id} className="rounded-2xl border border-emerald-200 bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {lot.arch === 'ambos' ? 'Arcadas superior e inferior' : `Arcada ${lot.arch}`}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Placas #{lot.fromTray} a #{lot.toTray} | Quantidade {lot.quantity}
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                        {formatPtBrDate(lot.deliveredToDoctorAt)}
                      </span>
                    </div>
                    {lot.note?.trim() ? (
                      <p className="mt-2 text-xs text-slate-600">{lot.note}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Pendências do laboratório</h3>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {pendingItems.length} aberta{pendingItems.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {pendingItems.length === 0 ? (
                <p className="text-sm text-slate-500">Sem pendências abertas.</p>
              ) : (
                pendingItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {item.requestCode ?? item.id} | Placa #{item.trayNumber}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {item.arch === 'ambos' ? 'Arcadas superior e inferior' : `Arcada ${item.arch}`} | {item.requestKind === 'reconfeccao' ? 'Reconfecção' : 'Produção'}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
                        {statusLabel[item.status]}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">Prazo {formatPtBrDate(item.dueDate)}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">Prioridade {item.priority === 'Medio' ? 'Médio' : item.priority}</span>
                    </div>
                    {item.notes?.trim() ? (
                      <p className="mt-2 text-xs text-slate-600">{item.notes}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}
