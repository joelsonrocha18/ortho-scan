import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import DataTable from '../../../../shared/components/DataTable'

export type DentistListItem = {
  id: string
  name: string
  cro: string
  cro_state: string
  email: string
  phone: string
  clinic_names: string[]
  role: 'dentist_admin' | 'dentist_client'
  active_cases_count: number
  total_cases_count: number
  portal_access: boolean
  created_at: Date
}

export default function DentistsTable({ dentists, loading = false }: { dentists: DentistListItem[]; loading?: boolean }) {
  const [query, setQuery] = useState('')
  const filtered = dentists.filter((dentist) => `${dentist.name} ${dentist.cro} ${dentist.email}`.toLowerCase().includes(query.toLowerCase()))
  const columns = useMemo<Array<ColumnDef<DentistListItem>>>(
    () => [
      { accessorKey: 'name', header: 'Dentista', cell: ({ row }) => <Link className="font-semibold text-brand-700 hover:text-brand-600" to={`/app/dentists/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: 'cro', header: 'CRO' },
      { accessorKey: 'email', header: 'E-mail' },
      { accessorKey: 'active_cases_count', header: 'Casos ativos' },
      { accessorKey: 'portal_access', header: 'Portal', cell: ({ row }) => <Badge tone={row.original.portal_access ? 'success' : 'neutral'}>{row.original.portal_access ? 'Ativo' : 'Inativo'}</Badge> },
    ],
    [],
  )

  return <DataTable data={filtered} columns={columns} loading={loading} filters={<Input placeholder="Buscar dentista, CRO ou e-mail" value={query} onChange={(event) => setQuery(event.target.value)} />} actions={(row) => <Button variant="ghost" size="sm"><Link to={`/app/dentists/${row.id}`}>Ver</Link></Button>} />
}
