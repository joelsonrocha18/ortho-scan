type MonitoringPayload = {
  app?: string
  type?: string
  message?: string
  stack?: string
  url?: string
  userAgent?: string
  release?: string
  ts?: string
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

function limitText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return redact(trimmed).slice(0, maxLength)
}

function redact(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/(token|password|senha|apikey|api_key|secret)=([^&\s]+)/gi, '$1=[REDACTED]')
}

function normalizePayload(raw: MonitoringPayload) {
  return {
    app: limitText(raw.app, 48) ?? 'orthoscan',
    type: raw.type === 'unhandledrejection' ? 'unhandledrejection' : 'error',
    message: limitText(raw.message, 500) ?? 'Erro sem mensagem.',
    stack: limitText(raw.stack, 5000),
    url: limitText(raw.url, 500),
    userAgent: limitText(raw.userAgent, 500),
    release: limitText(raw.release, 80),
    ts: limitText(raw.ts, 80) ?? new Date().toISOString(),
  }
}

function isDiscordWebhook(url: string) {
  return /discord\.com\/api\/webhooks\//i.test(url)
}

function buildDiscordPayload(payload: ReturnType<typeof normalizePayload>) {
  const title = payload.type === 'error' ? 'Erro capturado' : 'Promise rejeitada'
  const lines = [
    `OrthoScan Monitor - ${title}`,
    `Mensagem: ${payload.message}`,
    `URL: ${payload.url ?? 'n/a'}`,
    `Release: ${payload.release ?? 'n/a'}`,
    `Timestamp: ${payload.ts}`,
  ]
  if (payload.stack) {
    lines.push('', 'Stack:', `\`\`\`${payload.stack.slice(0, 1200)}\`\`\``)
  }
  return {
    content: lines.join('\n').slice(0, 1900),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const webhookUrl = (Deno.env.get('MONITORING_WEBHOOK_URL') ?? Deno.env.get('DISCORD_MONITORING_WEBHOOK_URL') ?? '').trim()
  if (!webhookUrl) return json(req, { ok: false, error: 'MONITORING_WEBHOOK_URL ausente.' })

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 64_000) return json(req, { ok: false, error: 'Payload muito grande.' }, 413)

  let payload: ReturnType<typeof normalizePayload>
  try {
    payload = normalizePayload(await req.json() as MonitoringPayload)
  } catch {
    return json(req, { ok: false, error: 'JSON inválido.' }, 400)
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isDiscordWebhook(webhookUrl) ? buildDiscordPayload(payload) : payload),
  })

  if (!response.ok) {
    return json(req, { ok: false, error: 'Falha ao encaminhar monitoramento.' }, 502)
  }

  return json(req, { ok: true })
})
