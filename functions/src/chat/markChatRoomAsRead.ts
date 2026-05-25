import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'

type RequestBody = {
  roomId: string
  lastMessageId?: string
}

export const markChatRoomAsRead = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (data: RequestBody, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const uid = context.auth.uid
    const roomId = data.roomId?.trim()
    const lastMessageId = data.lastMessageId?.trim()

    if (!roomId) {
      throw new functions.https.HttpsError('invalid-argument', 'roomId e obrigatorio.')
    }

    const roomRef = db.collection('chat_rooms').doc(roomId)
    const roomSnap = await roomRef.get()

    if (!roomSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Sala nao encontrada.')
    }

    const room = roomSnap.data()
    const participants = Array.isArray(room?.participant_uids)
      ? room.participant_uids
      : []

    if (!participants.includes(uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Usuario nao e participante.')
    }

    await roomRef.update({
      [`unread_counts.${uid}`]: 0,
    })

    if (lastMessageId) {
      await roomRef.collection('messages').doc(lastMessageId).update({
        [`read_by.${uid}`]: Timestamp.now(),
      })
    }

    return { success: true }
  })
