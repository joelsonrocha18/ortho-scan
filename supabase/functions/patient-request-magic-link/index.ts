import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  cpf?: string
  birthDate?: string
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
  return allowedOrigins[0] ?? (requestOrigin || '*')
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

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function maskEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() ?? ''
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return ''
  const head = localPart.slice(0, 1)
  const hidden = '*'.repeat(Math.max(2, Math.min(6, localPart.length - 1)))
  return `${head}${hidden}@${domain}`
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

async function sendEmail(params: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from = Deno.env.get('EMAIL_FROM') ?? ''
  if (!apiKey || !from) return { ok: false as const, error: 'RESEND_API_KEY/EMAIL_FROM não configurados.' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  })

  if (!response.ok) {
    return { ok: false as const, error: await response.text() }
  }

  return { ok: true as const }
}

async function findPatientByIdentity(
  supabase: ReturnType<typeof createClient>,
  payload: { cpf: string; birthDate: string },
) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, cpf, birth_date, email, deleted_at')
    .eq('birth_date', payload.birthDate)
    .is('deleted_at', null)

  if (error) throw error

  return (data ?? []).find((item) => onlyDigits(String(item.cpf ?? '')) === payload.cpf) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  const debugMode = (Deno.env.get('PATIENT_MAGIC_LINK_DEBUG') ?? '').trim().toLowerCase() === 'true'

  if (!supabaseUrl || !serviceRoleKey || !siteUrl) {
    return json(req, { ok: false, error: 'SUPABASE_URL, SERVICE_ROLE_KEY ou SITE_URL ausente.' }, 500)
  }

  const payload = (await req.json()) as Payload
  const cpf = onlyDigits(payload.cpf ?? '')
  const birthDate = (payload.birthDate ?? '').trim()

  if (cpf.length !== 11 || !birthDate) {
    return json(req, { ok: false, error: 'Informe CPF e data de nascimento validos.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const patient = await findPatientByIdentity(supabase, { cpf, birthDate })
  if (!patient) {
    return json(req, { ok: false, error: 'Não encontramos um paciente com os dados informados.' }, 404)
  }

  const email = String(patient.email ?? '').trim().toLowerCase()
  if (!email) {
    return json(req, { ok: false, error: 'Este paciente ainda não possui e-mail cadastrado para receber link mágico.' }, 400)
  }

  const recentWindowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { count: recentLinks } = await supabase
    .from('patient_access_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patient.id)
    .gte('created_at', recentWindowStart)

  if ((recentLinks ?? 0) >= 5) {
    return json(req, { ok: false, error: 'Muitas solicitacoes recentes. Aguarde alguns minutos e tente novamente.' }, 429)
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const magicLinkUrl = `${siteUrl.replace(/\/$/, '')}/acesso/pacientes/portal?token=${encodeURIComponent(token)}`

  const { error: insertError } = await supabase.from('patient_access_tokens').insert({
    patient_id: patient.id,
    token_hash: tokenHash,
    delivery_channel: 'email',
    expires_at: expiresAt,
  })

  if (insertError) {
    return json(req, { ok: false, error: insertError.message }, 400)
  }

  const emailResult = await sendEmail({
    to: email,
    subject: 'Seu acesso ao tratamento - OrthoScan',
      html: `<p>Olá, ${patient.name ?? 'paciente'}.</p><p>Seu link temporário para acompanhar o tratamento está pronto.</p><p><a href="${magicLinkUrl}">Abrir meu acesso</a></p><p>Validade: 30 minutos.</p>`,
  })

  await supabase.from('security_audit_logs').insert({
    event_type: 'patient_magic_link_requested',
    metadata: {
      patient_id: patient.id,
      email,
      email_sent: emailResult.ok,
    },
  })

  if (!emailResult.ok && !debugMode) {
    return json(req, { ok: false, error: emailResult.error }, 500)
  }

  return json(req, {
    ok: true,
    data: {
      deliveryChannel: emailResult.ok ? 'email' : 'debug',
      destinationHint: maskEmail(email),
      magicLinkUrl: debugMode ? magicLinkUrl : undefined,
    },
  })
})
