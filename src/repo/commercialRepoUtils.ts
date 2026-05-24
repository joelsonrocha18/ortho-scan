import { db as firestoreDb } from '../lib/firebaseClient'
import type { InventoryUnit } from '../types/Commercial'

export function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

export function asText(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function asNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

export function asInventoryUnit(value: unknown): InventoryUnit {
  if (value === 'un' || value === 'ml' || value === 'g' || value === 'kg' || value === 'l' || value === 'm' || value === 'cm' || value === 'cx' || value === 'pct') {
    return value
  }
  return 'un'
}

export function normalizeText(value?: string | null) {
  return value?.trim() || undefined
}

export function normalizeQuantityForUnit(quantity: number, unit: InventoryUnit) {
  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0
  if (unit === 'un') return Math.round(safeQuantity)
  return Math.round(safeQuantity * 10000) / 10000
}

export function readLocalCollection<T>(key: string): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function writeLocalCollection<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}
