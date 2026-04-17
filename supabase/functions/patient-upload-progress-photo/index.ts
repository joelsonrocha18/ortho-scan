import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type CaseRow = {
  id?: string
  short_id?: string | null
  clinic_id?: string | null
  data?: Record<string, unknown> | null
}

const STORAGE_BUCKET = (Deno.env.get('STORAGE_BUCKET') ?? 'orthoscan').trim() || 'orthoscan'

function resolveAllowedOrigin(req: Request) {
  const configured = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim()
  if (configured) return configured
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim()
  if (!siteUrl) return req.headers.get('origin') ?? '*'
  try {
    return new URL(siteUrl).origin
  } catch {
    return req.headers.get('origin') ?? '*'
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

function normalizeAccessCode(value?: string | null) {
  return String(value ?? '').trim().toUpperCase()
}

function isReadableCode(value?: string | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)
}

function sanitizeTokenSegment(value: string, fallback = 'arquivo') {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || fallback
}

function fileNameWithTimestamp(fileName: string, patientId: string) {
  const cleaned = sanitizeTokenSegment(fileName || 'arquivo')
  return `${sanitizeTokenSegment(patientId, 'paciente')}_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_patient_portal_${cleaned}`
}

function matchesAccessCode(row: CaseRow, accessCode: string) {
  const normalized = normalizeAccessCode(accessCode)
  const data = row.data ?? {}
  const candidates = [
    normalizeAccessCode(typeof data.treatmentCode === 'string' ? data.treatmentCode : ''),
    normalizeAccessCode(row.short_id),
    isReadableCode(row.id) ? normalizeAccessCode(row.id) : '',
  ].filter(Boolean)
  return candidates.includes(normalized)
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validateImageFile(file: File) {
  const allowedMime = (file.type || '').toLowerCase().startsWith('image/')
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const allowedExt = ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)
  if (!allowedMime && !allowedExt) {
    return 'Envie uma foto em JPG, PNG, HEIC ou WEBP.'
  }
  if (file.size > 20 * 1024 * 1024) {
    return 'A foto excede o limite de 20MB.'
  }
  return null
}

async function ensureBucket(
  supabase: ReturnType<typeof createClient>,
  bucketName: string,
) {
  const bucket = await supabase.storage.getBucket(bucketName)
  if (!bucket.error && bucket.data) {
    return null
  }

  const create = await supabase.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: '50MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
  })

  if (create.error && !/already exists/i.test(create.error.message)) {
    return create.error.message
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { ok: false, error: 'SUPABASE_URL ou SERVICE_ROLE_KEY ausente.' }, 500)
  }

  const form = await req.formData()
  const token = String(form.get('token') ?? '').trim()
  const accessCode = normalizeAccessCode(String(form.get('accessCode') ?? ''))
  const trayNumber = Math.max(1, Math.trunc(Number(form.get('trayNumber') ?? '0')))
  const capturedAt = String(form.get('capturedAt') ?? '').trim()
  const sentAtInput = String(form.get('sentAt') ?? '').trim()
  const deviceLabelInput = String(form.get('deviceLabel') ?? '').trim()
  const note = String(form.get('note') ?? '').trim() || null
  const file = form.get('file')

  if (!token || !accessCode || !Number.isFinite(trayNumber) || !capturedAt || !isIsoDate(capturedAt) || !(file instanceof File)) {
    return json(req, { ok: false, error: 'Dados da foto do tratamento inválidos.' }, 400)
  }

  const fileValidationError = validateImageFile(file)
  if (fileValidationError) {
    return json(req, { ok: false, error: fileValidationError }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const tokenHash = await sha256Hex(token)
  const { data: accessToken, error: tokenError } = await supabase
    .from('patient_access_tokens')
    .select('id, patient_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError || !accessToken) {
    return json(req, { ok: false, error: 'Sessão do paciente inválida.' }, 404)
  }

  if (new Date(accessToken.expires_at).getTime() < Date.now()) {
    return json(req, { ok: false, error: 'Sessão do paciente expirada.' }, 410)
  }

  const [patientRes, casesRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, clinic_id')
      .eq('id', accessToken.patient_id)
      .maybeSingle(),
    supabase
      .from('cases')
      .select('id, short_id, clinic_id, data')
      .eq('patient_id', accessToken.patient_id)
      .is('deleted_at', null),
  ])

  const patient = patientRes.data as { id?: string; clinic_id?: string | null } | null
  if (!patient?.id) {
    return json(req, { ok: false, error: 'Paciente não encontrado para esta sessão.' }, 404)
  }

  const caseRows = (casesRes.data ?? []) as CaseRow[]
  const caseRow = caseRows.find((item) => matchesAccessCode(item, accessCode)) ?? null
  if (!caseRow?.id) {
    return json(req, { ok: false, error: 'Código do tratamento não localizado para este paciente.' }, 404)
  }

  const existingDocs = await supabase
    .from('documents')
    .select('id, data')
    .eq('patient_id', patient.id)
    .eq('case_id', caseRow.id)
    .eq('category', 'foto')
    .is('deleted_at', null)

  if (existingDocs.error) {
    return json(req, { ok: false, error: existingDocs.error.message }, 400)
  }

  const hasConfirmedPhoto = (existingDocs.data ?? []).some((row) => {
    const data = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : {}
    return typeof data.trayNumber === 'number' && data.trayNumber === trayNumber
  })

  if (hasConfirmedPhoto) {
    return json(
      req,
      { ok: false, error: 'Esta troca já foi confirmada. Depois da confirmação, não é possível alterar ou excluir a foto.' },
      409,
    )
  }

  const clinicId = patient.clinic_id ?? caseRow.clinic_id ?? 'portal_publico'
  const path = `clinics/${sanitizeTokenSegment(String(clinicId), 'portal_publico')}/patients/${sanitizeTokenSegment(String(patient.id), 'paciente')}/documents/${fileNameWithTimestamp(file.name, String(patient.id))}`

  const bucketError = await ensureBucket(supabase, STORAGE_BUCKET)
  if (bucketError) {
    return json(req, { ok: false, error: bucketError }, 400)
  }

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (uploadError) {
    return json(req, { ok: false, error: uploadError.message }, 400)
  }

  const title = `Foto do alinhador #${trayNumber}`
  const sentAt = sentAtInput || new Date().toISOString()
  const deviceLabel = deviceLabelInput || req.headers.get('user-agent') || 'Dispositivo não identificado'
  const { data: documentRow, error: documentError } = await supabase
    .from('documents')
    .insert({
      clinic_id: clinicId,
      patient_id: patient.id,
      case_id: caseRow.id,
      category: 'foto',
      title,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      status: 'ok',
      note,
      created_by: null,
      created_at: sentAt,
      data: {
        trayNumber,
        capturedAt,
        sentAt,
        deviceLabel,
        source: 'patient_portal',
        uploadedByPatient: true,
        accessCode,
      },
    })
    .select('id')
    .single()

  if (documentError || !documentRow) {
    await supabase.storage.from(STORAGE_BUCKET).remove([path])
    return json(req, { ok: false, error: documentError?.message ?? 'Falha ao registrar foto do tratamento.' }, 400)
  }

  await supabase
    .from('patient_access_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', accessToken.id)

  return json(req, {
    ok: true,
    data: {
      documentId: String((documentRow as { id?: string }).id ?? ''),
      trayNumber,
      capturedAt,
      title,
    },
  })
})
