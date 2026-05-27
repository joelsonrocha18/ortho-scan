export function nullifyUndefinedDeep<T>(value: T): T {
  if (value === undefined) return null as T
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map((item) => nullifyUndefinedDeep(item)) as T

  const output: Record<string, unknown> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    output[key] = nullifyUndefinedDeep(entry)
  })
  return output as T
}
