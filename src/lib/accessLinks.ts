import type { Case } from '../types/Case'
import { buildWhatsappUrl, isValidWhatsapp } from './whatsapp'

type PatientPortalShareInput = {
  patientName?: string
  accessCode?: string
  whatsapp?: string
  originOverride?: string
}

type PatientPortalMessageInput = Omit<PatientPortalShareInput, 'whatsapp'>

type DentistPortalShareInput = {
  dentistName?: string
  whatsapp?: string
  email?: string
  originOverride?: string
}

type DentistPortalMessageInput = Omit<DentistPortalShareInput, 'whatsapp'>

function normalizeOrigin(origin?: string) {
  const trimmed = origin?.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

export function getPublicAppOrigin(originOverride?: string) {
  const override = normalizeOrigin(originOverride)
  if (override) return override

  const envOrigin = normalizeOrigin(import.meta.env.VITE_APP_URL)
  if (envOrigin) return envOrigin

  if (typeof window !== 'undefined' && window.location.origin) {
    return normalizeOrigin(window.location.origin)
  }

  return ''
}

export function resolvePublicAccessUrl(path: string, originOverride?: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const origin = getPublicAppOrigin(originOverride)
  return origin ? `${origin}${normalizedPath}` : normalizedPath
}

export function resolvePatientPortalAccessCode(caseItem?: Pick<Case, 'treatmentCode' | 'shortId' | 'id'> | null) {
  if (!caseItem) return ''
  return (caseItem.treatmentCode ?? caseItem.shortId ?? caseItem.id ?? '').trim().toUpperCase()
}

export function buildPatientPortalWhatsappMessage({
  patientName,
  accessCode,
  originOverride,
}: PatientPortalMessageInput) {
  const normalizedCode = accessCode?.trim().toUpperCase()
  if (!normalizedCode) return ''

  const portalUrl = resolvePublicAccessUrl('/acesso/pacientes', originOverride)
  const greeting = patientName?.trim() ? `Ola, ${patientName.trim()}.` : 'Ola.'
  return [
    `${greeting} Este e o acesso do seu portal Orthoscan.`,
    `Link: ${portalUrl}`,
    `Codigo do tratamento: ${normalizedCode}`,
    'Use com seu CPF e data de nascimento.',
  ].join('\n')
}

export function buildPatientPortalWhatsappHref({
  patientName,
  accessCode,
  whatsapp,
  originOverride,
}: PatientPortalShareInput) {
  if (!whatsapp || !isValidWhatsapp(whatsapp)) return ''
  const normalizedCode = accessCode?.trim().toUpperCase()
  if (!normalizedCode) return ''

  const baseUrl = buildWhatsappUrl(whatsapp)
  if (!baseUrl) return ''

  const message = buildPatientPortalWhatsappMessage({ patientName, accessCode: normalizedCode, originOverride })
  return `${baseUrl}?text=${encodeURIComponent(message)}`
}

export function buildDentistPortalWhatsappMessage({
  dentistName,
  email,
  originOverride,
}: DentistPortalMessageInput) {
  const portalUrl = resolvePublicAccessUrl('/acesso/dentistas', originOverride)
  const greeting = dentistName?.trim() ? `Ola, ${dentistName.trim()}.` : 'Ola.'
  const emailLine = email?.trim() ? `Email de acesso: ${email.trim()}` : 'Use seu email profissional cadastrado.'
  return [
    `${greeting} Este e o acesso do portal do parceiro Orthoscan.`,
    `Link: ${portalUrl}`,
    emailLine,
    'A senha permanece a mesma cadastrada no sistema.',
  ].join('\n')
}

export function buildDentistPortalWhatsappHref({
  dentistName,
  whatsapp,
  email,
  originOverride,
}: DentistPortalShareInput) {
  if (!whatsapp || !isValidWhatsapp(whatsapp)) return ''

  const baseUrl = buildWhatsappUrl(whatsapp)
  if (!baseUrl) return ''

  const message = buildDentistPortalWhatsappMessage({ dentistName, email, originOverride })
  return `${baseUrl}?text=${encodeURIComponent(message)}`
}
