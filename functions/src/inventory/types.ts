import type { Timestamp } from 'firebase-admin/firestore'

export type TransactionType = 'consumption' | 'purchase' | 'adjustment' | 'rework_return'

export type InventoryTransaction = {
  id?: string
  material_id: string
  clinic_id: string
  case_id?: string
  lab_item_id?: string
  tray_number?: number
  lot_id?: string
  transaction_type: TransactionType
  quantity: number
  unit_cost: number
  total_cost: number
  note?: string
  created_by_uid: string
  created_at: Timestamp
}

export type TrayCostMaterialSnapshot = {
  material_id: string
  material_name: string
  quantity: number
  unit_cost: number
  total_cost: number
}

export type TrayCostSnapshot = {
  tray_number: number
  lab_item_id: string
  materials: TrayCostMaterialSnapshot[]
  tray_total_cost: number
  calculated_at: Timestamp
}
