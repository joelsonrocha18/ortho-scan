import { supabase } from '../lib/supabaseClient'
import type { Role } from '../types/User'
import { getSupabaseAccessToken } from '../lib/auth'
import { getAuthProvider } from '../auth/authProvider'

function normalizeInviteErrorMessage(raw: string) {
  const text = (raw || '').toLowerCase()
  if (text.includes('duplicate') || text.includes('already exists') || text.includes('já existe')) {
    return 'Já existe cadastro com os dados informados.'
  }
  if (text.includes('permission') || text.includes('unauthorized') || text.includes('forbidden')) {
    return 'Sem permissão para gerar convite. Faça login novamente como admin master.'
  }
  if (text.includes('invalid jwt') || text.includes('sessao') || text.includes('session')) {
    return 'Sessão expirada. Saia e entre novamente.'
  }
  return raw || 'Falha ao gerar convite.'
}

export async function createOnboardingInvite(payload: {
  fullName: string
  cpf?: string
  phone?: string
  role: Role
  clinicId: string
  dentistId?: string
}) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }

  // In production, Edge Functions that change data require the user's JWT (not the anon key).
  let accessToken = ''
  const { data: sessionData } = await supabase.auth.getSession()
  accessToken = sessionData.session?.access_token ?? ''
  const expiresAt = sessionData.session?.expires_at ?? 0
  const isExpiredOrNear = !expiresAt || (expiresAt * 1000) <= (Date.now() + 60_000)

  if (!accessToken || isExpiredOrNear) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    accessToken = refreshed.session?.access_token ?? ''
  }

  if (!accessToken) {
    await getAuthProvider().getCurrentUser()
    accessToken = getSupabaseAccessToken() ?? ''
  }

  if (!accessToken) return { ok: false as const, error: 'Sessão expirada. Saia e entre novamente.' }
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!anonKey) return { ok: false as const, error: 'Supabase anon key ausente no build.' }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) return { ok: false as const, error: 'Supabase URL ausente no build.' }

  let data: { inviteId?: string; inviteLink?: string } | null = null
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/create-onboarding-invite`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'x-user-jwt': accessToken,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, userJwt: accessToken }),
    })
    data = (await response.json().catch(() => null)) as { inviteId?: string; inviteLink?: string; error?: string } | null
    if (!response.ok || !data || (data as { error?: string }).error) {
      const rawError = (data as { error?: string } | null)?.error ?? `Falha ao gerar convite (HTTP ${response.status}).`
      return { ok: false as const, error: normalizeInviteErrorMessage(rawError) }
    }
  } catch (networkError) {
    return { ok: false as const, error: `Falha de rede ao gerar convite: ${networkError instanceof Error ? networkError.message : String(networkError)}` }
  }

  return {
    ok: true as const,
    inviteId: data?.inviteId as string | undefined,
    inviteLink: data?.inviteLink as string | undefined,
  }
}

export async function validateOnboardingInvite(token: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!anonKey) return { ok: false as const, error: 'Supabase anon key ausente no build.' }
  const { data, error } = await supabase.functions.invoke('validate-onboarding-invite', {
    body: { token },
    // Force anon auth so this works even if a user is currently logged in (ES256 session JWT breaks gateway auth).
    headers: { Authorization: `Bearer ${anonKey}` },
  })
  if (error) return { ok: false as const, error: error.message, expired: false, used: false }
  if (!data?.ok) {
    return {
      ok: false as const,
      error: (data?.error as string | undefined) ?? 'Convite inválido.',
      expired: Boolean(data?.expired),
      used: Boolean(data?.used),
    }
  }
  return {
    ok: true as const,
    preview: data.preview as { fullName: string; role: string; roleLabel: string; clinicName: string },
  }
}

export async function completeOnboardingInvite(payload: {
  token: string
  email: string
  password: string
  fullName?: string
  dentist?: {
    name?: string
    gender?: 'masculino' | 'feminino'
    cro?: string
    phone?: string
    whatsapp?: string
    email?: string
    notes?: string
  }
}) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!anonKey) return { ok: false as const, error: 'Supabase anon key ausente no build.' }
  const { data, error } = await supabase.functions.invoke('complete-onboarding-invite', {
    body: payload,
    headers: { Authorization: `Bearer ${anonKey}` },
  })
  if (error) return { ok: false as const, error: error.message }
  if (!data?.ok) {
    return { ok: false as const, error: (data?.error as string | undefined) ?? 'Falha ao concluir cadastro.' }
  }
  return { ok: true as const }
}


