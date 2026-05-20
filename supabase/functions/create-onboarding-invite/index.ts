import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  fullName: string
  cpf?: string
  phone?: string
  role: string
  clinicId: string
  dentistId?: string
  userJwt?: string
}

const APP_ROLES = new Set([
  'master_admin',
  'dentist_admin',
  'dentist_client',
  'clinic_client',
  'lab_tech',
  'receptionist',
])

function resolveAllowedOrigin(req: Request) {
  const configured = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim()
  const allowedOrigins = configured
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim()
  if (siteUrl) {
    try {
      const siteOrigin = new URL(siteUrl).origin
      if (!allowedOrigins.includes(siteOrigin)) allowedOrigins.push(siteOrigin)
    } catch {
      // Ignore invalid SITE_URL and fall back to ALLOWED_ORIGIN.
    }
  }
  const requestOrigin = (req.headers.get('origin') ?? '').replace(/\/$/, '')
  if (allowedOrigins.includes('*')) return requestOrigin || '*'
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin
  return allowedOrigins[0] ?? 'null'
}

function corsHeaders(req: Request) {
  const origin = resolveAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin,
    // `x-user-jwt` carries the authenticated user's access token (ES256) because the Functions gateway
    // rejeita no header padrão `Authorization` como "Invalid JWT". Mantemos `Authorization` como anon.
    'Access-Control-Allow-Headers': 'authorization, x-user-jwt, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  // Use our own secret, since some Supabase-provided env keys are not available/consistent across plans.
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''
  const siteUrl = Deno.env.get('SITE_URL') ?? ''

  if (!supabaseUrl || !serviceRoleKey || !siteUrl) {
    return json(req, { ok: false, error: 'SUPABASE_URL, SERVICE_ROLE_KEY ou SITE_URL ausente.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // The Functions gateway must receive `Authorization: Bearer <anon>` when the project issues ES256 JWTs.
  // We pass the authenticated user access token via `x-user-jwt` and validate it explicitly here.
  const payload = (await req.json()) as Payload
  const bodyJwt = typeof payload.userJwt === 'string' ? payload.userJwt.trim() : ''
  const headerJwt = (req.headers.get('x-user-jwt') ?? '').replace(/^Bearer\\s+/i, '').trim()
  const userJwt = bodyJwt || headerJwt
  if (!payload.fullName?.trim() || !payload.role?.trim() || !payload.clinicId?.trim()) {
    return json(req, { ok: false, error: 'fullName, role ou clinicId ausente.' }, 400)
  }
  if (!APP_ROLES.has(payload.role)) {
    return json(req, { ok: false, error: 'Perfil inválido.' }, 400)
  }

  const {
    data: { user: actor },
    error: actorError,
  } = await supabase.auth.getUser(userJwt)

  if (actorError || !actor) return json(req, { ok: false, error: 'Unauthorized.' }, 401)

  const { data: actorProfile } = await supabase
    .from('profiles')
    .select('role, clinic_id')
    .eq('user_id', actor.id)
    .maybeSingle()

  const actorRole = actorProfile?.role ?? 'dentist_client'
  if (!['master_admin', 'dentist_admin'].includes(actorRole)) {
    return json(req, { ok: false, error: 'Forbidden.' }, 403)
  }

  let targetClinicId = payload.clinicId
  if (actorRole === 'dentist_admin') {
    if (!actorProfile?.clinic_id) return json(req, { ok: false, error: 'Clínica ausente para este usuário.' }, 403)
    targetClinicId = actorProfile.clinic_id
  }

  if (actorRole === 'dentist_admin' && ['master_admin', 'dentist_admin'].includes(payload.role)) {
    return json(req, { ok: false, error: 'Perfil não permitido para este usuário.' }, 403)
  }

  const inviteWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count: recentInvites } = await supabase
    .from('security_audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'onboarding_invite_created')
    .eq('actor_user_id', actor.id)
    .gte('created_at', inviteWindowStart)
  if ((recentInvites ?? 0) >= 20) {
    return json(req, { ok: false, error: 'Rate limit exceeded. Try again later.' }, 429)
  }

  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error: insertError } = await supabase
    .from('user_onboarding_invites')
    .insert({
      token_hash: tokenHash,
      role: payload.role,
      clinic_id: targetClinicId,
      dentist_id: payload.dentistId ?? null,
      full_name: payload.fullName.trim(),
      cpf: payload.cpf?.trim() || null,
      phone: payload.phone?.trim() || null,
      created_by: actor.id,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (insertError || !invite) {
    return json(req, { ok: false, error: insertError?.message ?? 'Falha ao inserir convite.' }, 400)
  }

  const inviteLink = `${siteUrl.replace(/\/$/, '')}/complete-signup?token=${token}`

  await supabase.from('security_audit_logs').insert({
    event_type: 'onboarding_invite_created',
    actor_user_id: actor.id,
    metadata: {
      invite_id: invite.id,
      role: payload.role,
      clinic_id: targetClinicId,
      dentist_id: payload.dentistId ?? null,
    },
  })

  return json(req, { ok: true, inviteId: invite.id, inviteLink })
})
