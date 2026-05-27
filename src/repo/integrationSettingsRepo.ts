import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'
import { nullifyUndefinedDeep } from '../shared/utils/firestore'
import type { Integration } from '../modules/settings/presentation/types'

export type IntegrationConfig = Record<string, string>

export type IntegrationLog = {
  id: string
  at: string
  message: string
}

export type IntegrationSetting = Omit<Integration, 'config' | 'last_sync'> & {
  config: IntegrationConfig
  lastSync?: string
  logs: IntegrationLog[]
}

const COLLECTION = 'integration_settings'

function getFirestore() {
  return firestoreDb
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asStatus(value: unknown): Integration['status'] {
  if (value === 'connected' || value === 'disconnected' || value === 'error') return value
  return 'disconnected'
}

function asType(value: unknown): Integration['type'] {
  if (value === 'erp' || value === 'scanner' || value === 'payment' || value === 'messaging' || value === 'cloud') return value
  return 'scanner'
}

function asConfig(value: unknown): IntegrationConfig {
  const row = asObject(value)
  return Object.fromEntries(
    Object.entries(row)
      .filter(([, entry]) => typeof entry === 'string')
      .map(([key, entry]) => [key, String(entry)]),
  )
}

function asLogs(value: unknown): IntegrationLog[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asObject(entry))
        .map((entry) => ({
          id: asText(entry.id) ?? `log_${Date.now()}`,
          at: asText(entry.at) ?? new Date().toISOString(),
          message: asText(entry.message) ?? 'Evento sem descrição.',
        }))
    : []
}

function mapIntegrationSetting(id: string, data: Record<string, unknown>): IntegrationSetting {
  return {
    id: asText(data.id) ?? id,
    name: asText(data.name) ?? id,
    type: asType(data.type),
    status: asStatus(data.status),
    config: asConfig(data.config),
    lastSync: asText(data.lastSync) ?? asText(data.last_sync),
    logs: asLogs(data.logs),
  }
}

function toFirestoreDocument(integration: IntegrationSetting) {
  return nullifyUndefinedDeep({
    id: integration.id,
    name: integration.name,
    type: integration.type,
    status: integration.status,
    config: integration.config,
    last_sync: integration.lastSync ?? null,
    logs: integration.logs,
    updated_at: new Date().toISOString(),
  })
}

export async function listIntegrationSettingsRemote() {
  const firestore = getFirestore()
  if (!firestore) return { ok: false as const, error: 'Firebase não configurado.' }
  try {
    const snapshot = await getDocs(collection(firestore, COLLECTION))
    return { ok: true as const, integrations: snapshot.docs.map((item) => mapIntegrationSetting(item.id, item.data())) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao carregar integrações.'
    return { ok: false as const, error: message }
  }
}

export async function saveIntegrationSettingRemote(integration: IntegrationSetting) {
  const firestore = getFirestore()
  if (!firestore) return { ok: false as const, error: 'Firebase não configurado.' }
  try {
    await setDoc(doc(firestore, COLLECTION, integration.id), toFirestoreDocument(integration), { merge: true })
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao salvar integração.'
    return { ok: false as const, error: message }
  }
}
