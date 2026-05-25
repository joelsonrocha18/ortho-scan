import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Card from '../../../../components/Card'

type StageDatum = { name: string; value: number }

type ProductionChartsProps = {
  stages: StageDatum[]
  completedByWeek: StageDatum[]
  caseTypes: StageDatum[]
  slaTrend: StageDatum[]
}

const colors = ['#01527d', '#6aa6c8', '#7c8f42', '#e2856e', '#64748b']

export default function ProductionCharts({ stages, completedByWeek, caseTypes, slaTrend }: ProductionChartsProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-2" aria-label="Gráficos de produção">
      <Card className="rounded-lg">
        <h2 className="mb-4 font-semibold text-slate-900">Casos por etapa</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={stages}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#01527d" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="rounded-lg">
        <h2 className="mb-4 font-semibold text-slate-900">Concluídos por semana</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={completedByWeek}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#01527d" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="rounded-lg">
        <h2 className="mb-4 font-semibold text-slate-900">Distribuição por tipo</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={caseTypes} dataKey="value" nameKey="name" outerRadius={92} label>
                {caseTypes.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="rounded-lg">
        <h2 className="mb-4 font-semibold text-slate-900">SLA ao longo do tempo</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={slaTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis unit="%" />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#7c8f42" fill="#e7ebd5" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </section>
  )
}
