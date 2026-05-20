import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  token: string
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

const ROLE_LABEL: Record<string, string> = {
  master_admin: 'Administrador master',
  dentist_admin: 'Administrador dentista',
  dentist_client: 'Dentista Cliente',
  clinic_client: 'Clinica Cliente',
  lab_tech: 'Tecnico de Laboratorio',
  receptionist: 'Recepcao',
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
  if (!payload.token?.trim()) return json(req, { ok: false, error: 'Token obrigatório.' }, 400)

  const tokenHash = await sha256Hex(payload.token.trim())
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: invite, error } = await supabase
    .from('user_onboarding_invites')
    .select('id, role, clinic_id, full_name, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) return json(req, { ok: false, error: error.message }, 400)
  if (!invite) return json(req, { ok: false, expired: false, used: false, error: 'Token inválido.' }, 404)

  const expired = new Date(invite.expires_at).getTime() <= Date.now()
  const used = Boolean(invite.used_at)

  if (expired || used) {
    return json(req, { ok: false, expired, used })
  }

  const { data: clinic } = await supabase
    .from('clinics')
    .select('trade_name')
    .eq('id', invite.clinic_id)
    .maybeSingle()

  return json(req, {
    ok: true,
    expired: false,
    used: false,
    preview: {
      fullName: invite.full_name,
      role: invite.role,
      roleLabel: ROLE_LABEL[invite.role] ?? invite.role,
      clinicName: clinic?.trade_name ?? 'Clinica',
    },
  })
})
