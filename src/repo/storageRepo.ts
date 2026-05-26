import { DATA_MODE } from '../data/dataMode'
import { logger } from '../lib/logger'
import { createValidationError, getErrorMessage } from '../shared/errors'
import {
  createSignedFileUrl,
  deleteFile,
  downloadFileBlob,
  uploadFile,
} from '../shared/infra/supabaseStorageService'
import { buildUtcTimestampToken, sanitizeTokenSegment } from '../shared/utils/id'

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
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
    throw createValidationError('Caminho de armazenamento invalido.')
  }
  return normalized
}

function isLocalMockStorageEnabled() {
  return DATA_MODE === 'local'
}

function createLocalMockSignedUrl(path: string) {
  const entry = localMockStorage.get(path)
  if (!entry) {
    return { ok: false as const, error: 'Arquivo local simulado nao encontrado. Reenvie o arquivo nesta sessao.' }
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
    await uploadFile(file, safePath)
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
    return { ok: true as const, url: await createSignedFileUrl(safePath, expiresIn) }
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
      if (!entry) return { ok: false as const, error: 'Arquivo local simulado nao encontrado. Reenvie o arquivo nesta sessao.' }
      return { ok: true as const, blob: entry.file }
    }
    return { ok: true as const, blob: await downloadFileBlob(safePath) }
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
    await deleteFile(safePath)
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
    return { ok: false as const, error: 'Tipo de arquivo nao permitido.' }
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
