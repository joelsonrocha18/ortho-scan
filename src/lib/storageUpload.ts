import { DATA_MODE } from '../data/dataMode'
import { storage } from './firebaseClient'
import { createTimestampedToken, sanitizeTokenSegment } from '../shared/utils/id'
import { logger } from './logger'
import { uploadFile } from '../shared/infra/firebaseStorageService'

type UploadScope = 'scans' | 'patient-docs'

type UploadResult = {
  url: string
  path: string
}

function sanitizeFileName(name: string) {
  return sanitizeTokenSegment(name || 'arquivo.bin', {
    lowerCase: false,
    trimUnderscores: false,
    fallback: 'arquivo.bin',
  })
}

function uniquePath(scope: UploadScope, clinicId: string, ownerId: string, fileName: string) {
  const safeName = sanitizeFileName(fileName || 'arquivo.bin')
  const stamp = createTimestampedToken()
  return `${scope}/${clinicId}/${ownerId}/${stamp}_${safeName}`
}

export async function uploadFileToStorage(
  file: File,
  params: { scope: UploadScope; clinicId?: string; ownerId: string },
): Promise<UploadResult | null> {
  if (DATA_MODE !== 'firebase' || !storage) {
    return null
  }
  if (!params.clinicId) {
    return null
  }

  const path = uniquePath(params.scope, params.clinicId, params.ownerId, file.name)
  try {
    return uploadFile(file, path)
  } catch (error) {
    logger.error(
      'Falha ao enviar arquivo para Firebase Storage.',
      {
        scope: params.scope,
        clinicId: params.clinicId,
        ownerId: params.ownerId,
        fileName: file.name,
        fileType: file.type,
        path,
      },
      error,
    )
    return null
  }
}
