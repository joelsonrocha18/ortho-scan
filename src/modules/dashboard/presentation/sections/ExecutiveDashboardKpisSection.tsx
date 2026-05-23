import Card from '../../../../components/Card'

type KpiCardProps = {
  label: string
  value: string
  hint?: string
  className: string
  labelClassName: string
  hintClassName: string
}

function KpiCard(props: KpiCardProps) {
  return (
    <Card className={`space-y-2 ${props.className}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${props.labelClassName}`}>{props.label}</p>
      <p className="text-3xl font-semibold text-slate-950">{props.value}</p>
      {props.hint ? <p className={`text-sm ${props.hintClassName}`}>{props.hint}</p> : null}
    </Card>
  )
}

export function ExecutiveDashboardKpisSection(props: {
  activeCases: number
  labBacklog: number
  overdueSla: number
  reworkRate: number
  margin: number
}) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      <KpiCard
        label="Casos ativos"
        value={String(props.activeCases)}
        className="border-brand-300 bg-[linear-gradient(180deg,rgba(220,236,255,0.88),rgba(255,255,255,0.98))]"
        labelClassName="text-brand-700"
        hintClassName="text-slate-600"
      />
      <KpiCard
        label="Producao LAB"
        value={String(props.labBacklog)}
        className="border-baby-300 bg-[linear-gradient(180deg,rgba(234,244,255,0.96),rgba(255,255,255,0.98))]"
        labelClassName="text-brand-700"
        hintClassName="text-slate-600"
      />
      <KpiCard
        label="Trabalhos em atraso"
        value={String(props.overdueSla)}
        className="border-salmon-300 bg-[linear-gradient(180deg,rgba(255,224,216,0.92),rgba(255,255,255,0.98))]"
        labelClassName="text-salmon-700"
        hintClassName="text-slate-600"
      />
      <KpiCard
        label="Refeitos"
        value={`${props.reworkRate}%`}
        className="border-olive-300 bg-[linear-gradient(180deg,rgba(231,235,213,0.92),rgba(255,255,255,0.98))]"
        labelClassName="text-olive-700"
        hintClassName="text-slate-600"
      />
      <KpiCard
        label="Margem estimada"
        value={props.margin.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        className="border-brand-300 bg-[linear-gradient(145deg,rgba(220,236,255,0.9),rgba(231,235,213,0.8),rgba(255,255,255,0.98))]"
        labelClassName="text-brand-700"
        hintClassName="text-slate-600"
      />
    </section>
  )
}
