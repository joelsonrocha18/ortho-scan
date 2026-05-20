import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Payload = {
  token?: string
  accessCode?: string
}

type CaseRow = {
  id?: string
  short_id?: string | null
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
  data?: Record<string, unknown> | null
}

type PatientDocumentRow = {
  id?: string
  case_id?: string | null
  title?: string | null
  category?: string | null
  created_at?: string | null
  file_path?: string | null
  file_name?: string | null
  note?: string | null
  data?: Record<string, unknown> | null
}

const STORAGE_BUCKET = (Deno.env.get('STORAGE_BUCKET') ?? 'orthoscan').trim() || 'orthoscan'

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

function maskCpf(value?: string | null) {
  const digits = onlyDigits(value ?? '')
  if (digits.length !== 11) return '***.***.***-**'
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`
}

function normalizeAccessCode(value?: string | null) {
  return String(value ?? '').trim().toUpperCase()
}

function isReadableCode(value?: string | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)
}

function resolveCaseCode(row: CaseRow) {
  const data = row.data ?? {}
  const treatmentCode = typeof data.treatmentCode === 'string' ? data.treatmentCode : ''
  const shortId = typeof row.short_id === 'string' ? row.short_id : ''
  const readableId = isReadableCode(row.id) ? String(row.id) : ''
  return treatmentCode || shortId || readableId
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

function normalizeStatus(value?: string | null) {
  if (!value) return 'Cadastro localizado'
  return value.replaceAll('_', ' ')
}

function toPatientFacingStatus(value?: string | null) {
  switch (value) {
    case 'scan_received':
    case 'scan_approved':
    case 'case_created':
      return 'Em preparacao'
    case 'in_production':
    case 'qc':
    case 'shipped':
      return 'Proximos alinhadores em preparacao'
    case 'delivered':
    case 'in_use':
    case 'em_tratamento':
      return 'Em tratamento'
    case 'rework':
      return 'Ajuste em andamento'
    default:
      return normalizeStatus(value)
  }
}

function formatPtBrDate(value?: string | null, fallback = '-') {
  if (!value) return fallback
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(baseIsoDate: string, days: number) {
  const date = new Date(`${baseIsoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (valueByte) => valueByte.toString(16).padStart(2, '0')).join('')
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function resolveProductLabel(caseRow: CaseRow) {
  const data = caseRow.data ?? {}
  return asText(data.requestedProductLabel) || asText(data.requestedProductId) || asText(data.productType) || '-'
}

function resolveAlignerTotals(caseRow: CaseRow) {
  const data = caseRow.data ?? {}
  const arch = asText(data.arch)
  const total = asNumber(data.totalTrays, 0)
  const upper = arch === 'inferior' ? 0 : Math.max(0, asNumber(data.totalTraysUpper, total))
  const lower = arch === 'superior' ? 0 : Math.max(0, asNumber(data.totalTraysLower, total))
  return { upper, lower, total: Math.max(upper, lower, total) }
}

function resolveDelivered(data: Record<string, unknown>) {
  const installation = data.installation && typeof data.installation === 'object'
    ? data.installation as Record<string, unknown>
    : {}
  return {
    upper: Math.max(0, asNumber(installation.deliveredUpper, 0)),
    lower: Math.max(0, asNumber(installation.deliveredLower, 0)),
    installedAt: asText(installation.installedAt),
  }
}

function buildScheduleRows(caseRow: CaseRow) {
  const data = caseRow.data ?? {}
  const totals = resolveAlignerTotals(caseRow)
  const delivered = resolveDelivered(data)
  const changeEveryDays = Math.max(1, asNumber(data.changeEveryDays, 7))
  const schedule: Array<{ trayNumber: number; changeDate: string }> = []

  if (delivered.installedAt) {
    let currentDate = delivered.installedAt.slice(0, 10)
    for (let trayNumber = 1; trayNumber <= totals.total; trayNumber += 1) {
      if (trayNumber > 1) {
        currentDate = addDays(currentDate, changeEveryDays)
      }
      schedule.push({ trayNumber, changeDate: currentDate })
    }
    return schedule
  }

  const trays = Array.isArray(data.trays) ? data.trays as Array<Record<string, unknown>> : []
  return trays
    .map((tray) => ({
      trayNumber: asNumber(tray.trayNumber, 0),
      changeDate: asText(tray.dueDate).slice(0, 10),
    }))
    .filter((item) => item.trayNumber > 0 && item.changeDate)
}

function buildActualPortalChangeMap(docs: PatientDocumentRow[]) {
  const map = new Map<number, string>()
  docs.forEach((item) => {
    const trayNumber = typeof item.data?.trayNumber === 'number' ? item.data.trayNumber : undefined
    const capturedAt =
      typeof item.data?.capturedAt === 'string'
        ? item.data.capturedAt.slice(0, 10)
        : (item.created_at ? String(item.created_at).slice(0, 10) : '')
    if (!trayNumber || !capturedAt || String(item.category ?? '') !== 'foto') return
    map.set(trayNumber, capturedAt)
  })
  return map
}

function buildScheduleRowsFromDocs(caseRow: CaseRow, docs: PatientDocumentRow[]) {
  const data = caseRow.data ?? {}
  const totals = resolveAlignerTotals(caseRow)
  const delivered = resolveDelivered(data)
  const changeEveryDays = Math.max(1, asNumber(data.changeEveryDays, 7))
  const actualChanges = buildActualPortalChangeMap(docs)

  if (delivered.installedAt) {
    const schedule: Array<{ trayNumber: number; changeDate: string }> = []
    let currentDate = delivered.installedAt.slice(0, 10)
    for (let trayNumber = 1; trayNumber <= totals.total; trayNumber += 1) {
      if (trayNumber > 1) {
        currentDate = addDays(currentDate, changeEveryDays)
      }
      const actualDate = actualChanges.get(trayNumber) ?? currentDate
      schedule.push({ trayNumber, changeDate: actualDate })
      currentDate = actualDate
    }
    return schedule
  }

  return buildScheduleRows(caseRow)
}

function buildPhotoDocuments(docs: PatientDocumentRow[]) {
  return [...docs]
    .filter((item) => asText(item.category) === 'foto')
    .sort((left, right) => asText(left.created_at).localeCompare(asText(right.created_at)))
    .map((item) => ({
      documentId: String(item.id ?? ''),
      trayNumber: typeof item.data?.trayNumber === 'number' ? item.data.trayNumber : undefined,
      fileName: item.file_name ?? undefined,
      capturedAt:
        typeof item.data?.capturedAt === 'string'
          ? item.data.capturedAt
          : (item.created_at ? String(item.created_at).slice(0, 10) : undefined),
      title: item.title ?? undefined,
      note: item.note ?? undefined,
      source:
        item.data?.source === 'patient_portal' || item.data?.source === 'internal'
          ? item.data.source
          : undefined,
    }))
}

function findPhotoForTray(
  trayNumber: number,
  photoDocs: ReturnType<typeof buildPhotoDocuments>,
  usedDocumentIds: Set<string>,
) {
  const exact = photoDocs.find((item) => item.trayNumber === trayNumber && !usedDocumentIds.has(item.documentId))
  if (exact) return exact
  return photoDocs.find((item) => item.trayNumber === undefined && !usedDocumentIds.has(item.documentId))
}

function buildPhotoSlots(
  scheduleRows: Array<{ trayNumber: number; changeDate: string }>,
  docs: PatientDocumentRow[],
  signedUrlsByDocumentId: Map<string, string>,
) {
  const today = isoToday()
  const photos = buildPhotoDocuments(docs)
  const usedDocumentIds = new Set<string>()

  return scheduleRows.slice(0, 12).map((row) => {
    const photo = findPhotoForTray(row.trayNumber, photos, usedDocumentIds)
    if (photo) usedDocumentIds.add(photo.documentId)
    const recordedAt = photo?.capturedAt
    const status = photo ? 'recebida' : row.changeDate < today ? 'pendente' : 'aguardando'
    return {
      id: `photo-slot-${row.trayNumber}`,
      trayNumber: row.trayNumber,
      plannedDate: row.changeDate,
      recordedAt,
      documentId: photo?.documentId,
      title: photo?.title ?? `Foto do alinhador #${row.trayNumber}`,
      fileName: photo?.fileName,
      note: photo?.note ?? undefined,
      previewUrl: photo?.documentId ? signedUrlsByDocumentId.get(photo.documentId) : undefined,
      status,
    }
  })
}

async function buildSignedUrlsByDocumentId(
  supabase: ReturnType<typeof createClient>,
  docs: PatientDocumentRow[],
) {
  const pairs = await Promise.all(
    docs.map(async (item) => {
      const documentId = String(item.id ?? '')
      const filePath = typeof item.file_path === 'string' ? item.file_path : ''
      if (!documentId || !filePath || String(item.category ?? '') !== 'foto') {
        return [documentId, ''] as const
      }
      const signed = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(filePath, 60 * 60 * 12)
      return [documentId, signed.data?.signedUrl ?? ''] as const
    }),
  )

  return new Map(pairs.filter(([documentId, url]) => documentId && url))
}

function buildTimeline(caseRow: CaseRow, photoSlots: Array<{ trayNumber: number; status: string; recordedAt?: string }>) {
  const today = isoToday()
  const items: Array<{
    id: string
    date: string
    title: string
    description?: string
    trayNumber?: number
    status: 'done' | 'today' | 'upcoming' | 'pending'
    kind: 'milestone' | 'change'
    photoStatus?: 'recebida' | 'pendente' | 'aguardando'
  }> = []

  if (caseRow.created_at) {
    items.push({
      id: `milestone-created-${caseRow.id}`,
      date: String(caseRow.created_at).slice(0, 10),
      title: 'Tratamento cadastrado',
      description: `Caso ${resolveCaseCode(caseRow)} preparado para acompanhamento do paciente.`,
      status: 'done',
      kind: 'milestone',
    })
  }

  const installedAt = resolveDelivered(caseRow.data ?? {}).installedAt
  if (installedAt) {
    items.push({
      id: `installation-${caseRow.id}`,
      date: installedAt.slice(0, 10),
      title: 'Uso do tratamento iniciado',
      description: 'A partir desta data as trocas passam a ser acompanhadas no portal.',
      status: 'done',
      kind: 'milestone',
    })
  }

  buildScheduleRows(caseRow).slice(0, 16).forEach((row) => {
    const photoSlot = photoSlots.find((item) => item.trayNumber === row.trayNumber)
    items.push({
      id: `change-${caseRow.id}-${row.trayNumber}`,
      date: row.changeDate,
      title: `Troca do alinhador #${row.trayNumber}`,
      description:
        photoSlot?.status === 'recebida'
          ? `Selfie confirmada em ${formatPtBrDate(photoSlot.recordedAt)}.`
          : photoSlot?.status === 'pendente'
            ? 'Aguardando a confirmação da selfie desta troca.'
            : 'Troca futura prevista.',
      trayNumber: row.trayNumber,
      status: row.changeDate < today ? 'done' : row.changeDate === today ? 'today' : 'upcoming',
      kind: 'change',
      photoStatus: photoSlot?.status as 'recebida' | 'pendente' | 'aguardando' | undefined,
    })
  })

  return items.sort((left, right) => left.date.localeCompare(right.date))
}

function buildCalendarMonths(scheduleRows: Array<{ trayNumber: number; changeDate: string }>) {
  const highlighted = new Map<string, number[]>()
  scheduleRows.forEach((row) => {
    const current = highlighted.get(row.changeDate) ?? []
    current.push(row.trayNumber)
    highlighted.set(row.changeDate, current)
  })

  const today = new Date()
  const monthStarts = [
    new Date(today.getFullYear(), today.getMonth(), 1),
    new Date(today.getFullYear(), today.getMonth() + 1, 1),
  ]

  return monthStarts.map((monthStart) => {
    const cells: Array<{
      isoDate: string
      dayNumber: number
      isToday: boolean
      isChangeDay: boolean
      trayNumbers: number[]
    } | null> = []
    const start = new Date(monthStart)
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`

    for (let index = 0; index < start.getDay(); index += 1) {
      cells.push(null)
    }

    while (start.getMonth() === monthStart.getMonth()) {
      const isoDate = start.toISOString().slice(0, 10)
      cells.push({
        isoDate,
        dayNumber: start.getDate(),
        isToday: isoDate === isoToday(),
        isChangeDay: highlighted.has(isoDate),
        trayNumbers: highlighted.get(isoDate) ?? [],
      })
      start.setDate(start.getDate() + 1)
    }

    while (cells.length % 7 !== 0) {
      cells.push(null)
    }

    return {
      key: monthKey,
      label: monthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, (char) => char.toUpperCase()),
      cells,
    }
  })
}

function findLastRecordedPhotoSlot(
  photoSlots: Array<{ trayNumber: number; recordedAt?: string }>,
) {
  return [...photoSlots]
    .filter((item): item is { trayNumber: number; recordedAt: string } => Boolean(item.recordedAt))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.trayNumber - right.trayNumber)
    .at(-1)
}

function resolveNextChangeDate(
  photoSlots: Array<{ trayNumber: number; status: string; plannedDate: string; recordedAt?: string }>,
  changeEveryDays: number,
) {
  const lastRecordedSlot = findLastRecordedPhotoSlot(photoSlots)
  if (lastRecordedSlot && changeEveryDays > 0) {
    const hasRemainingTray = photoSlots.some((item) => item.trayNumber > lastRecordedSlot.trayNumber)
    if (!hasRemainingTray) return undefined
    return addDays(lastRecordedSlot.recordedAt, changeEveryDays)
  }

  return photoSlots.find((item) => item.status !== 'recebida')?.plannedDate
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
  const token = (payload.token ?? '').trim()
  const accessCode = normalizeAccessCode(payload.accessCode)
  if (!token) {
    return json(req, { ok: false, error: 'Token obrigatório.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const tokenHash = await sha256Hex(token)
  const { data: accessToken, error: tokenError } = await supabase
    .from('patient_access_tokens')
    .select('id, patient_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError || !accessToken) {
    return json(req, { ok: false, error: 'Link do paciente inválido.' }, 404)
  }

  if (new Date(accessToken.expires_at).getTime() < Date.now()) {
    return json(req, { ok: false, error: 'Link do paciente expirado.' }, 410)
  }

  const [patientRes, clinicRes, dentistRes, casesRes, docsRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, name, cpf, birth_date, clinic_id, primary_dentist_id')
      .eq('id', accessToken.patient_id)
      .maybeSingle(),
    supabase
      .from('patients')
      .select('clinic_id')
      .eq('id', accessToken.patient_id)
      .maybeSingle()
      .then(async ({ data }) =>
        data?.clinic_id
          ? supabase.from('clinics').select('trade_name').eq('id', data.clinic_id).maybeSingle()
          : { data: null, error: null }),
    supabase
      .from('patients')
      .select('primary_dentist_id')
      .eq('id', accessToken.patient_id)
      .maybeSingle()
      .then(async ({ data }) =>
        data?.primary_dentist_id
          ? supabase.from('dentists').select('name').eq('id', data.primary_dentist_id).maybeSingle()
          : { data: null, error: null }),
    supabase
      .from('cases')
      .select('id, short_id, status, created_at, updated_at, data')
      .eq('patient_id', accessToken.patient_id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),
    supabase
      .from('documents')
      .select('id, case_id, title, category, created_at, file_path, file_name, note, data')
      .eq('patient_id', accessToken.patient_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
  ])

  const patient = patientRes.data as {
    id?: string
    name?: string
    cpf?: string | null
    birth_date?: string | null
  } | null

  if (!patient?.id) {
    return json(req, { ok: false, error: 'Paciente não encontrado para esta sessão.' }, 404)
  }

  const caseRows = (casesRes.data ?? []) as CaseRow[]
  const caseRow = accessCode
    ? caseRows.find((item) => matchesAccessCode(item, accessCode)) ?? null
    : caseRows[0] ?? null

  if (!caseRow) {
    return json(req, { ok: false, error: 'Tratamento não encontrado para esta sessão.' }, 404)
  }

  const documents = ((docsRes.data ?? []) as PatientDocumentRow[]).filter((document) => {
    if (document.case_id === caseRow.id) return true
    const metadataAccessCode =
      typeof document.data?.accessCode === 'string'
        ? normalizeAccessCode(document.data.accessCode)
        : ''
    return !document.case_id && metadataAccessCode === normalizeAccessCode(resolveCaseCode(caseRow))
  })
  const signedUrlsByDocumentId = await buildSignedUrlsByDocumentId(supabase, documents)
  const scheduleRows = buildScheduleRowsFromDocs(caseRow, documents)
  const photoSlots = buildPhotoSlots(scheduleRows, documents, signedUrlsByDocumentId)
  const timeline = buildTimeline(caseRow, photoSlots)
  const data = caseRow.data ?? {}
  const totals = resolveAlignerTotals(caseRow)
  const delivered = resolveDelivered(data)
  const changeEveryDays = Math.max(0, asNumber(data.changeEveryDays, 0))
  const nextChangeDate = resolveNextChangeDate(photoSlots, changeEveryDays)
  const lastRecordedSlot = findLastRecordedPhotoSlot(photoSlots)
  const lastRecordedDate = lastRecordedSlot?.recordedAt

  await supabase
    .from('patient_access_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', accessToken.id)

  return json(req, {
    ok: true,
    data: {
      summary: {
        patientId: String(patient.id),
        patientName: String(patient.name ?? 'Paciente'),
        cpfMasked: maskCpf(patient.cpf),
        birthDate: patient.birth_date ? formatPtBrDate(patient.birth_date) : '-',
        clinicName: (clinicRes.data as { trade_name?: string } | null)?.trade_name,
        dentistName: (dentistRes.data as { name?: string } | null)?.name,
        activeCaseCode: resolveCaseCode(caseRow),
        treatmentStatus: toPatientFacingStatus(typeof data.lifecycleStatus === 'string' ? data.lifecycleStatus : caseRow.status),
        nextChangeDate: nextChangeDate ? formatPtBrDate(nextChangeDate) : undefined,
        lastChangeDate: lastRecordedDate ? formatPtBrDate(lastRecordedDate) : undefined,
        productLabel: resolveProductLabel(caseRow),
        treatmentOrigin: asText(data.treatmentOrigin) || undefined,
        changeEveryDays,
        totalTrays: totals.total,
        deliveredTrays: {
          upper: delivered.upper,
          lower: delivered.lower,
        },
        currentTrays: {
          upper: Math.min(delivered.upper, scheduleRows.filter((item) => item.changeDate <= isoToday()).length),
          lower: Math.min(delivered.lower, scheduleRows.filter((item) => item.changeDate <= isoToday()).length),
        },
      },
      accessCode: resolveCaseCode(caseRow),
      timeline,
      photoSlots,
      calendarMonths: buildCalendarMonths(scheduleRows),
      documents: documents.map((document) => ({
        id: String(document.id ?? ''),
        title: String(document.title ?? 'Documento'),
        category: (String(document.category ?? 'outro') as 'identificacao' | 'contrato' | 'consentimento' | 'exame' | 'foto' | 'outro'),
        createdAt: String(document.created_at ?? new Date().toISOString()),
        fileName: document.file_name ?? undefined,
        url: signedUrlsByDocumentId.get(String(document.id ?? '')) ?? undefined,
        note: document.note ?? undefined,
        trayNumber: typeof document.data?.trayNumber === 'number' ? document.data.trayNumber : undefined,
        capturedAt: typeof document.data?.capturedAt === 'string' ? document.data.capturedAt : undefined,
        sentAt: typeof document.data?.sentAt === 'string' ? document.data.sentAt : document.created_at ?? undefined,
        deviceLabel: typeof document.data?.deviceLabel === 'string' ? document.data.deviceLabel : undefined,
        source:
          document.data?.source === 'patient_portal' || document.data?.source === 'internal'
            ? document.data.source
            : undefined,
      })),
    },
  })
})
