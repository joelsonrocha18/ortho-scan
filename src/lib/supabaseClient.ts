import { createClient } from '@supabase/supabase-js'
import { DATA_MODE } from '../data/dataMode'
import { logger } from './logger'
import {
  clearLegacyPersistentAuthStorage,
  createSessionStorageAdapter,
  SUPABASE_SESSION_STORAGE_KEY,
} from './authStorage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

clearLegacyPersistentAuthStorage()

export const supabase =
  DATA_MODE === 'supabase' && (!supabaseUrl || !supabaseAnonKey)
    ? (logger.error('Supabase env vars ausentes. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.', {
        dataMode: DATA_MODE,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      }), null)
    : supabaseUrl && supabaseAnonKey
      ? createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            storageKey: SUPABASE_SESSION_STORAGE_KEY,
            storage: createSessionStorageAdapter(),
          },
        })
      : null
