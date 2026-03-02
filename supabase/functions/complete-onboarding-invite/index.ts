import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  token: string
  email: string
  password: string
}

function buildFallbackProfileShortId(role: string) {
  const prefix = role === 'lab_tech' ? 'LAB' : 'COL'
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `${prefix}-TMP-${token}`
}

function resolveAllowedOrigin(_req: Request) {
  const configured = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim()
  if (configured) return configured
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim()
  if (!siteUrl) return 'null'
  try {
    return new URL(siteUrl).origin
  } catch {
    return 'null'
  }
}

function corsHeaders(req: Request) {
  const allowedOrigin = resolveAllowedOrigin(req)
  const requestOrigin = req.headers.get('origin') ?? ''
  const origin = requestOrigin && requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { ok: false, error: 'Missing SUPABASE_URL or SERVICE_ROLE_KEY.' }, 500)
  }

  const payload = (await req.json()) as Payload
  const email = payload.email?.trim().toLowerCase()
  const password = payload.password?.trim()
  const token = payload.token?.trim()

  if (!token || !email || !password) {
    return json(req, { ok: false, error: 'Token, email e senha sao obrigatorios.' }, 400)
  }
  if (password.length < 10) {
    return json(req, { ok: false, error: 'Senha deve ter ao menos 10 caracteres.' }, 400)
  }

  const tokenHash = await sha256Hex(token)
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: invite, error: inviteError } = await supabase
    .from('user_onboarding_invites')
    .select('id, role, clinic_id, dentist_id, full_name, cpf, phone, created_by, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (inviteError) return json(req, { ok: false, error: inviteError.message }, 400)
  if (!invite) return json(req, { ok: false, error: 'Token invalido.' }, 404)

  if (invite.used_at) return json(req, { ok: false, error: 'Token ja utilizado.' }, 400)
  if (new Date(invite.expires_at).getTime() <= Date.now()) return json(req, { ok: false, error: 'Token expirado.' }, 400)

  const { data: created, error: createAuthError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createAuthError || !created?.user) {
    return json(req, { ok: false, error: createAuthError?.message ?? 'Falha ao criar usuario.' }, 400)
  }

  const userId = created.user.id

  const profilePayload = {
    user_id: userId,
    login_email: email,
    role: invite.role,
    clinic_id: invite.clinic_id,
    dentist_id: invite.dentist_id,
    full_name: invite.full_name,
    cpf: invite.cpf,
    phone: invite.phone,
    onboarding_completed_at: new Date().toISOString(),
    is_active: true,
    deleted_at: null,
  }
  const { error: profileError } = await supabase.from('profiles').upsert(profilePayload)

  if (profileError) {
    if (profileError.message.toLowerCase().includes('idx_profiles_short_id_unique')) {
      const { error: retryError } = await supabase.from('profiles').upsert({
        ...profilePayload,
        short_id: buildFallbackProfileShortId(invite.role),
      })
      if (!retryError) {
        const { data: consumeRows, error: consumeError } = await supabase
          .from('user_onboarding_invites')
          .update({ used_at: new Date().toISOString() })
          .eq('id', invite.id)
          .is('used_at', null)
          .select('id')
        if (!consumeError && consumeRows && consumeRows.length > 0) {
          return json(req, { ok: true })
        }
      }
    }
    await supabase.auth.admin.deleteUser(userId)
    return json(req, { ok: false, error: profileError.message }, 400)
  }

  const { data: consumeRows, error: consumeError } = await supabase
    .from('user_onboarding_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)
    .is('used_at', null)
    .select('id')

  if (consumeError || !consumeRows || consumeRows.length === 0) {
    await supabase.auth.admin.deleteUser(userId)
    return json(req, { ok: false, error: 'Nao foi possivel consumir o token.' }, 409)
  }

  await supabase.from('security_audit_logs').insert({
    event_type: 'onboarding_invite_completed',
    actor_user_id: invite.created_by,
    target_user_id: userId,
    metadata: {
      invite_id: invite.id,
      role: invite.role,
      clinic_id: invite.clinic_id,
    },
  })

  return json(req, { ok: true })
})
