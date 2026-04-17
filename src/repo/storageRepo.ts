import { getSupabaseAccessToken } from '../lib/auth'
import { logger } from '../lib/logger'
import { supabase } from '../lib/supabaseClient'
import { DATA_MODE } from '../data/dataMode'
import { createValidationError, getErrorMessage } from '../shared/errors'
import { buildUtcTimestampToken, sanitizeTokenSegment } from '../shared/utils/id'

const BUCKET = 'orthoscan'
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const STORAGE_PROVIDER = ((import.meta.env.VITE_STORAGE_PROVIDER as string | undefined) ?? 'supabase').trim().toLowerCase()
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const localMockStorage = new Map<string, { file: File; createdAt: string }>()

function fileNameWithTimestamp(fileName: string, params: { patientId?: string; origin?: string }) {
  const cleaned = sanitizeTokenSegment(fileName || 'arquivo', { fallback: 'arquivo' })
  const patientToken = sanitizeTokenSegment(params.patientId || 'sem_paciente', { fallback: 'sem_paciente' })
  const originToken = sanitizeTokenSegment(params.origin || 'origem_desconhecida', { fallback: 'origem_desconhecida' })
  return `${patientToken}_${buildUtcTimestampToken()}_${originToken}_${cleaned || 'arquivo'}`
}

function assertStoragePath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('//')) {
    throw createValidationError('Caminho de armazenamento inválido.')
  }
  return normalized
}

function isLocalMockStorageEnabled() {
  return DATA_MODE === 'local'
}

function createLocalMockSignedUrl(path: string) {
  const entry = localMockStorage.get(path)
  if (!entry) {
    return { ok: false as const, error: 'Arquivo local simulado não encontrado. Reenvie o arquivo nesta sessão.' }
  }
  return { ok: true as const, url: URL.createObjectURL(entry.file) }
}

export function buildPatientDocPath(params: { clinicId: string; patientId: string; fileName: string }) {
  return `clinics/${sanitizeTokenSegment(params.clinicId)}/patients/${sanitizeTokenSegment(params.patientId)}/documents/${fileNameWithTimestamp(params.fileName, {
    patientId: params.patientId,
    origin: 'patient_doc',
  })}`
}

export function buildScanAttachmentPath(params: {
  clinicId: string
  scanId: string
  patientId?: string
  kind: string
  fileName: string
}) {
  return `clinics/${sanitizeTokenSegment(params.clinicId)}/scans/${sanitizeTokenSegment(params.scanId)}/${sanitizeTokenSegment(params.kind)}/${fileNameWithTimestamp(params.fileName, {
    patientId: params.patientId,
    origin: params.kind,
  })}`
}

export async function uploadToStorage(path: string, file: File) {
  try {
    const safePath = assertStoragePath(path)
    if (isLocalMockStorageEnabled()) {
      localMockStorage.set(safePath, { file, createdAt: new Date().toISOString() })
      return { ok: true as const, path: safePath }
    }
    if (STORAGE_PROVIDER === 'microsoft_drive') {
      return uploadToMicrosoftDrive(safePath, file)
    }
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { error } = await supabase.storage.from(BUCKET).upload(safePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    })
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const, path: safePath }
  } catch (error) {
    logger.error('Falha ao enviar arquivo ao storage.', { flow: 'storage.upload', path, fileName: file.name }, error)
    return { ok: false as const, error: getErrorMessage(error, 'Falha ao enviar arquivo.') }
  }
}

export async function createSignedUrl(path: string, expiresIn = 300) {
  try {
    const safePath = assertStoragePath(path)
    if (isLocalMockStorageEnabled()) {
      return createLocalMockSignedUrl(safePath)
    }
    if (STORAGE_PROVIDER === 'microsoft_drive') {
      return resolveMicrosoftDriveDownloadUrl(safePath)
    }
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(safePath, expiresIn)
    if (error || !data?.signedUrl) return { ok: false as const, error: error?.message ?? 'Falha ao gerar URL assinada.' }
    return { ok: true as const, url: data.signedUrl }
  } catch (error) {
    logger.error('Falha ao gerar URL assinada.', { flow: 'storage.create_signed_url', path }, error)
    return { ok: false as const, error: getErrorMessage(error, 'Falha ao gerar URL assinada.') }
  }
}

export async function downloadBlob(path: string) {
  try {
    const safePath = assertStoragePath(path)
    if (isLocalMockStorageEnabled()) {
      const entry = localMockStorage.get(safePath)
      if (!entry) return { ok: false as const, error: 'Arquivo local simulado não encontrado. Reenvie o arquivo nesta sessão.' }
      return { ok: true as const, blob: entry.file }
    }
    if (STORAGE_PROVIDER === 'microsoft_drive') {
      const resolved = await resolveMicrosoftDriveDownloadUrl(safePath)
      if (!resolved.ok) return resolved
      const response = await fetch(resolved.url)
      if (!response.ok) return { ok: false as const, error: 'Falha ao baixar arquivo no Microsoft Drive.' }
      const blob = await response.blob()
      return { ok: true as const, blob }
    }
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { data, error } = await supabase.storage.from(BUCKET).download(safePath)
    if (error || !data) return { ok: false as const, error: error?.message ?? 'Falha ao baixar arquivo.' }
    return { ok: true as const, blob: data }
  } catch (error) {
    logger.error('Falha ao baixar arquivo do storage.', { flow: 'storage.download', path }, error)
    return { ok: false as const, error: getErrorMessage(error, 'Falha ao baixar arquivo.') }
  }
}

export async function deleteFromStorage(path: string) {
  try {
    const safePath = assertStoragePath(path)
    if (isLocalMockStorageEnabled()) {
      localMockStorage.delete(safePath)
      return { ok: true as const }
    }
    if (STORAGE_PROVIDER === 'microsoft_drive') {
      return deleteFromMicrosoftDrive(safePath)
    }
    if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
    const { error } = await supabase.storage.from(BUCKET).remove([safePath])
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  } catch (error) {
    logger.error('Falha ao remover arquivo do storage.', { flow: 'storage.delete', path }, error)
    return { ok: false as const, error: getErrorMessage(error, 'Falha ao remover arquivo.') }
  }
}

function fileExt(fileName: string) {
  const idx = fileName.lastIndexOf('.')
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : ''
}

function validateFile(file: File, allowedExt: string[], allowedMimePrefixes: string[]) {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false as const, error: 'Arquivo excede o limite de 50MB.' }
  }
  const ext = fileExt(file.name)
  const mime = (file.type || '').toLowerCase()
  const extOk = allowedExt.length === 0 || allowedExt.includes(ext)
  const mimeOk = allowedMimePrefixes.length === 0 || allowedMimePrefixes.some((prefix) => mime.startsWith(prefix))
  if (!extOk && !mimeOk) {
    return { ok: false as const, error: 'Tipo de arquivo não permitido.' }
  }
  return { ok: true as const }
}

export function validatePatientDocFile(file: File) {
  return validateFile(
    file,
    ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.doc', '.docx'],
    ['application/pdf', 'image/', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  )
}

export function validateScanAttachmentFile(file: File, kind: string) {
  if (kind === 'scan3d') {
    return validateFile(file, ['.stl', '.obj', '.ply'], ['application/sla', 'model/', 'application/octet-stream'])
  }
  if (kind === 'foto_intra' || kind === 'foto_extra') {
    return validateFile(file, ['.jpg', '.jpeg', '.png', '.heic'], ['image/'])
  }
  if (kind === 'raiox' || kind === 'dicom') {
    return validateFile(file, ['.pdf', '.jpg', '.jpeg', '.png', '.dcm', '.zip'], ['image/', 'application/pdf', 'application/zip', 'application/octet-stream'])
  }
  return validateFile(file, [], [])
}

async function readAccessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? getSupabaseAccessToken() ?? null
}

function msFunctionUrl() {
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ms-drive-storage`
}

async function callMicrosoftDriveFunction(params: {
  action: 'create-link' | 'delete' | 'download-url'
  path: string
  expiresIn?: number
}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Supabase env ausente para chamar ms-drive-storage.' }
  }
  const token = await readAccessToken()
  if (!token) return { ok: false as const, error: 'Sessão expirada. Saia e entre novamente.' }

  const response = await fetch(msFunctionUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-jwt': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...params, path: assertStoragePath(params.path) }),
  })

  let payload: { ok?: boolean; error?: string; url?: string } | null = null
  try {
    payload = (await response.json()) as { ok?: boolean; error?: string; url?: string }
  } catch {
    payload = null
  }
  if (!response.ok || !payload?.ok) {
    return { ok: false as const, error: payload?.error ?? `Falha ms-drive-storage (${response.status}).` }
  }
  return { ok: true as const, url: payload.url }
}

async function uploadToMicrosoftDrive(path: string, file: File) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false as const, error: 'Supabase env ausente para chamar ms-drive-storage.' }
  }
  const token = await readAccessToken()
  if (!token) return { ok: false as const, error: 'Sessão expirada. Saia e entre novamente.' }

  const form = new FormData()
  form.set('action', 'upload')
  form.set('path', assertStoragePath(path))
  form.set('file', file, file.name)

  const response = await fetch(msFunctionUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-jwt': token,
    },
    body: form,
  })

  let payload: { ok?: boolean; error?: string } | null = null
  try {
    payload = (await response.json()) as { ok?: boolean; error?: string }
  } catch {
    payload = null
  }
  if (!response.ok || !payload?.ok) {
    return { ok: false as const, error: payload?.error ?? `Falha ms-drive-storage (${response.status}).` }
  }
  return { ok: true as const, path: assertStoragePath(path) }
}

async function resolveMicrosoftDriveDownloadUrl(path: string) {
  const response = await callMicrosoftDriveFunction({ action: 'download-url', path })
  if (!response.ok || !response.url) {
    return { ok: false as const, error: response.error ?? 'Falha ao resolver download no Microsoft Drive.' }
  }
  return { ok: true as const, url: response.url }
}

async function deleteFromMicrosoftDrive(path: string) {
  const response = await callMicrosoftDriveFunction({ action: 'delete', path })
  if (!response.ok) return { ok: false as const, error: response.error ?? 'Falha ao remover arquivo no Microsoft Drive.' }
  return { ok: true as const }
}
