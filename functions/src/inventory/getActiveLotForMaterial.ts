import * as functions from 'firebase-functions/v1'
import { db } from '../shared/admin'

type RequestBody = {
  materialId: string
}

const allowedRoles = ['master_admin', 'dentist_admin', 'lab_tech', 'receptionist']

export const getActiveLotForMaterial = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (data: RequestBody, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const role = typeof context.auth.token.role === 'string' ? context.auth.token.role : ''
    if (!allowedRoles.includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Perfil nao autorizado.')
    }

    const materialId = data.materialId?.trim()
    if (!materialId) {
      throw new functions.https.HttpsError('invalid-argument', 'materialId e obrigatorio.')
    }

    const lotSnap = await db.collection('purchase_lots')
      .where('material_id', '==', materialId)
      .where('remaining_quantity', '>', 0)
      .orderBy('remaining_quantity', 'desc')
      .orderBy('purchase_date', 'asc')
      .limit(1)
      .get()

    if (lotSnap.empty) {
      const materialSnap = await db.collection('inventory_materials').doc(materialId).get()
      return {
        lotId: null,
        unitCost: materialSnap.data()?.base_cost_per_unit ?? 0,
        source: 'base_price',
      }
    }

    const lotDoc = lotSnap.docs[0]
    const lot = lotDoc.data()
    return {
      lotId: lotDoc.id,
      unitCost: lot.cost_per_unit ?? 0,
      remainingQuantity: lot.remaining_quantity ?? 0,
      source: 'purchase_lot',
    }
  })
