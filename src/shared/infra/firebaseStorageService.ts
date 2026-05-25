import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { storage } from '../../lib/firebaseClient'

export type UploadResult = {
  url: string
  path: string
  contentType: string
}

function getFirebaseStorage() {
  if (!storage) {
    throw new Error('Firebase Storage nao configurado.')
  }
  return storage
}

export async function uploadFile(
  file: File,
  path: string,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  const storageRef = ref(getFirebaseStorage(), path)
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: 'public,max-age=3600',
  })

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = snapshot.totalBytes > 0
          ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          : 0
        onProgress?.(progress)
      },
      reject,
      () => {
        void (async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref)
          resolve({
            url,
            path,
            contentType: file.type || 'application/octet-stream',
          })
        })().catch(reject)
      },
    )
  })
}
