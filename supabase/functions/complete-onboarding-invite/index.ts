import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
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
}

function buildFallbackProfileShortId(role: string) {
  const prefix = role === 'lab_tech' ? 'LAB' : 'COL'
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `${prefix}-TMP-${token}`
}

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
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { ok: false, error: 'SUPABASE_URL ou SERVICE_ROLE_KEY ausente.' }, 500)
  }

  const payload = (await req.json()) as Payload
  const email = payload.email?.trim().toLowerCase()
  const password = payload.password?.trim()
  const token = payload.token?.trim()
  const fullNameOverride = payload.fullName?.trim() || null
  const dentistPayload = payload.dentist ?? null

  if (!token || !email || !password) {
    return json(req, { ok: false, error: 'Token, e-mail e senha são obrigatórios.' }, 400)
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
  if (!invite) return json(req, { ok: false, error: 'Token inválido.' }, 404)

  if (invite.used_at) return json(req, { ok: false, error: 'Token ja utilizado.' }, 400)
  if (new Date(invite.expires_at).getTime() <= Date.now()) return json(req, { ok: false, error: 'Token expirado.' }, 400)

  const { data: created, error: createAuthError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createAuthError || !created?.user) {
    return json(req, { ok: false, error: createAuthError?.message ?? 'Falha ao criar usuário.' }, 400)
  }

  const userId = created.user.id
  const profilePhone = dentistPayload?.whatsapp?.trim() || dentistPayload?.phone?.trim() || invite.phone
  let resolvedDentistId = invite.dentist_id as string | null

  if (invite.role === 'dentist_admin' || invite.role === 'dentist_client') {
    const dentistName =
      dentistPayload?.name?.trim() ||
      fullNameOverride ||
      invite.full_name?.trim() ||
      'Dentista'
    const dentistGender = dentistPayload?.gender === 'feminino' ? 'feminino' : 'masculino'
    const dentistCro = dentistPayload?.cro?.trim() || null
    const dentistPhone = dentistPayload?.phone?.trim() || invite.phone || null
    const dentistWhatsapp = dentistPayload?.whatsapp?.trim() || null
    const dentistEmail = dentistPayload?.email?.trim().toLowerCase() || email
    const dentistNotes = dentistPayload?.notes?.trim() || null

    if (resolvedDentistId) {
      const { error: dentistUpdateError } = await supabase
        .from('dentists')
        .update({
          name: dentistName,
          gender: dentistGender,
          cro: dentistCro,
          phone: dentistPhone,
          whatsapp: dentistWhatsapp,
          email: dentistEmail,
          notes: dentistNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resolvedDentistId)
      if (dentistUpdateError) {
        await supabase.auth.admin.deleteUser(userId)
        return json(req, { ok: false, error: dentistUpdateError.message }, 400)
      }
    } else {
      const { data: createdDentist, error: dentistInsertError } = await supabase
        .from('dentists')
        .insert({
          clinic_id: invite.clinic_id,
          name: dentistName,
          gender: dentistGender,
          cro: dentistCro,
          phone: dentistPhone,
          whatsapp: dentistWhatsapp,
          email: dentistEmail,
          notes: dentistNotes,
          is_active: true,
        })
        .select('id')
        .single()
      if (dentistInsertError || !createdDentist?.id) {
        await supabase.auth.admin.deleteUser(userId)
        return json(req, { ok: false, error: dentistInsertError?.message ?? 'Falha ao criar cadastro do dentista.' }, 400)
      }
      resolvedDentistId = createdDentist.id as string
    }
  }

  const profilePayload = {
    user_id: userId,
    login_email: email,
    role: invite.role,
    clinic_id: invite.clinic_id,
    dentist_id: resolvedDentistId,
    full_name: fullNameOverride || invite.full_name,
    cpf: invite.cpf,
    phone: profilePhone,
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
    return json(req, { ok: false, error: 'Não foi possível consumir o token.' }, 409)
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
