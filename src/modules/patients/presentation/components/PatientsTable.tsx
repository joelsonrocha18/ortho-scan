import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import DataTable from '../../../../shared/components/DataTable'

export type PatientListItem = {
  id: string
  name: string
  email?: string
  phone: string
  cpf?: string
  dentist_id: string
  dentist_name: string
  active_case?: { id: string; status: string }
  portal_enabled: boolean
  current_tray?: number
  total_trays?: number
  created_at: Date
}

export default function PatientsTable({ patients, loading = false }: { patients: PatientListItem[]; loading?: boolean }) {
  const [query, setQuery] = useState('')
  const filtered = patients.filter((patient) => `${patient.name} ${patient.email ?? ''} ${patient.phone} ${patient.cpf ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const columns = useMemo<Array<ColumnDef<PatientListItem>>>(
    () => [
      { accessorKey: 'name', header: 'Paciente', cell: ({ row }) => <Link className="font-semibold text-brand-700 hover:text-brand-600" to={`/app/patients/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: 'phone', header: 'Telefone' },
      { accessorKey: 'dentist_name', header: 'Dentista' },
      { accessorKey: 'portal_enabled', header: 'Portal', cell: ({ row }) => <Badge tone={row.original.portal_enabled ? 'success' : 'neutral'}>{row.original.portal_enabled ? 'Ativo' : 'Inativo'}</Badge> },
      { accessorKey: 'active_case', header: 'Caso ativo', cell: ({ row }) => row.original.active_case?.status ?? 'Sem caso ativo' },
    ],
    [],
  )

  return (
    <DataTable
      data={filtered}
      columns={columns}
      loading={loading}
      filters={<Input placeholder="Buscar por nome, e-mail, telefone ou CPF" value={query} onChange={(event) => setQuery(event.target.value)} />}
      actions={(row) => <Button variant="ghost" size="sm"><Link to={`/app/patients/${row.id}`}>Ver</Link></Button>}
    />
  )
}
