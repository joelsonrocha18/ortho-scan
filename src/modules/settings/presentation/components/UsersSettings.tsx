import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import DataTable from '../../../../shared/components/DataTable'
import { profileLabel } from '../../../../auth/permissions'
import type { Role } from '../../../../types/User'
import type { UserWithRole } from '../types'
import SettingsSection from './SettingsSection'

const users: UserWithRole[] = [
  { uid: 'u-1', displayName: 'Equipe clínica', email: 'equipe@orthoscan.local', role: 'dentist_admin', permissions: ['settings.read'], status: 'active' },
  { uid: 'u-2', displayName: 'Técnico laboratório', email: 'lab@orthoscan.local', role: 'lab_tech', permissions: ['lab.read'], status: 'active' },
]

const roleOptions: Array<Role | 'todos'> = ['todos', 'master_admin', 'dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']

export default function UsersSettings() {
  const [roleFilter, setRoleFilter] = useState<Role | 'todos'>('todos')
  const [inviteEmail, setInviteEmail] = useState('')
  const filtered = users.filter((user) => roleFilter === 'todos' || user.role === roleFilter)

  const columns = useMemo<Array<ColumnDef<UserWithRole>>>(
    () => [
      { accessorKey: 'displayName', header: 'Usuário' },
      { accessorKey: 'email', header: 'E-mail' },
      { accessorKey: 'role', header: 'Perfil', cell: ({ row }) => profileLabel(row.original.role) },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge tone={row.original.status === 'active' ? 'success' : 'info'}>{row.original.status === 'active' ? 'Ativo' : 'Pendente'}</Badge> },
    ],
    [],
  )

  return (
    <SettingsSection title="Usuários e permissões" description="Gerencie equipe, convites pendentes e acessos por perfil.">
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Input placeholder="E-mail do convite" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | 'todos')} className="h-10 rounded-lg border border-slate-300 px-3 text-sm">
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role === 'todos' ? 'Todos os perfis' : profileLabel(role)}
            </option>
          ))}
        </select>
        <Button disabled={!inviteEmail}>Convidar usuário</Button>
      </div>
      <DataTable data={filtered} columns={columns} getRowId={(row) => row.uid} actions={() => <Button variant="ghost" size="sm">Editar</Button>} />
    </SettingsSection>
  )
}
