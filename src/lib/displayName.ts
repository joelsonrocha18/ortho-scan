import type { DentistClinic } from '../types/DentistClinic'
import type { User } from '../types/User'

function hasDoctorPrefix(name: string) {
  return /^dr\.?\s|^dra\.?\s/i.test(name.trim())
}

export function formatUserDisplayName(user: User | null, dentists: DentistClinic[]) {
  if (!user) return ''
  const rawName = user.name?.trim() || user.email?.trim() || ''
  if (!rawName) return ''
  if (hasDoctorPrefix(rawName)) return rawName

  const linkedDentist = user.linkedDentistId
    ? dentists.find((item) => item.id === user.linkedDentistId && item.type === 'dentista')
    : undefined
  const isDentistRole = user.role === 'dentist_admin' || user.role === 'dentist_client'
  const hasCro = Boolean(linkedDentist?.cro?.trim())
  if (!isDentistRole && !hasCro) return rawName

  const prefix = linkedDentist?.gender === 'feminino' ? 'Dra.' : 'Dr.'
  return `${prefix} ${rawName}`
}
