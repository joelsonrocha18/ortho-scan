import { supabase } from '../lib/supabaseClient'
import type { SystemSettings } from '../lib/systemSettings'

const SETTINGS_KEY = 'global'

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

export async function loadSystemSettingsSupabase(): Promise<SystemSettings | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle()
  if (error || !data) return null
  const row = asObject(data)
  const value = row.value
  if (!value || typeof value !== 'object') return null
  return withDisabledAi(value as SystemSettings)
}

export async function saveSystemSettingsSupabase(settings: SystemSettings) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: SETTINGS_KEY,
      value: withDisabledAi(settings),
      updated_at: now,
    }, { onConflict: 'key' })
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}


