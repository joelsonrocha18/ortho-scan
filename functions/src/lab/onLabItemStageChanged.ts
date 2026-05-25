import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { LabItemDoc, StageEvent } from './types'

export const onLabItemStageChanged = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('lab_items/{labItemId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as LabItemDoc
    const after = change.after.data() as LabItemDoc

    const stageChanged = before.stage !== after.stage
    const subStatusChanged = before.sub_status_id !== after.sub_status_id

    if (!stageChanged && !subStatusChanged) return null

    const { labItemId } = context.params
    const caseId = after.case_id

    if (!caseId) {
      functions.logger.warn('lab_item sem case_id', { labItemId })
      return null
    }

    const history = Array.isArray(after.stage_history) ? after.stage_history : []
    const latestEvent: StageEvent | undefined = history[history.length - 1]

    const timelineEvent = {
      type: 'lab_stage_changed',
      lab_item_id: labItemId,
      from_sub_status_id: latestEvent?.from_sub_status_id ?? before.sub_status_id ?? '',
      to_sub_status_id: latestEvent?.to_sub_status_id ?? after.sub_status_id,
      from_stage: latestEvent?.from_stage ?? before.stage,
      to_stage: latestEvent?.to_stage ?? after.stage,
      moved_by_uid: latestEvent?.moved_by_uid ?? 'system',
      moved_at: latestEvent?.moved_at ?? after.updated_at,
      ...(latestEvent?.note ? { note: latestEvent.note } : {}),
    }

    const caseRef = db.collection('cases').doc(caseId)

    try {
      await caseRef.update({
        lab_stage: after.stage,
        lab_sub_status_id: after.sub_status_id,
        current_lab_item_id: labItemId,
        timeline: FieldValue.arrayUnion(timelineEvent),
        updated_at: FieldValue.serverTimestamp(),
      })

      functions.logger.info('Case atualizado pelo lab trigger', {
        labItemId,
        caseId,
        fromStage: before.stage,
        toStage: after.stage,
      })
    } catch (err) {
      functions.logger.error('Erro ao atualizar case no trigger', {
        labItemId,
        caseId,
        err,
      })
      throw err
    }

    return null
  })
