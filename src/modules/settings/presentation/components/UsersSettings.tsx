import { useEffect, useMemo, useState } from 'react'
import { Mail, PenLine, Power, RefreshCw, RotateCcw, Save, Trash2, UserPlus, X } from 'lucide-react'
import { useToast } from '../../../../app/ToastProvider'
import {
  allPermissions,
  can,
  groupedPermissions,
  normalizePermissions,
  permissionLabel,
  permissionsForRole,
  profileDescription,
  profileLabel,
  type Permission,
  type PermissionModule,
} from '../../../../auth/permissions'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import { DATA_MODE } from '../../../../data/dataMode'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import {
  createFirebaseProfile,
  listFirebaseProfiles,
  sendFirebasePasswordReset,
  setFirebaseProfileActive,
  softDeleteFirebaseProfile,
  updateFirebaseProfile,
} from '../../../../repo/firebaseProfileRepo'
import { createUser, listUsers, resetUserPassword, setUserActive, softDeleteUser, updateUser } from '../../../../repo/userRepo'
import type { Role, User } from '../../../../types/User'
import SettingsSection from './SettingsSection'

type RoleFilter = Role | 'todos'
type UserForm = {
  name: string
  email: string
  password: string
  cpf: string
  phone: string
  role: Role
  permissions: Permission[]
  isActive: boolean
}

const roleOptions: Role[] = ['master_admin', 'dentist_admin', 'dentist_client', 'clinic_client', 'lab_tech', 'receptionist']
const moduleOrder: PermissionModule[] = ['Painel', 'Agenda', 'Pacientes', 'Exames', 'Alinhadores', 'Preços', 'Estoque', 'Contratos', 'Laboratório', 'Dentistas', 'Clínicas', 'Usuários', 'Documentos', 'Configurações', 'IA']

function generatePassword(size = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  return Array.from({ length: size }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function emptyForm(): UserForm {
  const role: Role = 'receptionist'
  return {
    name: '',
    email: '',
    password: generatePassword(),
    cpf: '',
    phone: '',
    role,
    permissions: permissionsForRole(role),
    isActive: true,
  }
}

function formFromUser(user: User): UserForm {
  const permissions = normalizePermissions(user.permissions) ?? permissionsForRole(user.role)
  return {
    name: user.name,
    email: user.email,
    password: '',
    cpf: user.cpf ?? '',
    phone: user.whatsapp ?? user.phone ?? '',
    role: user.role,
    permissions,
    isActive: user.isActive,
  }
}

function resultError(result: { ok: true } | { ok: false; error: string }) {
  return result.ok ? '' : result.error
}

export default function UsersSettings() {
  const { db, refresh } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const isFirebaseMode = DATA_MODE === 'firebase'
  const canManageUsers = can(currentUser, 'settings.users.write') || can(currentUser, 'users.write')
  const canDeleteUsers = can(currentUser, 'users.delete')

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos')
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<UserForm>(() => emptyForm())

  const permissionGroups = useMemo(() => groupedPermissions(allPermissions), [])
  const selectedPermissionSet = useMemo(() => new Set(form.permissions), [form.permissions])
  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter !== 'todos' && user.role !== roleFilter) return false
      if (!term) return true
      return [user.name, user.email, profileLabel(user.role)].some((value) => value.toLowerCase().includes(term))
    })
  }, [roleFilter, search, users])

  const reloadUsers = async () => {
    setLoading(true)
    try {
      if (isFirebaseMode) {
        setUsers(await listFirebaseProfiles())
      } else {
        setUsers(listUsers())
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Falha ao carregar usuários',
        message: error instanceof Error ? error.message : 'Não foi possível carregar os usuários.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reloadUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirebaseMode])

  const openNewUser = () => {
    setEditingUser(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  const openEditUser = (user: User) => {
    setEditingUser(user)
    setForm(formFromUser(user))
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingUser(null)
    setForm(emptyForm())
  }

  const setRole = (role: Role) => {
    setForm((current) => ({ ...current, role, permissions: permissionsForRole(role) }))
  }

  const setPermissionAllowed = (permission: Permission, allowed: boolean) => {
    setForm((current) => {
      const next = new Set(current.permissions)
      if (allowed) next.add(permission)
      else next.delete(permission)
      return { ...current, permissions: allPermissions.filter((item) => next.has(item)) }
    })
  }

  const resetPermissions = () => {
    setForm((current) => ({ ...current, permissions: permissionsForRole(current.role) }))
  }

  const saveUser = async () => {
    if (!canManageUsers) return
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    if (!name) return addToast({ type: 'error', title: 'Informe o nome do usuário.' })
    if (!email) return addToast({ type: 'error', title: 'Informe o e-mail do usuário.' })
    if (!editingUser && !form.password.trim()) return addToast({ type: 'error', title: 'Informe uma senha temporária.' })

    setSaving(true)
    try {
      if (isFirebaseMode) {
        const result = editingUser
          ? await updateFirebaseProfile(editingUser.id, {
              fullName: name,
              cpf: form.cpf.trim() || null,
              phone: form.phone.trim() || null,
              role: form.role,
              permissions: form.permissions,
              isActive: form.isActive,
            })
          : await createFirebaseProfile({
              email,
              password: form.password,
              fullName: name,
              cpf: form.cpf,
              phone: form.phone,
              role: form.role,
              permissions: form.permissions,
            })
        if (!result.ok) throw new Error(resultError(result))
      } else if (editingUser) {
        const result = updateUser(editingUser.id, {
          name,
          email,
          cpf: form.cpf,
          phone: form.phone,
          whatsapp: form.phone,
          role: form.role,
          permissions: form.permissions,
          isActive: form.isActive,
        })
        if (!result.ok) throw new Error(result.error)
        refresh()
      } else {
        const result = createUser({
          name,
          email,
          password: form.password,
          cpf: form.cpf,
          phone: form.phone,
          whatsapp: form.phone,
          role: form.role,
          permissions: form.permissions,
          isActive: form.isActive,
        })
        if (!result.ok) throw new Error(result.error)
        refresh()
      }

      addToast({ type: 'success', title: editingUser ? 'Usuário atualizado' : 'Usuário criado' })
      closeForm()
      await reloadUsers()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Falha ao salvar usuário',
        message: error instanceof Error ? error.message : 'Não foi possível salvar o usuário.',
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (user: User) => {
    if (!canManageUsers) return
    const nextActive = !user.isActive
    const result = isFirebaseMode ? await setFirebaseProfileActive(user.id, nextActive) : setUserActive(user.id, nextActive)
    if (!result.ok) return addToast({ type: 'error', title: 'Falha ao alterar status', message: result.error })
    addToast({ type: 'success', title: nextActive ? 'Usuário ativado' : 'Usuário pausado' })
    refresh()
    await reloadUsers()
  }

  const deleteUser = async (user: User) => {
    if (!canDeleteUsers || !window.confirm(`Excluir ${user.name}?`)) return
    const result = isFirebaseMode ? await softDeleteFirebaseProfile(user.id) : softDeleteUser(user.id)
    if (!result.ok) return addToast({ type: 'error', title: 'Falha ao excluir usuário', message: result.error })
    addToast({ type: 'success', title: 'Usuário excluído' })
    refresh()
    await reloadUsers()
  }

  const sendReset = async (user: User) => {
    if (!canManageUsers) return
    if (isFirebaseMode) {
      const result = await sendFirebasePasswordReset(user.email)
      if (!result.ok) return addToast({ type: 'error', title: 'Falha ao enviar e-mail', message: result.error })
      return addToast({ type: 'success', title: 'Redefinição enviada' })
    }
    const result = resetUserPassword(user.id, generatePassword())
    if (!result.ok) return addToast({ type: 'error', title: 'Falha ao redefinir senha', message: result.error })
    refresh()
    addToast({ type: 'success', title: 'Senha temporária atualizada' })
  }

  return (
    <SettingsSection
      title="Usuários"
      description="Gerencie cadastro, status e permissões por usuário."
      actions={canManageUsers ? (
        <Button onClick={openNewUser}>
          <UserPlus className="mr-2 h-4 w-4" />
          Novo usuário
        </Button>
      ) : null}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <Input placeholder="Buscar por nome, e-mail ou perfil" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} className="h-10 rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950">
            <option value="todos">Todos os perfis</option>
            {roleOptions.map((role) => <option key={role} value={role}>{profileLabel(role)}</option>)}
          </select>
          <Button variant="secondary" onClick={() => void reloadUsers()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        </div>

        {formOpen ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-950">{editingUser ? 'Editar usuário' : 'Cadastrar usuário'}</h3>
                <p className="mt-1 text-sm text-slate-600">{profileDescription(form.role)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={resetPermissions}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restaurar padrão
                </Button>
                <Button variant="ghost" onClick={closeForm}>
                  <X className="mr-2 h-4 w-4" />
                  Fechar
                </Button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <label className="block text-sm font-medium text-slate-700">
                  Nome
                  <Input className="mt-1" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  E-mail
                  <Input className="mt-1" value={form.email} disabled={Boolean(editingUser)} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </label>
                {!editingUser ? (
                  <label className="block text-sm font-medium text-slate-700">
                    Senha temporária
                    <Input className="mt-1" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
                  </label>
                ) : null}
                <label className="block text-sm font-medium text-slate-700">
                  CPF
                  <Input className="mt-1" value={form.cpf} onChange={(event) => setForm((current) => ({ ...current, cpf: event.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Telefone/WhatsApp
                  <Input className="mt-1" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Perfil
                  <select value={form.role} onChange={(event) => setRole(event.target.value as Role)} className="mt-1 h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950">
                    {roleOptions.map((role) => <option key={role} value={role}>{profileLabel(role)}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
                  Usuário ativo
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">Permissões do usuário</h4>
                    <p className="text-xs text-slate-500">{form.permissions.length} de {allPermissions.length} permissões liberadas</p>
                  </div>
                </div>
                <div className="max-h-[min(56vh,560px)] overflow-y-auto">
                  {moduleOrder.filter((module) => (permissionGroups[module] ?? []).length > 0).map((module) => (
                    <div key={module} className="border-b border-slate-100 last:border-b-0">
                      <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-50 px-4 py-2">
                        <span className="text-xs font-semibold uppercase text-slate-600">{module}</span>
                        <Badge tone="info">{(permissionGroups[module] ?? []).filter((permission) => selectedPermissionSet.has(permission)).length}/{(permissionGroups[module] ?? []).length}</Badge>
                      </div>
                      {(permissionGroups[module] ?? []).map((permission) => {
                        const allowed = selectedPermissionSet.has(permission)
                        return (
                          <div key={permission} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800">{permissionLabel(permission)}</p>
                              <p className="break-all text-xs text-slate-500">{permission}</p>
                            </div>
                            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                              <button
                                type="button"
                                aria-pressed={allowed}
                                onClick={() => setPermissionAllowed(permission, true)}
                                className={[
                                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                                  allowed ? 'bg-olive-600 text-white' : 'text-slate-600 hover:bg-white',
                                ].join(' ')}
                              >
                                Permitir
                              </button>
                              <button
                                type="button"
                                aria-pressed={!allowed}
                                onClick={() => setPermissionAllowed(permission, false)}
                                className={[
                                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                                  !allowed ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-white',
                                ].join(' ')}
                              >
                                Não permitir
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={() => void saveUser()} disabled={saving || !canManageUsers}>
                <Save className="mr-2 h-4 w-4" />
                Salvar usuário
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Permissões</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-baby-50/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{profileLabel(user.role)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'Ativo' : 'Pausado'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{(user.permissions ?? permissionsForRole(user.role)).length}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditUser(user)} disabled={!canManageUsers} title="Editar usuário">
                        <PenLine className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void sendReset(user)} disabled={!canManageUsers} title="Enviar redefinição de senha">
                        <Mail className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void toggleActive(user)} disabled={!canManageUsers} title={user.isActive ? 'Pausar usuário' : 'Ativar usuário'}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void deleteUser(user)} disabled={!canDeleteUsers} title="Excluir usuário" className="text-red-700 hover:text-red-800">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">Nenhum usuário encontrado.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">Carregando usuários...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsSection>
  )
}
