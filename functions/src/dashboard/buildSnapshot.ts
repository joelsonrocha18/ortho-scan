import type { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'
import type { DashboardSnapshot } from './types'

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export async function buildSnapshot(clinicId: string, now: Timestamp, thirtyDaysAgo: Timestamp): Promise<DashboardSnapshot> {
  const casesSnap = await db.collection('cases')
    .where('clinic_id', '==', clinicId)
    .where('total_production_cost', '>', 0)
    .get()

  const totalProductionCost = casesSnap.docs.reduce((sum, document) => sum + asNumber(document.data().total_production_cost), 0)
  const avgCostPerCase = casesSnap.size > 0 ? totalProductionCost / casesSnap.size : 0
  const totalTrays = casesSnap.docs.reduce((sum, document) => sum + asNumber(document.data().total_trays ?? document.data().totalTrays), 0)
  const avgCostPerTray = totalTrays > 0 ? totalProductionCost / totalTrays : 0

  const txSnap = await db.collection('inventory_transactions')
    .where('clinic_id', '==', clinicId)
    .where('transaction_type', '==', 'consumption')
    .where('created_at', '>=', thirtyDaysAgo)
    .get()

  const materialCosts = new Map<string, { name: string; total: number }>()
  for (const document of txSnap.docs) {
    const tx = document.data()
    const materialId = asText(tx.material_id)
    if (!materialId) continue
    const current = materialCosts.get(materialId) ?? { name: materialId, total: 0 }
    current.total += asNumber(tx.total_cost)
    materialCosts.set(materialId, current)
  }

  const topMaterialCosts = Array.from(materialCosts.entries())
    .sort((left, right) => right[1].total - left[1].total)
    .slice(0, 3)
    .map(([materialId, material]) => ({
      material_id: materialId,
      material_name: material.name,
      total_cost: material.total,
    }))

  const labSnap = await db.collection('lab_items')
    .where('clinic_id', '==', clinicId)
    .where('stage', 'in', ['queued', 'in_production', 'qc'])
    .get()

  const itemsByStage: Record<string, number> = {}
  let slaOnTrack = 0
  let slaWarning = 0
  let slaOverdue = 0
  const nowMs = now.toMillis()

  for (const document of labSnap.docs) {
    const item = document.data()
    const stage = asText(item.stage) || 'unknown'
    itemsByStage[stage] = (itemsByStage[stage] ?? 0) + 1

    const dueAt = item.sla_due_at
    if (dueAt && typeof dueAt.toMillis === 'function') {
      const diffHours = (dueAt.toMillis() - nowMs) / (1000 * 60 * 60)
      if (diffHours < 0) slaOverdue += 1
      else if (diffHours < 24) slaWarning += 1
      else slaOnTrack += 1
    }
  }

  const reworkSnap = await db.collection('lab_items')
    .where('clinic_id', '==', clinicId)
    .where('stage', '==', 'rework')
    .where('created_at', '>=', thirtyDaysAgo)
    .get()

  const totalLabItems30d = labSnap.size + reworkSnap.size
  const reworkRate = totalLabItems30d > 0 ? (reworkSnap.size / totalLabItems30d) * 100 : 0

  const patientsSnap = await db.collection('patients')
    .where('clinic_id', '==', clinicId)
    .get()

  const patientsWithPortal = patientsSnap.docs.filter((document) => Boolean(document.data().portal_uid)).length

  const confirmationsSnap = await db.collection('tray_confirmations')
    .where('clinic_id', '==', clinicId)
    .where('confirmed_at', '>=', thirtyDaysAgo)
    .get()

  const confirmationsWithSelfie = confirmationsSnap.docs.filter((document) => Boolean(document.data().selfie_url)).length
  const selfieRate = confirmationsSnap.size > 0 ? (confirmationsWithSelfie / confirmationsSnap.size) * 100 : 0

  const activeCasesSnap = await db.collection('cases')
    .where('clinic_id', '==', clinicId)
    .where('status', 'in', ['in_use', 'em_tratamento'])
    .get()

  const completedCasesSnap = await db.collection('cases')
    .where('clinic_id', '==', clinicId)
    .where('status', '==', 'finalizado')
    .where('updated_at', '>=', thirtyDaysAgo)
    .get()

  return {
    clinic_id: clinicId,
    generated_at: now,
    period: 'last_30_days',
    financial: {
      total_production_cost: totalProductionCost,
      avg_cost_per_case: avgCostPerCase,
      avg_cost_per_tray: avgCostPerTray,
      cases_with_cost_data: casesSnap.size,
      top_material_costs: topMaterialCosts,
    },
    operational: {
      total_active_lab_items: labSnap.size,
      items_by_stage: itemsByStage,
      sla_on_track: slaOnTrack,
      sla_warning: slaWarning,
      sla_overdue: slaOverdue,
      avg_production_days: 0,
      rework_count: reworkSnap.size,
      rework_rate_percent: reworkRate,
    },
    clinical: {
      total_active_patients: patientsSnap.size,
      patients_with_portal: patientsWithPortal,
      portal_adoption_percent: patientsSnap.size > 0 ? (patientsWithPortal / patientsSnap.size) * 100 : 0,
      total_tray_confirmations_30d: confirmationsSnap.size,
      confirmations_with_selfie: confirmationsWithSelfie,
      selfie_rate_percent: selfieRate,
      avg_tray_change_delay_days: 0,
      cases_in_treatment: activeCasesSnap.size,
      cases_completed_30d: completedCasesSnap.size,
    },
  }
}
