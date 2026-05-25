import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import DataTable from '../../../../shared/components/DataTable'

export type ClinicListItem = {
  id: string
  name: string
  cnpj: string
  city: string
  state: string
  plan: 'starter' | 'professional' | 'enterprise'
  status: 'active' | 'suspended' | 'trial'
  users_count: number
  cases_count: number
  created_at: Date
}

export default function ClinicsTable({ clinics }: { clinics: ClinicListItem[] }) {
  const [query, setQuery] = useState('')
  const filtered = clinics.filter((clinic) => `${clinic.name} ${clinic.cnpj} ${clinic.city}`.toLowerCase().includes(query.toLowerCase()))
  const columns = useMemo<Array<ColumnDef<ClinicListItem>>>(
    () => [
      { accessorKey: 'name', header: 'Clínica', cell: ({ row }) => <Link className="font-semibold text-brand-700 hover:text-brand-600" to={`/app/clinics/${row.original.id}`}>{row.original.name}</Link> },
      { accessorKey: 'cnpj', header: 'CNPJ' },
      { accessorKey: 'city', header: 'Cidade' },
      { accessorKey: 'plan', header: 'Plano', cell: ({ row }) => <span className="capitalize">{row.original.plan}</span> },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge tone={row.original.status === 'active' ? 'success' : row.original.status === 'trial' ? 'info' : 'danger'}>{row.original.status === 'active' ? 'Ativa' : row.original.status === 'trial' ? 'Teste' : 'Suspensa'}</Badge> },
      { accessorKey: 'cases_count', header: 'Casos' },
    ],
    [],
  )

  return <DataTable data={filtered} columns={columns} filters={<Input placeholder="Buscar por clínica, CNPJ ou cidade" value={query} onChange={(event) => setQuery(event.target.value)} />} actions={(row) => <Button variant="ghost" size="sm"><Link to={`/app/clinics/${row.id}`}>Ver</Link></Button>} />
}
