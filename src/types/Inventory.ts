import type { Timestamp } from 'firebase/firestore'

export type MaterialUnit = 'g' | 'ml' | 'un' | 'cm' | 'm2'

export type InventoryMaterial = {
  id: string
  clinic_id: string
  name: string
  unit: MaterialUnit
  base_cost_per_unit: number
  current_stock: number
  low_stock_threshold: number
  category: 'resina' | 'acetato' | 'outros'
  active: boolean
  created_at: Timestamp
  updated_at: Timestamp
}

export type PurchaseLot = {
  id: string
  material_id: string
  clinic_id: string
  quantity: number
  cost_per_unit: number
  supplier?: string
  purchase_date: Timestamp
  remaining_quantity: number
  created_by_uid: string
  created_at: Timestamp
}

export type TransactionType = 'consumption' | 'purchase' | 'adjustment' | 'rework_return'

export type InventoryTransaction = {
  id: string
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

export type TrayCostSnapshot = {
  tray_number: number
  lab_item_id: string
  materials: {
    material_id: string
    material_name: string
    quantity: number
    unit_cost: number
    total_cost: number
  }[]
  tray_total_cost: number
  calculated_at: Timestamp
}
