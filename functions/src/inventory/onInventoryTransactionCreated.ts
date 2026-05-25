import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type {
  InventoryTransaction,
  TrayCostMaterialSnapshot,
  TrayCostSnapshot,
} from './types'

export const onInventoryTransactionCreated = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .firestore.document('inventory_transactions/{transactionId}')
  .onCreate(async (snap) => {
    const tx = snap.data() as InventoryTransaction
    const batch = db.batch()

    const materialRef = db.collection('inventory_materials').doc(tx.material_id)
    batch.update(materialRef, {
      current_stock: FieldValue.increment(tx.quantity),
      updated_at: FieldValue.serverTimestamp(),
    })

    if (tx.lot_id && tx.transaction_type === 'consumption') {
      const lotRef = db.collection('purchase_lots').doc(tx.lot_id)
      batch.update(lotRef, {
        remaining_quantity: FieldValue.increment(tx.quantity),
      })
    }

    await batch.commit()

    if (tx.case_id && typeof tx.tray_number === 'number') {
      await recalculateCaseCost(tx.case_id)
    }

    return null
  })

async function getMaterialName(materialId: string, cache: Map<string, string>) {
  const cached = cache.get(materialId)
  if (cached) return cached

  const materialSnap = await db.collection('inventory_materials').doc(materialId).get()
  const name = materialSnap.data()?.name
  const resolved = typeof name === 'string' && name.trim() ? name : materialId
  cache.set(materialId, resolved)
  return resolved
}

async function recalculateCaseCost(caseId: string): Promise<void> {
  const txSnap = await db.collection('inventory_transactions')
    .where('case_id', '==', caseId)
    .where('transaction_type', '==', 'consumption')
    .get()

  const byTray = new Map<number, {
    lab_item_id: string
    materials: Map<string, TrayCostMaterialSnapshot>
  }>()
  const materialNameCache = new Map<string, string>()

  for (const document of txSnap.docs) {
    const tx = document.data() as InventoryTransaction
    if (typeof tx.tray_number !== 'number') continue

    const currentTray = byTray.get(tx.tray_number) ?? {
      lab_item_id: tx.lab_item_id ?? '',
      materials: new Map<string, TrayCostMaterialSnapshot>(),
    }
    byTray.set(tx.tray_number, currentTray)

    const absQty = Math.abs(tx.quantity)
    const existing = currentTray.materials.get(tx.material_id)

    if (existing) {
      existing.quantity += absQty
      existing.total_cost += tx.total_cost
      existing.unit_cost = existing.quantity > 0 ? existing.total_cost / existing.quantity : 0
      continue
    }

    currentTray.materials.set(tx.material_id, {
      material_id: tx.material_id,
      material_name: await getMaterialName(tx.material_id, materialNameCache),
      quantity: absQty,
      unit_cost: tx.unit_cost,
      total_cost: tx.total_cost,
    })
  }

  const trayCosts: TrayCostSnapshot[] = []
  let totalProductionCost = 0

  for (const [trayNumber, tray] of byTray.entries()) {
    const materials = Array.from(tray.materials.values())
    const trayTotal = materials.reduce((sum, material) => sum + material.total_cost, 0)
    totalProductionCost += trayTotal

    trayCosts.push({
      tray_number: trayNumber,
      lab_item_id: tray.lab_item_id,
      materials,
      tray_total_cost: trayTotal,
      calculated_at: Timestamp.now(),
    })
  }

  trayCosts.sort((left, right) => left.tray_number - right.tray_number)

  await db.collection('cases').doc(caseId).update({
    tray_costs: trayCosts,
    total_production_cost: totalProductionCost,
    cost_updated_at: FieldValue.serverTimestamp(),
  })

  functions.logger.info('Custo do caso recalculado', { caseId, totalProductionCost })
}
