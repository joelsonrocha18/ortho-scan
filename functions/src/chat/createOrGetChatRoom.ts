import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { ChatParticipantRole } from './types'

type CreateRoomInput = {
  caseId: string
}

const allowedRoles = [
  'master_admin',
  'dentist_admin',
  'lab_tech',
  'receptionist',
  'dentist_client',
]

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asRole(value: unknown): ChatParticipantRole | null {
  return allowedRoles.includes(asText(value)) ? asText(value) as ChatParticipantRole : null
}

export const createOrGetChatRoom = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: CreateRoomInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const callerRole = asText(context.auth.token.role)
    if (!allowedRoles.includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Perfil nao autorizado.')
    }

    const caseId = data.caseId?.trim()
    if (!caseId) {
      throw new functions.https.HttpsError('invalid-argument', 'caseId e obrigatorio.')
    }

    const roomId = `case_${caseId}`
    const roomRef = db.collection('chat_rooms').doc(roomId)
    const roomSnap = await roomRef.get()

    if (roomSnap.exists) {
      return { roomId, existed: true }
    }

    const caseSnap = await db.collection('cases').doc(caseId).get()
    if (!caseSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Caso nao encontrado.')
    }

    const caseData = caseSnap.data()
    if (!caseData) {
      throw new functions.https.HttpsError('not-found', 'Caso sem dados.')
    }

    const clinicId = asText(caseData.clinic_id ?? caseData.clinicId)
    const dentistId = asText(caseData.dentist_id ?? caseData.dentistId)

    if (!clinicId) {
      throw new functions.https.HttpsError('failed-precondition', 'Caso sem clinica vinculada.')
    }

    const internalSnap = await db.collection('profiles')
      .where('clinicId', '==', clinicId)
      .where('isActive', '==', true)
      .get()

    const participantUids: string[] = []
    const participantRoles: Record<string, ChatParticipantRole> = {}
    const unreadCounts: Record<string, number> = {}

    for (const document of internalSnap.docs) {
      const profile = document.data()
      const role = asRole(profile.role)
      if (!role || role === 'dentist_client') continue
      participantUids.push(document.id)
      participantRoles[document.id] = role
      unreadCounts[document.id] = 0
    }

    if (dentistId) {
      const dentistProfileSnap = await db.collection('profiles')
        .where('dentistId', '==', dentistId)
        .where('role', '==', 'dentist_client')
        .limit(1)
        .get()

      if (!dentistProfileSnap.empty) {
        const dentistUid = dentistProfileSnap.docs[0].id
        if (!participantUids.includes(dentistUid)) {
          participantUids.push(dentistUid)
          participantRoles[dentistUid] = 'dentist_client'
          unreadCounts[dentistUid] = 0
        }
      }
    }

    const callerRoleTyped = asRole(callerRole)
    if (callerRoleTyped && !participantUids.includes(context.auth.uid)) {
      participantUids.push(context.auth.uid)
      participantRoles[context.auth.uid] = callerRoleTyped
      unreadCounts[context.auth.uid] = 0
    }

    const now = Timestamp.now()

    await roomRef.set({
      id: roomId,
      case_id: caseId,
      clinic_id: clinicId,
      dentist_id: dentistId,
      participant_uids: participantUids,
      participant_roles: participantRoles,
      last_message_text: '',
      last_message_at: now,
      last_message_by_uid: '',
      unread_counts: unreadCounts,
      created_at: now,
    })

    return { roomId, existed: false }
  })
