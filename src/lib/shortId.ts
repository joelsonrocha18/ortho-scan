type MatchableCode = string | undefined | null

export function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase()
}

export function matchesFriendlyCode(query: string, ...codes: MatchableCode[]) {
  const normalized = normalizeSearchTerm(query)
  if (!normalized) return true
  return codes.some((code) => (code ?? '').toLowerCase().includes(normalized))
}

export function clinicCodePrefix(shortId?: string) {
  return (shortId ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
}
