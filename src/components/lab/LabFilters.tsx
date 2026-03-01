import { useEffect, useState } from 'react'
import Input from '../Input'
import type { LabPriority, LabStatus } from '../../types/Lab'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

type LabFiltersProps = {
  search: string
  priority: 'todos' | Lowercase<LabPriority>
  overdueOnly: boolean
  alertsOnly?: boolean
  status: 'todos' | LabStatus
  onSearchChange: (value: string) => void
  onPriorityChange: (value: 'todos' | Lowercase<LabPriority>) => void
  onOverdueOnlyChange: (value: boolean) => void
  onAlertsOnlyChange?: (value: boolean) => void
  onStatusChange: (value: 'todos' | LabStatus) => void
}

export default function LabFilters({
  search,
  priority,
  overdueOnly,
  alertsOnly = false,
  status,
  onSearchChange,
  onPriorityChange,
  onOverdueOnlyChange,
  onAlertsOnlyChange,
  onStatusChange,
}: LabFiltersProps) {
  const [searchInput, setSearchInput] = useState(search)
  const debouncedSearch = useDebouncedValue(searchInput, 250)

  useEffect(() => {
    onSearchChange(debouncedSearch)
  }, [debouncedSearch, onSearchChange])

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Buscar codigo, paciente ou #tray"
        />

        <select
          value={priority}
          onChange={(event) => onPriorityChange(event.target.value as 'todos' | Lowercase<LabPriority>)}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="todos">Prioridade: Todos</option>
          <option value="urgente">Urgente</option>
          <option value="medio">Médio</option>
          <option value="baixo">Baixo</option>
        </select>

        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value as 'todos' | LabStatus)}
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="todos">Status: Todos</option>
          <option value="aguardando_iniciar">Aguardando iniciar</option>
          <option value="em_producao">Em Produção</option>
          <option value="controle_qualidade">Controle de qualidade</option>
          <option value="prontas">Prontas</option>
        </select>

        <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => onOverdueOnlyChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
          />
          Somente atrasados
        </label>

        <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={alertsOnly}
            onChange={(event) => onAlertsOnlyChange?.(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
          />
          Somente alertas
        </label>
      </div>
    </div>
  )
}
