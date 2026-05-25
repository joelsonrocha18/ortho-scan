import * as functions from 'firebase-functions/v1'
import { db, admin } from '../shared/admin'
import type { NotificationPayload } from './types'

function tokenDocId(token: string) {
  return Buffer.from(token).toString('base64url').slice(0, 100)
}

export async function sendPushToUser(uid: string, payload: NotificationPayload): Promise<void> {
  const tokensSnap = await db.collection('user_fcm_tokens').doc(uid).collection('tokens').get()
  if (tokensSnap.empty) return

  const tokens = tokensSnap.docs
    .map((document) => document.data().token)
    .filter((token): token is string => typeof token === 'string' && token.trim().length > 0)

  if (tokens.length === 0) return

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data ?? {},
    webpush: payload.icon || payload.badge
      ? {
          notification: {
            icon: payload.icon,
            badge: payload.badge,
          },
        }
      : undefined,
  })

  const invalidTokenDeletes: Array<Promise<FirebaseFirestore.WriteResult>> = []
  response.responses.forEach((sendResponse, index) => {
    if (sendResponse.success) return
    const errorCode = sendResponse.error?.code
    if (
      errorCode === 'messaging/invalid-registration-token' ||
      errorCode === 'messaging/registration-token-not-registered'
    ) {
      const token = tokens[index]
      if (!token) return
      invalidTokenDeletes.push(
        db.collection('user_fcm_tokens').doc(uid).collection('tokens').doc(tokenDocId(token)).delete(),
      )
    }
  })

  if (invalidTokenDeletes.length > 0) {
    await Promise.all(invalidTokenDeletes)
    functions.logger.info('Tokens FCM invalidos removidos.', { uid, count: invalidTokenDeletes.length })
  }
}
