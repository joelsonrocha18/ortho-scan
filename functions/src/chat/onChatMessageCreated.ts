import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { ChatMessage } from './types'

const attachmentPreviewByType: Record<string, string> = {
  image: '[Imagem]',
  file: '[Arquivo]',
  audio: '[Audio]',
}

export const onChatMessageCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('chat_rooms/{roomId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data() as ChatMessage
    const roomId = context.params.roomId
    const roomRef = db.collection('chat_rooms').doc(roomId)
    const roomSnap = await roomRef.get()

    if (!roomSnap.exists) {
      functions.logger.warn('Sala nao encontrada para trigger de mensagem', { roomId })
      return null
    }

    const room = roomSnap.data()
    const participants = Array.isArray(room?.participant_uids)
      ? room.participant_uids.filter((uid): uid is string => typeof uid === 'string')
      : []
    const unreadUpdate: Record<string, FieldValue> = {}

    for (const uid of participants) {
      if (uid !== msg.sender_uid) {
        unreadUpdate[`unread_counts.${uid}`] = FieldValue.increment(1)
      }
    }

    let preview = msg.text?.trim() ?? ''
    if (!preview) preview = attachmentPreviewByType[msg.type] ?? ''
    if (preview.length > 80) preview = `${preview.slice(0, 80)}...`

    await roomRef.update({
      last_message_text: preview,
      last_message_at: msg.created_at,
      last_message_by_uid: msg.sender_uid,
      ...unreadUpdate,
    })

    return null
  })
