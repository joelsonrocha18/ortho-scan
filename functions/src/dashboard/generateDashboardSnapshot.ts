import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import { buildSnapshot } from './buildSnapshot'

export const generateDashboardSnapshot = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .pubsub.schedule('0 6 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const clinicsSnap = await db.collection('clinics').get()
    const now = Timestamp.now()
    const thirtyDaysAgo = Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000)

    for (const clinicDocument of clinicsSnap.docs) {
      const clinicData = clinicDocument.data()
      if (clinicData.active === false || clinicData.isActive === false || clinicData.deleted_at || clinicData.deletedAt) continue

      try {
        const snapshot = await buildSnapshot(clinicDocument.id, now, thirtyDaysAgo)
        await db.collection('dashboard_snapshots').doc(clinicDocument.id).set(snapshot)
        functions.logger.info('Dashboard gerado.', { clinicId: clinicDocument.id })
      } catch (error) {
        functions.logger.error('Erro ao gerar dashboard.', { clinicId: clinicDocument.id, error })
      }
    }

    return null
  })
