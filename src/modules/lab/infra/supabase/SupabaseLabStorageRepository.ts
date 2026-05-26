import {
  createSignedFileUrl,
  deleteFile,
  listFiles,
  uploadFile,
  type StoredFile,
  type UploadResult,
} from '../../../../shared/infra/supabaseStorageService'

export type LabStorageFile = StoredFile

export class SupabaseLabStorageRepository {
  upload(path: string, file: File, onProgress?: (progress: number) => void): Promise<UploadResult> {
    return uploadFile(file, path, onProgress)
  }

  list(prefix = 'lab'): Promise<LabStorageFile[]> {
    return listFiles(prefix)
  }

  createSignedUrl(path: string, expiresIn = 300): Promise<string> {
    return createSignedFileUrl(path, expiresIn)
  }

  async delete(path: string): Promise<void> {
    await deleteFile(path)
  }
}

export function createSupabaseLabStorageRepository() {
  return new SupabaseLabStorageRepository()
}
