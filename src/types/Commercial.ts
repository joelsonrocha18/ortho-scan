export const INVENTORY_UNITS = ['un', 'ml', 'g', 'kg', 'l', 'm', 'cm', 'cx', 'pct'] as const

export type InventoryUnit = (typeof INVENTORY_UNITS)[number]

export type ProductRecipeItem = {
  materialId: string
  quantityRequired: number
  unit: InventoryUnit
}

export type ProductPolicy = {
  id: string
  serviceName: string
  category: string
  salePrice: number
  recipe: ProductRecipeItem[]
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export type InventoryMaterial = {
  id: string
  name: string
  currentStock: number
  unit: InventoryUnit
  unitCost: number
  minStock: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export const INVENTORY_TRANSACTION_TYPES = [
  'input',
  'consumption',
  'return',
  'waste',
  'internal_use',
  'adjustment',
] as const

export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number]

export type InventoryTransaction = {
  id: string
  materialId: string
  quantity: number
  date: string
  type: InventoryTransactionType
  contractId?: string
  notes: string
  createdAt: string
}

export type ContractStatus = 'draft' | 'approved' | 'renegotiating' | 'archived'

export type ContractItem = {
  productId: string
  quantity: number
}

export type ContractPaymentStatus = 'planned' | 'pending' | 'paid' | 'overdue'

export type ContractPaymentTerm = {
  id: string
  dueDate: string
  amount: number
  status: ContractPaymentStatus
  notes?: string
}

export type Contract = {
  id: string
  patientId: string
  dentistId: string
  clinicId: string
  totalValue: number
  status: ContractStatus
  paymentTerms: ContractPaymentTerm[]
  items: ContractItem[]
  version: number
  parentContractId?: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
  archivedAt?: string
  inventoryAppliedAt?: string
}

export type MaterialConsumptionSummary = {
  materialId: string
  materialName: string
  quantity: number
  unit: InventoryUnit
  estimatedCost: number
}
