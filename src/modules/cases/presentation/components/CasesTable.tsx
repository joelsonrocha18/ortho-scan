import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import DataTable from '../../../../shared/components/DataTable'
import type { CaseStatus } from '../../../../types/Case'
import type { LabStageValue, SLAStatusValue } from '../../../../types/Domain'

export type CaseListItem = {
  id: string
  case_number: string
  patient_id: string
  patient_name: string
  dentist_id: string
  dentist_name: string
  type: 'alinhador' | 'contencao' | 'clareamento' | 'outro'
  status: CaseStatus
  lab_stage?: LabStageValue
  priority: 'normal' | 'urgent' | 'vip'
  total_trays: number
  sla_status: SLAStatusValue
  due_date?: Date
  created_at: Date
  updated_at: Date
}

type CasesTableProps = {
  cases: CaseListItem[]
  loading?: boolean
}

const statusLabels: Record<CaseStatus, string> = {
  planejamento: 'Planejamento',
  em_producao: 'Em produção',
  em_entrega: 'Em entrega',
  em_tratamento: 'Em tratamento',
  aguardando_reposicao: 'Aguardando reposição',
  finalizado: 'Finalizado',
}

export default function CasesTable({ cases, loading = false }: CasesTableProps) {
  const [query, setQuery] = useState('')
  const filtered = cases.filter((item) => `${item.case_number} ${item.patient_name} ${item.dentist_name}`.toLowerCase().includes(query.toLowerCase()))
  const columns = useMemo<Array<ColumnDef<CaseListItem>>>(
    () => [
      { accessorKey: 'case_number', header: 'Caso', cell: ({ row }) => <Link className="font-semibold text-brand-700 hover:text-brand-600" to={`/app/cases/${row.original.id}`}>{row.original.case_number}</Link> },
      { accessorKey: 'patient_name', header: 'Paciente' },
      { accessorKey: 'dentist_name', header: 'Dentista' },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge tone={row.original.status === 'finalizado' ? 'success' : 'info'}>{statusLabels[row.original.status]}</Badge> },
      { accessorKey: 'priority', header: 'Prioridade', cell: ({ row }) => <Badge tone={row.original.priority === 'urgent' ? 'danger' : row.original.priority === 'vip' ? 'info' : 'neutral'}>{row.original.priority === 'urgent' ? 'Urgente' : row.original.priority === 'vip' ? 'VIP' : 'Normal'}</Badge> },
      { accessorKey: 'total_trays', header: 'Bandejas' },
    ],
    [],
  )

  return (
    <DataTable
      data={filtered}
      columns={columns}
      loading={loading}
      selection={{ selected: [], onSelect: () => undefined }}
      filters={<Input placeholder="Buscar por caso, paciente ou dentista" value={query} onChange={(event) => setQuery(event.target.value)} />}
      actions={(row) => (
        <Button variant="ghost" size="sm">
          <Link to={`/app/cases/${row.id}`}>Ver</Link>
        </Button>
      )}
    />
  )
}
