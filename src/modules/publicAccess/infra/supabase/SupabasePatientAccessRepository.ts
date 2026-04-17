import { err, ok, type Result } from '../../../../shared/errors'
import { supabase } from '../../../../lib/supabaseClient'
import type {
  PatientAccessIdentityInput,
  PatientAccessPreview,
  PatientAccessRepository,
  PatientMagicLinkReceipt,
  PatientPortalAccessInput,
} from '../../application/ports/PatientAccessRepository'
import type {
  PatientPortalPhotoUploadInput,
  PatientPortalPhotoUploadReceipt,
  PatientPortalSession,
  PatientPortalSnapshot,
} from '../../domain/models/PatientPortal'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

type FunctionSuccess<T> = {
  ok: true
  data: T
}

type FunctionFailure = {
  ok?: false
  error?: string
}

async function parseFunctionResponse<T>(response: Response): Promise<Result<T, string>> {
  let payload: FunctionSuccess<T> | FunctionFailure | null = null
  let rawText = ''

  try {
    payload = (await response.json()) as FunctionSuccess<T> | FunctionFailure | null
  } catch {
    try {
      rawText = (await response.text()).trim()
    } catch {
      rawText = ''
    }
  }

  const payloadError =
    payload && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : rawText || 'Falha ao processar a solicitacao.'

  if (!response.ok || !payload?.ok) {
    return err(payloadError)
  }

  return ok(payload.data)
}

async function invokePublicFunction<T>(name: string, body: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !supabase) {
    return err('Supabase não configurado.')
  }

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    return parseFunctionResponse<T>(response)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Falha de conexão com o portal do paciente.')
  }
}

async function uploadPublicPhoto(input: PatientPortalPhotoUploadInput): Promise<Result<PatientPortalPhotoUploadReceipt, string>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return err('Supabase não configurado.')

  const form = new FormData()
  form.set('token', input.token)
  form.set('accessCode', input.accessCode)
  form.set('trayNumber', String(input.trayNumber))
  form.set('capturedAt', input.capturedAt)
  if (input.sentAt?.trim()) {
    form.set('sentAt', input.sentAt.trim())
  }
  if (input.deviceLabel?.trim()) {
    form.set('deviceLabel', input.deviceLabel.trim())
  }
  if (input.note?.trim()) {
    form.set('note', input.note.trim())
  }
  form.set('file', input.file, input.file.name)

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/patient-upload-progress-photo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: form,
  })

  let payload: FunctionSuccess<PatientPortalPhotoUploadReceipt> | FunctionFailure | null = null
  try {
    payload = (await response.json()) as FunctionSuccess<PatientPortalPhotoUploadReceipt> | FunctionFailure | null
  } catch {
    payload = null
  }

  const payloadError =
    payload && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'Falha ao enviar a foto do tratamento.'

  if (!response.ok || !payload?.ok) {
    return err(payloadError)
  }

  return ok(payload.data)
}

export class SupabasePatientAccessRepository implements PatientAccessRepository {
  async validateIdentity(input: PatientAccessIdentityInput): Promise<Result<PatientAccessPreview, string>> {
    return invokePublicFunction<PatientAccessPreview>('patient-access-lookup', input)
  }

  async requestMagicLink(input: PatientAccessIdentityInput): Promise<Result<PatientMagicLinkReceipt, string>> {
    return invokePublicFunction<PatientMagicLinkReceipt>('patient-request-magic-link', input)
  }

  async resolveMagicLink(token: string): Promise<Result<PatientAccessPreview, string>> {
    return invokePublicFunction<PatientAccessPreview>('patient-access-session', { token })
  }

  async startPortalSession(input: PatientPortalAccessInput): Promise<Result<PatientPortalSession, string>> {
    return invokePublicFunction<PatientPortalSession>('patient-access-lookup', input)
  }

  async resolvePortalSession(input: { token: string; accessCode?: string }): Promise<Result<PatientPortalSnapshot, string>> {
    return invokePublicFunction<PatientPortalSnapshot>('patient-access-session', input)
  }

  async uploadPortalPhoto(input: PatientPortalPhotoUploadInput): Promise<Result<PatientPortalPhotoUploadReceipt, string>> {
    return uploadPublicPhoto(input)
  }
}

export function createSupabasePatientAccessRepository() {
  return new SupabasePatientAccessRepository()
}
