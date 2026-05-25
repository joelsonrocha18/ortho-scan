import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { FcmPlatform } from './types'

const allowedPlatforms: FcmPlatform[] = ['web', 'android', 'ios']

function tokenDocId(token: string) {
  return Buffer.from(token).toString('base64url').slice(0, 100)
}

export const registerFcmToken = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (data: { token?: string; platform?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const token = data.token?.trim()
    const platform = data.platform?.trim() as FcmPlatform | undefined

    if (!token || !platform || !allowedPlatforms.includes(platform)) {
      throw new functions.https.HttpsError('invalid-argument', 'token e platform validos sao obrigatorios.')
    }

    const uid = context.auth.uid
    const now = Timestamp.now()
    const tokenRef = db.collection('user_fcm_tokens').doc(uid).collection('tokens').doc(tokenDocId(token))

    await tokenRef.set({
      uid,
      token,
      platform,
      created_at: now,
      last_used_at: now,
    }, { merge: true })

    return { success: true }
  })
