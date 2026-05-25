import type { Role, User } from '../types/User'

export type Permission =
  | 'dashboard.read'
  | 'agenda.read'
  | 'agenda.write'
  | 'users.read'
  | 'users.write'
  | 'users.delete'
  | 'dentists.read'
  | 'dentists.write'
  | 'dentists.delete'
  | 'clinics.read'
  | 'clinics.write'
  | 'clinics.delete'
  | 'patients.read'
  | 'patients.write'
  | 'patients.delete'
  | 'scans.read'
  | 'scans.write'
  | 'scans.approve'
  | 'scans.delete'
  | 'cases.read'
  | 'cases.write'
  | 'cases.delete'
  | 'lab.read'
  | 'lab.write'
  | 'docs.read'
  | 'docs.write'
  | 'settings.read'
  | 'settings.write'
  | 'settings.general.read'
  | 'settings.general.write'
  | 'settings.users.read'
  | 'settings.users.write'
  | 'settings.lab.read'
  | 'settings.lab.write'
  | 'settings.notifications.read'
  | 'settings.notifications.write'
  | 'settings.integrations.read'
  | 'settings.integrations.write'
  | 'settings.billing.read'
  | 'settings.billing.write'
  | 'settings.appearance.read'
  | 'settings.appearance.write'
  | 'ai.clinica'
  | 'ai.lab'
  | 'ai.gestao'
  | 'ai.comercial'

export type PermissionModule =
  | 'Painel'
  | 'Agenda'
  | 'Pacientes'
  | 'Exames'
  | 'Alinhadores'
  | 'Laboratório'
  | 'Usuários'
  | 'Configurações'
  | 'Documentos'
  | 'Dentistas'
  | 'Clínicas'
  | 'IA'

export const allPermissions: Permission[] = [
  'dashboard.read',
  'agenda.read',
  'agenda.write',
  'users.read',
  'users.write',
  'users.delete',
  'dentists.read',
  'dentists.write',
  'dentists.delete',
  'clinics.read',
  'clinics.write',
  'clinics.delete',
  'patients.read',
  'patients.write',
  'patients.delete',
  'scans.read',
  'scans.write',
  'scans.approve',
  'scans.delete',
  'cases.read',
  'cases.write',
  'cases.delete',
  'lab.read',
  'lab.write',
  'docs.read',
  'docs.write',
  'settings.read',
  'settings.write',
  'settings.general.read',
  'settings.general.write',
  'settings.users.read',
  'settings.users.write',
  'settings.lab.read',
  'settings.lab.write',
  'settings.notifications.read',
  'settings.notifications.write',
  'settings.integrations.read',
  'settings.integrations.write',
  'settings.billing.read',
  'settings.billing.write',
  'settings.appearance.read',
  'settings.appearance.write',
  'ai.clinica',
  'ai.lab',
  'ai.gestao',
  'ai.comercial',
]

const rolePermissions: Record<Role, Permission[]> = {
  master_admin: allPermissions,
  dentist_admin: allPermissions.filter(
    (perm) =>
      (!perm.endsWith('.delete') || perm === 'users.delete' || perm === 'patients.delete') &&
      perm !== 'dentists.delete' &&
      perm !== 'clinics.delete',
  ),
  dentist_client: ['dashboard.read', 'patients.read', 'patients.write', 'scans.read', 'cases.read', 'docs.read', 'ai.clinica'],
  clinic_client: ['dashboard.read', 'patients.read', 'patients.write', 'scans.read', 'cases.read', 'docs.read', 'ai.clinica', 'ai.comercial'],
  lab_tech: ['lab.read', 'cases.read', 'scans.read', 'ai.lab'],
  receptionist: ['dashboard.read', 'agenda.read', 'agenda.write', 'patients.read', 'patients.write', 'scans.read', 'scans.write', 'cases.read', 'lab.read', 'ai.clinica', 'ai.comercial'],
}

const profileLabels: Record<Role, string> = {
  master_admin: 'Administrador master',
  dentist_admin: 'Administrador dentista',
  dentist_client: 'Dentista Cliente',
  clinic_client: 'Clínica Cliente',
  lab_tech: 'Técnico de laboratório',
  receptionist: 'Recepção',
}

const profileDescriptions: Record<Role, string> = {
  master_admin: 'Acesso total ao sistema e configurações avançadas.',
  dentist_admin: 'Gestão operacional da clínica com permissões administrativas.',
  dentist_client: 'Perfil externo: visualiza e cadastra pacientes vinculados ao dentista.',
  clinic_client: 'Perfil externo: visualiza e cadastra pacientes vinculados à clínica.',
  lab_tech: 'Execução e acompanhamento do fluxo de laboratório.',
  receptionist: 'Suporte de cadastro e atendimento operacional.',
}

const permissionLabels: Record<Permission, string> = {
  'dashboard.read': 'Visualizar painel',
  'agenda.read': 'Visualizar agenda',
  'agenda.write': 'Criar/editar agenda',
  'users.read': 'Visualizar usuários',
  'users.write': 'Cadastrar/editar usuários',
  'users.delete': 'Excluir usuários',
  'dentists.read': 'Visualizar dentistas',
  'dentists.write': 'Cadastrar/editar dentistas',
  'dentists.delete': 'Excluir dentistas',
  'clinics.read': 'Visualizar clínicas',
  'clinics.write': 'Cadastrar/editar clínicas',
  'clinics.delete': 'Excluir clínicas',
  'patients.read': 'Visualizar pacientes',
  'patients.write': 'Cadastrar/editar pacientes',
  'patients.delete': 'Excluir pacientes',
  'scans.read': 'Visualizar escaneamentos',
  'scans.write': 'Enviar escaneamentos',
  'scans.approve': 'Aprovar escaneamentos',
  'scans.delete': 'Excluir escaneamentos',
  'cases.read': 'Visualizar alinhadores',
  'cases.write': 'Criar/editar alinhadores',
  'cases.delete': 'Excluir alinhadores',
  'lab.read': 'Visualizar laboratório',
  'lab.write': 'Gerenciar laboratório',
  'docs.read': 'Visualizar documentos',
  'docs.write': 'Gerenciar documentos',
  'settings.read': 'Visualizar configurações',
  'settings.write': 'Gerenciar configurações',
  'settings.general.read': 'Visualizar dados da clínica',
  'settings.general.write': 'Editar dados da clínica',
  'settings.users.read': 'Visualizar usuários em configurações',
  'settings.users.write': 'Editar usuários em configurações',
  'settings.lab.read': 'Visualizar configurações do laboratório',
  'settings.lab.write': 'Editar configurações do laboratório',
  'settings.notifications.read': 'Visualizar notificações',
  'settings.notifications.write': 'Editar notificações',
  'settings.integrations.read': 'Visualizar integrações',
  'settings.integrations.write': 'Editar integrações',
  'settings.billing.read': 'Visualizar faturamento',
  'settings.billing.write': 'Editar faturamento',
  'settings.appearance.read': 'Visualizar aparência',
  'settings.appearance.write': 'Editar aparência',
  'ai.clinica': 'IA clínica',
  'ai.lab': 'IA laboratório',
  'ai.gestao': 'IA gestão',
  'ai.comercial': 'IA comercial',
}

const permissionModules: Record<Permission, PermissionModule> = {
  'dashboard.read': 'Painel',
  'agenda.read': 'Agenda',
  'agenda.write': 'Agenda',
  'users.read': 'Usuários',
  'users.write': 'Usuários',
  'users.delete': 'Usuários',
  'dentists.read': 'Dentistas',
  'dentists.write': 'Dentistas',
  'dentists.delete': 'Dentistas',
  'clinics.read': 'Clínicas',
  'clinics.write': 'Clínicas',
  'clinics.delete': 'Clínicas',
  'patients.read': 'Pacientes',
  'patients.write': 'Pacientes',
  'patients.delete': 'Pacientes',
  'scans.read': 'Exames',
  'scans.write': 'Exames',
  'scans.approve': 'Exames',
  'scans.delete': 'Exames',
  'cases.read': 'Alinhadores',
  'cases.write': 'Alinhadores',
  'cases.delete': 'Alinhadores',
  'lab.read': 'Laboratório',
  'lab.write': 'Laboratório',
  'docs.read': 'Documentos',
  'docs.write': 'Documentos',
  'settings.read': 'Configurações',
  'settings.write': 'Configurações',
  'settings.general.read': 'Configurações',
  'settings.general.write': 'Configurações',
  'settings.users.read': 'Configurações',
  'settings.users.write': 'Configurações',
  'settings.lab.read': 'Configurações',
  'settings.lab.write': 'Configurações',
  'settings.notifications.read': 'Configurações',
  'settings.notifications.write': 'Configurações',
  'settings.integrations.read': 'Configurações',
  'settings.integrations.write': 'Configurações',
  'settings.billing.read': 'Configurações',
  'settings.billing.write': 'Configurações',
  'settings.appearance.read': 'Configurações',
  'settings.appearance.write': 'Configurações',
  'ai.clinica': 'IA',
  'ai.lab': 'IA',
  'ai.gestao': 'IA',
  'ai.comercial': 'IA',
}

export function isPermission(value: string): value is Permission {
  return (allPermissions as string[]).includes(value)
}

export function normalizePermissions(values: unknown): Permission[] | undefined {
  if (!Array.isArray(values)) return undefined
  const normalized = values.filter((value): value is Permission => typeof value === 'string' && isPermission(value))
  return [...new Set(normalized)]
}

export function can(user: User | null | undefined, permission: Permission) {
  if (!user) return false
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission)
  if (user.role === 'master_admin') return true
  return rolePermissions[user.role]?.includes(permission) ?? false
}

export function permissionsForRole(role: Role) {
  return rolePermissions[role] ?? []
}

export function profileLabel(role: Role) {
  return profileLabels[role] ?? role
}

export function profileDescription(role: Role) {
  return profileDescriptions[role] ?? ''
}

export function permissionLabel(permission: Permission) {
  return permissionLabels[permission] ?? permission
}

export function permissionModule(permission: Permission) {
  return permissionModules[permission] ?? 'Configurações'
}

export function groupedPermissionsForRole(role: Role) {
  return permissionsForRole(role).reduce<Record<PermissionModule, Permission[]>>((acc, permission) => {
    const module = permissionModule(permission)
    const current = acc[module] ?? []
    acc[module] = [...current, permission]
    return acc
  }, {} as Record<PermissionModule, Permission[]>)
}

export function groupedPermissions(permissions: Permission[]) {
  return permissions.reduce<Record<PermissionModule, Permission[]>>((acc, permission) => {
    const module = permissionModule(permission)
    const current = acc[module] ?? []
    acc[module] = [...current, permission]
    return acc
  }, {} as Record<PermissionModule, Permission[]>)
}

