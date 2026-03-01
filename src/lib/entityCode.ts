function numericFromId(id: string) {
  const input = (id || '').trim()
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000000
  }
  return String(hash).padStart(6, '0')
}

export function patientCode(id: string, shortId?: string) {
  if (shortId?.trim()) return shortId
  return `P${numericFromId(id)}`
}

export function dentistCode(id: string, shortId?: string) {
  if (shortId?.trim()) return shortId
  return `D${numericFromId(id)}`
}

export function clinicCode(id: string, shortId?: string) {
  if (shortId?.trim()) return shortId
  return `C${numericFromId(id)}`
}
