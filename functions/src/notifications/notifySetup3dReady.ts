import * as functions from 'firebase-functions/v1'
import { db } from '../shared/admin'
import { sendPushToUser } from './sendPushToUser'

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export const notifySetup3dReady = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('cases/{caseId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after = change.after.data()

    if (before.setup_3d_ready === after.setup_3d_ready) return null
    if (after.setup_3d_ready !== true) return null

    const dentistId = asText(after.dentist_id ?? after.dentistId)
    if (!dentistId) return null

    const profileSnap = await db.collection('profiles')
      .where('dentistId', '==', dentistId)
      .where('role', '==', 'dentist_client')
      .limit(1)
      .get()

    if (profileSnap.empty) return null

    const dentistUid = profileSnap.docs[0].id
    const patientName = asText(after.patient_name ?? after.patientName) || 'Paciente'

    await sendPushToUser(dentistUid, {
      title: 'Setup 3D pronto para aprovacao',
      body: `O planejamento de ${patientName} esta disponivel para revisao`,
      data: {
        type: 'setup_3d_ready',
        case_id: change.after.id,
        patient_name: patientName,
      },
    })

    return null
  })
