import { isValidMobilePhone, onlyDigits } from './phone'
import type { SystemSettings, WhatsappServiceSettings } from './systemSettings'

export type WhatsappServiceMessagePayload = {
  to: string
  message: string
  kind?: string
  metadata?: Record<string, unknown>
}

export type WhatsappServiceSendResult =
  | { ok: true }
  | { ok: false; error: string }

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeWhatsappServiceBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function buildWhatsappServiceUrl(baseUrl?: string, path = '/', adminToken?: string) {
  const normalizedBaseUrl = normalizeWhatsappServiceBaseUrl(baseUrl ?? '')
  if (!normalizedBaseUrl || !isHttpUrl(normalizedBaseUrl)) return ''

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${normalizedBaseUrl}${normalizedPath}`
  const token = adminToken?.trim()
  if (!token) return url

  const params = new URLSearchParams({ token })
  return `${url}?${params.toString()}`
}

export function normalizeWhatsappServiceRecipient(value: string) {
  const digits = onlyDigits(value)
  if (digits.length === 13 && digits.startsWith('55')) {
    const local = digits.slice(2)
    return isValidMobilePhone(local) ? digits : ''
  }
  if (digits.length === 11 && isValidMobilePhone(digits)) return `55${digits}`
  return ''
}

export function isWhatsappServiceReady(config: WhatsappServiceSettings) {
  return config.enabled && isHttpUrl(config.baseUrl) && Boolean(config.adminToken.trim())
}

async function parseProviderError(response: Response) {
  const text = await response.text()
  if (!text.trim()) return `Falha no servico WhatsApp (${response.status}).`
  try {
    const json = JSON.parse(text) as { error?: unknown; message?: unknown }
    const message = typeof json.error === 'string'
      ? json.error
      : typeof json.message === 'string'
        ? json.message
        : ''
    return message || `Falha no servico WhatsApp (${response.status}).`
  } catch {
    return text.slice(0, 240)
  }
}

export async function sendWhatsappServiceMessage(
  settings: Pick<SystemSettings, 'whatsappService'>,
  payload: WhatsappServiceMessagePayload,
): Promise<WhatsappServiceSendResult> {
  const config = settings.whatsappService
  if (!config.enabled) return { ok: false, error: 'Servico WhatsApp desativado.' }
  if (!isWhatsappServiceReady(config)) return { ok: false, error: 'Servico WhatsApp nao configurado.' }

  const phone = normalizeWhatsappServiceRecipient(payload.to)
  if (!phone) return { ok: false, error: 'WhatsApp de destino invalido.' }

  const message = payload.message.trim()
  if (!message) return { ok: false, error: 'Mensagem obrigatoria.' }

  try {
    const response = await fetch(buildWhatsappServiceUrl(config.baseUrl, '/send'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.adminToken.trim()}`,
      },
      body: JSON.stringify({
        phone,
        message,
        kind: payload.kind ?? 'manual',
        metadata: payload.metadata ?? {},
      }),
    })

    if (!response.ok) return { ok: false, error: await parseProviderError(response) }

    const result = await response.json().catch(() => ({ ok: true })) as WhatsappServiceSendResult
    if (!result.ok) return { ok: false, error: result.error || 'Falha ao enviar WhatsApp.' }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao chamar servico WhatsApp.',
    }
  }
}
