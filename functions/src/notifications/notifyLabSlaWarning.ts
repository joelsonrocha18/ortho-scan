import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import { sendPushToUser } from './sendPushToUser'

const activeLabStages = ['queued', 'in_production', 'qc']
const recipientRoles = ['lab_tech', 'dentist_admin', 'master_admin']

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export const notifyLabSlaWarning = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .pubsub.schedule('0 8 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const now = Timestamp.now()
    const in24h = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000)

    const snap = await db.collection('lab_items')
      .where('sla_due_at', '>=', now)
      .where('sla_due_at', '<=', in24h)
      .where('stage', 'in', activeLabStages)
      .get()

    if (snap.empty) return null

    const byClinic = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
    for (const document of snap.docs) {
      const clinicId = asText(document.data().clinic_id ?? document.data().clinicId)
      if (!clinicId) continue
      const current = byClinic.get(clinicId) ?? []
      current.push(document)
      byClinic.set(clinicId, current)
    }

    for (const [clinicId, items] of byClinic.entries()) {
      const profilesSnap = await db.collection('profiles')
        .where('clinicId', '==', clinicId)
        .where('role', 'in', recipientRoles)
        .get()

      for (const profile of profilesSnap.docs) {
        const profileData = profile.data()
        if (profileData.active === false || profileData.isActive === false) continue
        await sendPushToUser(profile.id, {
          title: 'SLA do Lab vencendo',
          body: `${items.length} item(ns) com prazo nas proximas 24h`,
          data: {
            type: 'lab_sla_warning',
            clinic_id: clinicId,
            count: String(items.length),
          },
        })
      }
    }

    return null
  })
