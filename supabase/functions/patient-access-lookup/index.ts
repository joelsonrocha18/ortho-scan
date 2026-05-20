import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  cpf?: string
  birthDate?: string
  accessCode?: string
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

function resolveSiteUrl(req: Request) {
  const configured = (Deno.env.get('SITE_URL') ?? '').trim()
  if (configured) return configured.replace(/\/$/, '')
  return (req.headers.get('origin') ?? '').replace(/\/$/, '')
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

function normalizeAccessCode(value?: string | null) {
  return String(value ?? '').trim().toUpperCase()
}

function isReadableCode(value?: string | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)
}

function resolveCaseCode(row: { id?: string; short_id?: string | null; data?: Record<string, unknown> | null }) {
  const treatmentCode = typeof row.data?.treatmentCode === 'string' ? row.data.treatmentCode : ''
  const shortId = typeof row.short_id === 'string' ? row.short_id : ''
  const readableId = isReadableCode(row.id) ? String(row.id) : ''
  return treatmentCode || shortId || readableId
}

function matchesAccessCode(
  row: { id?: string; short_id?: string | null; data?: Record<string, unknown> | null },
  accessCode: string,
) {
  const normalized = normalizeAccessCode(accessCode)
  const candidates = [
    normalizeAccessCode(typeof row.data?.treatmentCode === 'string' ? row.data.treatmentCode : ''),
    normalizeAccessCode(row.short_id),
    isReadableCode(row.id) ? normalizeAccessCode(row.id) : '',
  ].filter(Boolean)
  return candidates.includes(normalized)
}

function maskCpf(value?: string | null) {
  const digits = onlyDigits(value ?? '')
  if (digits.length !== 11) return '***.***.***-**'
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`
}

function maskEmail(value?: string | null) {
  const email = value?.trim().toLowerCase() ?? ''
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return ''
  const head = localPart.slice(0, 1)
  const hidden = '*'.repeat(Math.max(2, Math.min(6, localPart.length - 1)))
  return `${head}${hidden}@${domain}`
}

function normalizeStatus(value?: string | null) {
  if (!value) return 'Cadastro localizado'
  return value.replaceAll('_', ' ')
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

async function findPatientByIdentity(
  supabase: ReturnType<typeof createClient>,
  payload: { cpf: string; birthDate: string },
) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, cpf, birth_date, email, clinic_id, primary_dentist_id, deleted_at')
    .eq('birth_date', payload.birthDate)
    .is('deleted_at', null)

  if (error) throw error

  return (data ?? []).find((item) => onlyDigits(String(item.cpf ?? '')) === payload.cpf) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { ok: false, error: 'SUPABASE_URL ou SERVICE_ROLE_KEY ausente.' }, 500)
    }

    const payload = (await req.json()) as Payload
    const cpf = onlyDigits(payload.cpf ?? '')
    const birthDate = (payload.birthDate ?? '').trim()
    const accessCode = normalizeAccessCode(payload.accessCode)

    if (cpf.length !== 11 || !birthDate) {
      return json(req, { ok: false, error: 'Informe CPF e data de nascimento validos.' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const patient = await findPatientByIdentity(supabase, { cpf, birthDate })
    if (!patient) {
      return json(req, { ok: false, error: 'Não encontramos um paciente com os dados informados.' }, 404)
    }

    const [clinicRes, dentistRes, caseRes] = await Promise.all([
      patient.clinic_id
        ? supabase.from('clinics').select('trade_name').eq('id', patient.clinic_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      patient.primary_dentist_id
        ? supabase.from('dentists').select('name').eq('id', patient.primary_dentist_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('cases')
        .select('id, short_id, status, updated_at, created_at, data')
        .eq('patient_id', patient.id)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
    ])

    if (caseRes.error) {
      throw caseRes.error
    }

    const caseRows = ((caseRes.data ?? []) as Array<{
      id?: string
      short_id?: string | null
      status?: string | null
      updated_at?: string | null
      created_at?: string | null
      data?: Record<string, unknown> | null
    }>)
    const matchedCase = accessCode ? caseRows.find((item) => matchesAccessCode(item, accessCode)) ?? null : caseRows[0] ?? null

    if (accessCode && !matchedCase) {
      return json(req, { ok: false, error: 'Código do tratamento não localizado para este paciente.' }, 404)
    }

    if (!accessCode) {
      return json(req, {
        ok: true,
        data: {
          patientId: String(patient.id),
          patientName: String(patient.name ?? 'Paciente'),
          cpfMasked: maskCpf(patient.cpf as string | null | undefined),
          birthDate,
          clinicName: (clinicRes.data as { trade_name?: string } | null)?.trade_name,
          dentistName: (dentistRes.data as { name?: string } | null)?.name,
          activeCaseCode: matchedCase ? resolveCaseCode(matchedCase) : undefined,
          treatmentStatus: normalizeStatus(
            typeof matchedCase?.data?.lifecycleStatus === 'string'
              ? matchedCase.data.lifecycleStatus
              : matchedCase?.status,
          ),
          nextChangeDate: undefined,
          magicLinkEnabled: Boolean(maskEmail(patient.email as string | null | undefined)),
          destinationHint: maskEmail(patient.email as string | null | undefined) || undefined,
        },
      })
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`
    const tokenHash = await sha256Hex(token)
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

    const { error: insertError } = await supabase.from('patient_access_tokens').insert({
      patient_id: patient.id,
      token_hash: tokenHash,
      delivery_channel: 'direct',
      expires_at: expiresAt,
    })

    if (insertError) {
      return json(req, { ok: false, error: insertError.message }, 400)
    }

    const resolvedCode = matchedCase ? resolveCaseCode(matchedCase) : accessCode
    const portalUrl = `${resolveSiteUrl(req)}/acesso/pacientes/portal?token=${encodeURIComponent(token)}&accessCode=${encodeURIComponent(resolvedCode)}`

    return json(req, {
      ok: true,
      data: {
        token,
        accessCode: resolvedCode,
        portalUrl,
        preview: {
          patientId: String(patient.id),
          patientName: String(patient.name ?? 'Paciente'),
          activeCaseCode: resolvedCode,
          treatmentStatus: normalizeStatus(
            typeof matchedCase?.data?.lifecycleStatus === 'string'
              ? matchedCase.data.lifecycleStatus
              : matchedCase?.status,
          ),
          clinicName: (clinicRes.data as { trade_name?: string } | null)?.trade_name,
          dentistName: (dentistRes.data as { name?: string } | null)?.name,
        },
      },
    })
  } catch (error) {
    console.error('falha em patient-access-lookup', error)
    const message = error instanceof Error && error.message ? error.message : 'Falha ao validar o acesso do paciente.'
    return json(req, { ok: false, error: message }, 500)
  }
})
