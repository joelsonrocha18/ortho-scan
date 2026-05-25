import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { LabStage, StageEvent } from './types'

type RequestBody = {
  labItemId: string
  toSubStatusId: string
  toStage: LabStage
  note?: string
}

const allowedRoles = ['master_admin', 'dentist_admin', 'lab_tech', 'receptionist']

export const updateLabCaseStage = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: RequestBody, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Usuario nao autenticado.',
      )
    }

    const callerUid = context.auth.uid
    const callerToken = context.auth.token
    const role = typeof callerToken.role === 'string' ? callerToken.role : ''

    if (!allowedRoles.includes(role)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Perfil nao autorizado para esta operacao.',
      )
    }

    const { labItemId, toSubStatusId, toStage, note } = data

    if (!labItemId || !toSubStatusId || !toStage) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'labItemId, toSubStatusId e toStage sao obrigatorios.',
      )
    }

    const labItemRef = db.collection('lab_items').doc(labItemId)
    const labItemSnap = await labItemRef.get()

    if (!labItemSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Lab item nao encontrado.')
    }

    const labItem = labItemSnap.data()

    if (!labItem) {
      throw new functions.https.HttpsError('not-found', 'Lab item sem dados.')
    }

    if (role !== 'master_admin' && callerToken.clinicId !== labItem.clinic_id) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Lab item pertence a outra clinica.',
      )
    }

    const stageEvent: StageEvent = {
      from_sub_status_id: labItem.sub_status_id ?? '',
      to_sub_status_id: toSubStatusId,
      from_stage: labItem.stage,
      to_stage: toStage,
      moved_by_uid: callerUid,
      moved_at: Timestamp.now(),
      ...(note ? { note } : {}),
    }

    await labItemRef.update({
      stage: toStage,
      sub_status_id: toSubStatusId,
      stage_history: FieldValue.arrayUnion(stageEvent),
      updated_at: FieldValue.serverTimestamp(),
    })

    functions.logger.info('Stage atualizado via OrthoCam QR', {
      labItemId,
      callerUid,
      fromStage: labItem.stage,
      toStage,
    })

    return { success: true, labItemId, toStage }
  })
