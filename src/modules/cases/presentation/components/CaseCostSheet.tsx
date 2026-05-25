export type CaseCost = {
  material: string
  quantity: number
  unit: string
  unitCost: number
  totalCost: number
}

type CaseCostSheetProps = {
  caseId: string
  costs: CaseCost[]
  laborHours: number
  laborRate: number
  projectedMargin: number
  actualMargin: number
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function CaseCostSheet({
  caseId,
  costs,
  laborHours,
  laborRate,
  projectedMargin,
  actualMargin,
}: CaseCostSheetProps) {
  const materialCost = costs.reduce((total, item) => total + item.totalCost, 0)
  const laborCost = Math.max(0, laborHours) * Math.max(0, laborRate)
  const totalCost = materialCost + laborCost
  const marginDelta = actualMargin - projectedMargin

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Custos</h2>
          <p className="text-sm text-slate-500">Ficha do caso {caseId}</p>
        </div>
        <div className="text-sm font-semibold text-slate-900">Custo total: {formatCurrency(totalCost)}</div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-3">Material</th>
              <th className="py-2 pr-3">Quantidade</th>
              <th className="py-2 pr-3">Unidade</th>
              <th className="py-2 pr-3">Custo unitario</th>
              <th className="py-2 pr-3">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {costs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-slate-500">Nenhum custo material informado.</td>
              </tr>
            ) : costs.map((item) => (
              <tr key={`${item.material}-${item.unit}`}>
                <td className="py-3 pr-3 font-medium text-slate-900">{item.material}</td>
                <td className="py-3 pr-3 text-slate-700">{item.quantity}</td>
                <td className="py-3 pr-3 text-slate-700">{item.unit}</td>
                <td className="py-3 pr-3 text-slate-700">{formatCurrency(item.unitCost)}</td>
                <td className="py-3 pr-3 font-semibold text-slate-900">{formatCurrency(item.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Material</p>
          <p className="text-sm font-semibold text-slate-900">{formatCurrency(materialCost)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Mao de obra</p>
          <p className="text-sm font-semibold text-slate-900">{formatCurrency(laborCost)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Margem projetada</p>
          <p className="text-sm font-semibold text-slate-900">{formatCurrency(projectedMargin)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Margem realizada</p>
          <p className={`text-sm font-semibold ${marginDelta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {formatCurrency(actualMargin)}
          </p>
        </div>
      </div>
    </section>
  )
}
