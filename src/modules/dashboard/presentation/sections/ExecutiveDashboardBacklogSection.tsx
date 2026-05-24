import Card from '../../../../components/Card'

export function ExecutiveDashboardBacklogSection(props: {
  queued: number
  inProduction: number
  qc: number
  shipped: number
  revenue: number
  totalCost: number
}) {
  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Produção do laboratório</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-baby-300 bg-baby-100 px-4 py-3">
            <p className="text-xs font-semibold text-brand-700">Fila</p>
            <p className="text-2xl font-semibold text-slate-900">{props.queued}</p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-xs font-semibold text-brand-700">Em produção</p>
            <p className="text-2xl font-semibold text-slate-900">{props.inProduction}</p>
          </div>
          <div className="rounded-lg border border-olive-300 bg-olive-50 px-4 py-3">
            <p className="text-xs font-semibold text-olive-700">CQ</p>
            <p className="text-2xl font-semibold text-slate-900">{props.qc}</p>
          </div>
          <div className="rounded-lg border border-salmon-300 bg-salmon-50 px-4 py-3">
            <p className="text-xs font-semibold text-salmon-700">Prontas</p>
            <p className="text-2xl font-semibold text-slate-900">{props.shipped}</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Financeiro estimado</h2>
        <div className="space-y-3">
          <div className="rounded-lg border border-brand-300 bg-baby-50 px-4 py-3">
            <p className="text-xs font-semibold text-brand-700">Receita estimada</p>
            <p className="text-2xl font-semibold text-slate-900">
              {props.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
          <div className="rounded-lg border border-salmon-300 bg-salmon-50/60 px-4 py-3">
            <p className="text-xs font-semibold text-salmon-700">Custo total estimado</p>
            <p className="text-2xl font-semibold text-slate-900">
              {props.totalCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>
        </div>
      </Card>
    </section>
  )
}
