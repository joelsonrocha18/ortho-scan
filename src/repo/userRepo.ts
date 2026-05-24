import { loadDb, saveDb } from '../data/db'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { AccessMethod, Role, User } from '../types/User'

export function listUsers(includeDeleted = false) {
  return loadDb()
    .users.filter((user) => (includeDeleted ? true : !user.deletedAt))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getUser(id: string) {
  return loadDb().users.find((user) => user.id === id) ?? null
}

export function createUser(payload: {
  name: string
  accessMethod?: AccessMethod
  username?: string
  email: string
  password: string
  cpf?: string
  cep?: string
  birthDate?: string
  phone?: string
  whatsapp?: string
  addressLine?: string
  role: Role
  isActive: boolean
  linkedDentistId?: string
  linkedClinicId?: string
}) {
  const db = loadDb()
  if (!payload.name.trim()) return { ok: false as const, error: 'Nome é obrigatório.' }
  if (!payload.email.trim()) return { ok: false as const, error: 'E-mail é obrigatório.' }
  if (!payload.password.trim()) return { ok: false as const, error: 'Senha é obrigatória.' }
  const duplicated = db.users.find((user) => user.email.toLowerCase() === payload.email.trim().toLowerCase())
  if (duplicated) return { ok: false as const, error: 'E-mail já cadastrado.' }

  const now = nowIsoDateTime()
  const user: User = {
    id: createEntityId('user'),
    name: payload.name.trim(),
    accessMethod: payload.accessMethod ?? (payload.username?.trim() ? 'username' : 'email'),
    username: payload.username?.trim() || undefined,
    email: payload.email.trim(),
    password: payload.password,
    cpf: payload.cpf?.trim() || undefined,
    cep: payload.cep?.trim() || undefined,
    birthDate: payload.birthDate || undefined,
    phone: payload.phone?.trim() || undefined,
    whatsapp: payload.whatsapp?.trim() || undefined,
    addressLine: payload.addressLine?.trim() || undefined,
    role: payload.role,
    isActive: payload.isActive,
    linkedDentistId: payload.linkedDentistId,
    linkedClinicId: payload.linkedClinicId,
    createdAt: now,
    updatedAt: now,
  }

  db.users = [user, ...db.users]
  saveDb(db)
  return { ok: true as const, user }
}

export function updateUser(id: string, patch: Partial<User>) {
  const db = loadDb()
  const current = db.users.find((user) => user.id === id)
  if (!current) return { ok: false as const, error: 'Usuário não encontrado.' }

  const next: User = {
    ...current,
    ...patch,
    name: patch.name ? patch.name.trim() : current.name,
    email: patch.email ? patch.email.trim() : current.email,
    password: typeof patch.password === 'string' ? patch.password : current.password,
    cpf: patch.cpf ? patch.cpf.trim() : current.cpf,
    cep: patch.cep ? patch.cep.trim() : current.cep,
    username: patch.username ? patch.username.trim() : current.username,
    phone: patch.phone ? patch.phone.trim() : current.phone,
    whatsapp: patch.whatsapp ? patch.whatsapp.trim() : current.whatsapp,
    addressLine: patch.addressLine ? patch.addressLine.trim() : current.addressLine,
    updatedAt: nowIsoDateTime(),
  }

  db.users = db.users.map((user) => (user.id === id ? next : user))
  saveDb(db)
  return { ok: true as const, user: next }
}

export function resetUserPassword(id: string, password: string) {
  if (!password.trim()) return { ok: false as const, error: 'Senha temporária inválida.' }
  return updateUser(id, { password })
}

export function setUserActive(id: string, isActive: boolean) {
  const current = getUser(id)
  if (current?.role === 'master_admin') return { ok: false as const, error: 'Não é permitido desativar o administrador master.' }
  return updateUser(id, { isActive })
}

export function softDeleteUser(id: string) {
  const db = loadDb()
  const current = db.users.find((user) => user.id === id)
  if (!current) return { ok: false as const, error: 'Usuário não encontrado.' }
  if (current.role === 'master_admin') return { ok: false as const, error: 'Não é permitido excluir o administrador master.' }

  db.users = db.users.map((user) =>
    user.id === id ? { ...user, deletedAt: nowIsoDateTime(), isActive: false, updatedAt: nowIsoDateTime() } : user,
  )
  saveDb(db)
  return { ok: true as const }
}

export function restoreUser(id: string) {
  const db = loadDb()
  const current = db.users.find((user) => user.id === id)
  if (!current) return { ok: false as const, error: 'Usuário não encontrado.' }

  db.users = db.users.map((user) =>
    user.id === id ? { ...user, deletedAt: undefined, isActive: true, updatedAt: nowIsoDateTime() } : user,
  )
  saveDb(db)
  return { ok: true as const }
}
