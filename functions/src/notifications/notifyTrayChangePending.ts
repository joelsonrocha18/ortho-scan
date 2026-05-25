import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import { sendPushToUser } from './sendPushToUser'

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const notifyTrayChangePending = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .pubsub.schedule('0 9 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = Timestamp.fromMillis(today.getTime())

    const casesSnap = await db.collection('cases')
      .where('patient_portal_enabled', '==', true)
      .where('status', 'in', ['in_use', 'em_tratamento'])
      .get()

    for (const caseDocument of casesSnap.docs) {
      const caseData = caseDocument.data()
      const patientId = asText(caseData.patient_id ?? caseData.patientId)
      if (!patientId) continue

      const currentTray = asNumber(caseData.current_tray ?? caseData.currentTray, 1)

      const lastConfirmSnap = await db.collection('tray_confirmations')
        .where('case_id', '==', caseDocument.id)
        .where('tray_number', '==', currentTray)
        .limit(1)
        .get()

      if (!lastConfirmSnap.empty) {
        const confirmedAt = lastConfirmSnap.docs[0].data().confirmed_at
        if (confirmedAt instanceof Timestamp && confirmedAt.toMillis() >= todayStart.toMillis()) continue
      }

      const patientSnap = await db.collection('patients').doc(patientId).get()
      if (!patientSnap.exists) continue

      const patient = patientSnap.data()
      const portalUid = asText(patient?.portal_uid ?? patient?.portalUid)
      if (!portalUid) continue

      await sendPushToUser(portalUid, {
        title: 'Hora de trocar o alinhador',
        body: `Confirme a troca para a bandeja ${currentTray} no seu portal`,
        data: {
          type: 'tray_change_reminder',
          case_id: caseDocument.id,
          tray_number: String(currentTray),
        },
      })
    }

    return null
  })
