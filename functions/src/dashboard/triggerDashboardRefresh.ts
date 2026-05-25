import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import { buildSnapshot } from './buildSnapshot'

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export const triggerDashboardRefresh = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data: { clinicId?: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const callerRole = asText(context.auth.token.role)
    if (!['master_admin', 'dentist_admin'].includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Apenas admins.')
    }

    const clinicId = callerRole === 'master_admin'
      ? data.clinicId?.trim()
      : asText(context.auth.token.clinicId)

    if (!clinicId) {
      throw new functions.https.HttpsError('invalid-argument', 'clinicId obrigatorio.')
    }

    const now = Timestamp.now()
    const thirtyDaysAgo = Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000)
    const snapshot = await buildSnapshot(clinicId, now, thirtyDaysAgo)
    await db.collection('dashboard_snapshots').doc(clinicId).set(snapshot)

    return { success: true, generatedAt: now.toDate().toISOString() }
  })
