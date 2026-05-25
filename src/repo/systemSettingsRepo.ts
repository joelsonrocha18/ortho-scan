import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'
import type { SystemSettings } from '../lib/systemSettings'

const SETTINGS_KEY = 'global'
const COLLECTION = 'app_settings'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function withDisabledAi(settings: SystemSettings): SystemSettings {
  return {
    ...settings,
    aiGateway: {
      enabled: false,
      modules: {
        clinica: false,
        lab: false,
        gestao: false,
        comercial: false,
      },
      provider: 'mock',
      model: 'gpt-4.1-mini',
      apiBaseUrl: '',
      apiKey: '',
    },
    whatsappService: settings.whatsappService ?? {
      enabled: false,
      baseUrl: '',
      adminToken: '',
    },
  }
}

function getFirestore() {
  if (!firestoreDb) return null
  return firestoreDb
}

export async function loadSystemSettingsRemote(): Promise<SystemSettings | null> {
  const firestore = getFirestore()
  if (!firestore) return null
  const snapshot = await getDoc(doc(firestore, COLLECTION, SETTINGS_KEY))
  if (!snapshot.exists()) return null
  const row = asObject(snapshot.data())
  const value = row.value
  if (!value || typeof value !== 'object') return null
  return withDisabledAi(value as SystemSettings)
}

export async function saveSystemSettingsRemote(settings: SystemSettings) {
  const firestore = getFirestore()
  if (!firestore) return { ok: false as const, error: 'Firebase não configurado.' }
  const now = new Date().toISOString()
  try {
    await setDoc(
      doc(firestore, COLLECTION, SETTINGS_KEY),
      {
        key: SETTINGS_KEY,
        value: withDisabledAi(settings),
        updated_at: now,
      },
      { merge: true },
    )
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao salvar configurações.'
    return { ok: false as const, error: message }
  }
}
