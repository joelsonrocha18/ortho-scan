import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'

type DentistPortalInput = {
  accessToken: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const getDentistPortalData = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: DentistPortalInput) => {
    const accessToken = asString(data.accessToken)

    if (!accessToken) {
      throw new functions.https.HttpsError('invalid-argument', 'Token obrigatorio.')
    }

    const dentistQuery = await db.collection('dentists')
      .where('portal_access_token', '==', accessToken)
      .where('portal_token_expires_at', '>', Timestamp.now())
      .limit(1)
      .get()

    if (dentistQuery.empty) {
      throw new functions.https.HttpsError('unauthenticated', 'Token invalido ou expirado.')
    }

    const dentistDoc = dentistQuery.docs[0]
    const dentist = dentistDoc.data()

    const casesSnap = await db.collection('cases')
      .where('dentist_id', '==', dentistDoc.id)
      .where('status', 'not-in', ['finalizado'])
      .orderBy('updated_at', 'desc')
      .limit(50)
      .get()

    const cases = casesSnap.docs.map((caseDoc) => {
      const caseData = caseDoc.data()
      return {
        id: caseDoc.id,
        patient_name: caseData.patient_name ?? caseData.patientName ?? '',
        status: caseData.status ?? '',
        lab_stage: caseData.lab_stage ?? null,
        updated_at: caseData.updated_at ?? null,
      }
    })

    return {
      dentistId: dentistDoc.id,
      dentistName: dentist.name ?? '',
      cases,
    }
  })
