export type DataMode = 'local' | 'firebase'

function resolveDataMode(): DataMode {
  const raw = (import.meta.env.VITE_DATA_MODE as string | undefined)?.trim().toLowerCase()
  if (raw === 'local') return 'local'
  return 'firebase'
}

export const DATA_MODE: DataMode = resolveDataMode()
