const ORTH_CODE_REGEX = /^ORTH-(\d{5})$/i

export function normalizeOrthTreatmentCode(value?: string) {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(ORTH_CODE_REGEX)
  if (!match) return ''
  return `ORTH-${match[1]}`
}

export function nextOrthTreatmentCode(existingCodes: string[]) {
  const max = existingCodes.reduce((acc, item) => {
    const normalized = normalizeOrthTreatmentCode(item)
    if (!normalized) return acc
    const parsed = Number(normalized.slice(5))
    if (!Number.isFinite(parsed)) return acc
    return Math.max(acc, parsed)
  }, 0)
  return `ORTH-${String(max + 1).padStart(5, '0')}`
}

