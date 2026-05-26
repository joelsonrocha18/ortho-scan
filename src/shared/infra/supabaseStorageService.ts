import { SUPABASE_STORAGE_BUCKET, requireSupabaseClient } from '../../lib/supabaseClient'

export type UploadResult = {
  url: string
  path: string
  contentType: string
}

export type StoredFile = {
  id: string
  name: string
  path: string
  size?: number
  contentType?: string
  createdAt?: string
  updatedAt?: string
}

function normalizeStoragePath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..') || normalized.includes('//')) {
    throw new Error('Caminho de armazenamento invalido.')
  }
  return normalized
}

function normalizePrefix(prefix = '') {
  const normalized = prefix.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (normalized.includes('..') || normalized.includes('//')) {
    throw new Error('Prefixo de armazenamento invalido.')
  }
  return normalized
}

function storageBucket() {
  return requireSupabaseClient().storage.from(SUPABASE_STORAGE_BUCKET)
}

export async function createSignedFileUrl(path: string, expiresIn = 300) {
  const safePath = normalizeStoragePath(path)
  const { data, error } = await storageBucket().createSignedUrl(safePath, expiresIn)
  if (error || !data?.signedUrl) {
    throw error ?? new Error('Nao foi possivel gerar URL assinada no Supabase Storage.')
  }
  return data.signedUrl
}

export async function uploadFile(
  file: File,
  path: string,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  const safePath = normalizeStoragePath(path)
  const contentType = file.type || 'application/octet-stream'
  onProgress?.(5)
  const { error } = await storageBucket().upload(safePath, file, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  })
  if (error) throw error
  onProgress?.(95)
  const url = await createSignedFileUrl(safePath)
  onProgress?.(100)
  return { url, path: safePath, contentType }
}

export async function listFiles(prefix = ''): Promise<StoredFile[]> {
  const safePrefix = normalizePrefix(prefix)
  const { data, error } = await storageBucket().list(safePrefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw error
  return (data ?? []).map((file) => {
    const metadata = (file.metadata ?? {}) as Record<string, unknown>
    const path = safePrefix ? `${safePrefix}/${file.name}` : file.name
    const size = typeof metadata.size === 'number' ? metadata.size : undefined
    const contentType = typeof metadata.mimetype === 'string' ? metadata.mimetype : undefined
    return {
      id: file.id ?? path,
      name: file.name,
      path,
      size,
      contentType,
      createdAt: file.created_at ?? undefined,
      updatedAt: file.updated_at ?? undefined,
    }
  })
}

export async function downloadFileBlob(path: string) {
  const safePath = normalizeStoragePath(path)
  const { data, error } = await storageBucket().download(safePath)
  if (error || !data) {
    throw error ?? new Error('Nao foi possivel baixar arquivo no Supabase Storage.')
  }
  return data
}

export async function deleteFile(path: string) {
  const safePath = normalizeStoragePath(path)
  const { error } = await storageBucket().remove([safePath])
  if (error) throw error
}
