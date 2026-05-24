import { collection, doc, getDoc, getDocs, runTransaction, setDoc } from 'firebase/firestore'
import { DATA_MODE } from '../data/dataMode'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { InventoryMaterial, InventoryTransaction, InventoryTransactionType, InventoryUnit } from '../types/Commercial'
import {
  asInventoryUnit,
  asNumber,
  asText,
  getFirestoreDb,
  normalizeQuantityForUnit,
  normalizeText,
  readLocalCollection,
  writeLocalCollection,
} from './commercialRepoUtils'

const MATERIALS_COLLECTION = 'inventory_materials'
const TRANSACTIONS_COLLECTION = 'inventory_transactions'
const LOCAL_MATERIALS_KEY = 'orthoscan.inventoryMaterials'
const LOCAL_TRANSACTIONS_KEY = 'orthoscan.inventoryTransactions'

type InventoryMaterialDocument = Record<string, unknown>
type InventoryTransactionDocument = Record<string, unknown>
type InventoryMaterialPayload = {
  id?: string
  name: string
  currentStock: number
  unit: InventoryUnit
  unitCost: number
  minStock: number
}
type InventoryMovementInput = {
  materialId: string
  quantity: number
  type: InventoryTransactionType
  contractId?: string
  notes: string
  date?: string
}
type InventoryMutationResult = { ok: true; material: InventoryMaterial } | { ok: false; error: string }
type InventoryMovementResult = { ok: true; transactions: InventoryTransaction[] } | { ok: false; error: string }

const STOCK_INCREASE_TYPES: InventoryTransactionType[] = ['input', 'return']

function transactionTypeFromValue(value: unknown): InventoryTransactionType {
  if (
    value === 'input' ||
    value === 'consumption' ||
    value === 'return' ||
    value === 'waste' ||
    value === 'internal_use' ||
    value === 'adjustment'
  ) {
    return value
  }
  return 'adjustment'
}

function stockDeltaFor(type: InventoryTransactionType, quantity: number) {
  return STOCK_INCREASE_TYPES.includes(type) ? quantity : -quantity
}

function mapInventoryMaterialDocument(id: string, data: InventoryMaterialDocument): InventoryMaterial {
  const now = nowIsoDateTime()
  return {
    id: asText(data.id) ?? id,
    name: asText(data.name) ?? 'Insumo sem nome',
    currentStock: asNumber(data.currentStock ?? data.current_stock),
    unit: asInventoryUnit(data.unit),
    unitCost: asNumber(data.unitCost ?? data.unit_cost),
    minStock: asNumber(data.minStock ?? data.min_stock),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    archivedAt: asText(data.archivedAt) ?? asText(data.archived_at),
  }
}

function mapInventoryTransactionDocument(id: string, data: InventoryTransactionDocument): InventoryTransaction {
  const now = nowIsoDateTime()
  return {
    id: asText(data.id) ?? id,
    materialId: asText(data.materialId) ?? asText(data.material_id) ?? '',
    quantity: asNumber(data.quantity),
    date: asText(data.date) ?? now,
    type: transactionTypeFromValue(data.type),
    contractId: asText(data.contractId) ?? asText(data.contract_id),
    notes: asText(data.notes) ?? '',
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
  }
}

function materialToFirestoreDocument(material: InventoryMaterial): InventoryMaterialDocument {
  return {
    id: material.id,
    name: material.name,
    currentStock: material.currentStock,
    unit: material.unit,
    unitCost: material.unitCost,
    minStock: material.minStock,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
    archivedAt: material.archivedAt ?? null,
  }
}

function transactionToFirestoreDocument(transaction: InventoryTransaction): InventoryTransactionDocument {
  return {
    id: transaction.id,
    materialId: transaction.materialId,
    quantity: transaction.quantity,
    date: transaction.date,
    type: transaction.type,
    contractId: transaction.contractId ?? null,
    notes: transaction.notes,
    createdAt: transaction.createdAt,
  }
}

function validateMaterialPayload(payload: InventoryMaterialPayload) {
  if (!normalizeText(payload.name)) return 'Nome do insumo é obrigatório.'
  if (!Number.isFinite(payload.currentStock) || payload.currentStock < 0) return 'Saldo atual inválido.'
  if (!Number.isFinite(payload.unitCost) || payload.unitCost < 0) return 'Custo unitário inválido.'
  if (!Number.isFinite(payload.minStock) || payload.minStock < 0) return 'Estoque mínimo inválido.'
  return null
}

function validateMovements(movements: InventoryMovementInput[]) {
  if (movements.length === 0) return 'Nenhuma movimentação informada.'
  for (const movement of movements) {
    if (!movement.materialId) return 'Selecione o insumo da movimentação.'
    if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) return 'Quantidade da movimentação deve ser maior que zero.'
    if (!normalizeText(movement.notes)) return 'Justificativa da movimentação é obrigatória.'
  }
  return null
}

async function readInventoryMaterialFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), MATERIALS_COLLECTION, id))
  if (!snapshot.exists()) return null
  return mapInventoryMaterialDocument(snapshot.id, snapshot.data())
}

export function listInventoryMaterials(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived ?? false
  return readLocalCollection<InventoryMaterial>(LOCAL_MATERIALS_KEY)
    .filter((item) => (includeArchived ? true : !item.archivedAt))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listInventoryMaterialsFirebase(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived ?? false
  const snapshot = await getDocs(collection(getFirestoreDb(), MATERIALS_COLLECTION))
  return snapshot.docs
    .map((item) => mapInventoryMaterialDocument(item.id, item.data()))
    .filter((item) => (includeArchived ? true : !item.archivedAt))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listInventoryMaterialsAsync(options?: { includeArchived?: boolean }) {
  if (DATA_MODE === 'firebase') return listInventoryMaterialsFirebase(options)
  return listInventoryMaterials(options)
}

export function listInventoryTransactions() {
  return readLocalCollection<InventoryTransaction>(LOCAL_TRANSACTIONS_KEY).sort((a, b) => b.date.localeCompare(a.date))
}

export async function listInventoryTransactionsFirebase() {
  const snapshot = await getDocs(collection(getFirestoreDb(), TRANSACTIONS_COLLECTION))
  return snapshot.docs
    .map((item) => mapInventoryTransactionDocument(item.id, item.data()))
    .filter((item) => item.materialId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function listInventoryTransactionsAsync() {
  if (DATA_MODE === 'firebase') return listInventoryTransactionsFirebase()
  return listInventoryTransactions()
}

export function upsertInventoryMaterial(payload: InventoryMaterialPayload): InventoryMutationResult {
  const validationError = validateMaterialPayload(payload)
  if (validationError) return { ok: false, error: validationError }

  const items = readLocalCollection<InventoryMaterial>(LOCAL_MATERIALS_KEY)
  const current = payload.id ? items.find((item) => item.id === payload.id) : undefined
  const now = nowIsoDateTime()
  const next: InventoryMaterial = {
    id: current?.id ?? payload.id ?? createEntityId('material'),
    name: payload.name.trim(),
    currentStock: normalizeQuantityForUnit(payload.currentStock, payload.unit),
    unit: payload.unit,
    unitCost: Math.max(0, payload.unitCost),
    minStock: normalizeQuantityForUnit(payload.minStock, payload.unit),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    archivedAt: current?.archivedAt,
  }
  writeLocalCollection(LOCAL_MATERIALS_KEY, current ? items.map((item) => (item.id === next.id ? next : item)) : [next, ...items])
  return { ok: true, material: next }
}

export async function upsertInventoryMaterialFirebase(payload: InventoryMaterialPayload): Promise<InventoryMutationResult> {
  const validationError = validateMaterialPayload(payload)
  if (validationError) return { ok: false, error: validationError }

  const current = payload.id ? await readInventoryMaterialFromFirestore(payload.id) : null
  const now = nowIsoDateTime()
  const next: InventoryMaterial = {
    id: current?.id ?? payload.id ?? createEntityId('material'),
    name: payload.name.trim(),
    currentStock: normalizeQuantityForUnit(payload.currentStock, payload.unit),
    unit: payload.unit,
    unitCost: Math.max(0, payload.unitCost),
    minStock: normalizeQuantityForUnit(payload.minStock, payload.unit),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    archivedAt: current?.archivedAt,
  }
  await setDoc(doc(getFirestoreDb(), MATERIALS_COLLECTION, next.id), materialToFirestoreDocument(next), { merge: true })
  return { ok: true, material: next }
}

export async function upsertInventoryMaterialAsync(payload: InventoryMaterialPayload): Promise<InventoryMutationResult> {
  if (DATA_MODE === 'firebase') return upsertInventoryMaterialFirebase(payload)
  return upsertInventoryMaterial(payload)
}

export function applyInventoryMovements(movements: InventoryMovementInput[]): InventoryMovementResult {
  const validationError = validateMovements(movements)
  if (validationError) return { ok: false, error: validationError }

  const materials = readLocalCollection<InventoryMaterial>(LOCAL_MATERIALS_KEY)
  const transactions = readLocalCollection<InventoryTransaction>(LOCAL_TRANSACTIONS_KEY)
  const materialById = new Map(materials.map((item) => [item.id, item]))
  const now = nowIsoDateTime()
  const nextTransactions: InventoryTransaction[] = []

  for (const movement of movements) {
    const material = materialById.get(movement.materialId)
    if (!material) return { ok: false, error: 'Insumo da movimentação não encontrado.' }
    const quantity = normalizeQuantityForUnit(movement.quantity, material.unit)
    const nextMaterial: InventoryMaterial = {
      ...material,
      currentStock: normalizeQuantityForUnit(material.currentStock + stockDeltaFor(movement.type, quantity), material.unit),
      updatedAt: now,
    }
    materialById.set(material.id, nextMaterial)
    nextTransactions.push({
      id: createEntityId('inventory-tx'),
      materialId: material.id,
      quantity,
      date: movement.date ?? now,
      type: movement.type,
      contractId: movement.contractId,
      notes: movement.notes.trim(),
      createdAt: now,
    })
  }

  writeLocalCollection(LOCAL_MATERIALS_KEY, materials.map((item) => materialById.get(item.id) ?? item))
  writeLocalCollection(LOCAL_TRANSACTIONS_KEY, [...nextTransactions, ...transactions])
  return { ok: true, transactions: nextTransactions }
}

export async function applyInventoryMovementsFirebase(movements: InventoryMovementInput[]): Promise<InventoryMovementResult> {
  const validationError = validateMovements(movements)
  if (validationError) return { ok: false, error: validationError }

  const db = getFirestoreDb()
  const now = nowIsoDateTime()
  const createdTransactions: InventoryTransaction[] = []

  try {
    await runTransaction(db, async (transaction) => {
      const materialRefs = new Map<string, ReturnType<typeof doc>>()
      for (const movement of movements) {
        if (!materialRefs.has(movement.materialId)) {
          materialRefs.set(movement.materialId, doc(db, MATERIALS_COLLECTION, movement.materialId))
        }
      }

      const materialById = new Map<string, InventoryMaterial>()
      for (const [materialId, materialRef] of materialRefs) {
        const snapshot = await transaction.get(materialRef)
        if (!snapshot.exists()) {
          throw new Error(`Insumo não encontrado: ${materialId}`)
        }
        materialById.set(materialId, mapInventoryMaterialDocument(snapshot.id, snapshot.data()))
      }

      for (const movement of movements) {
        const material = materialById.get(movement.materialId)
        if (!material) throw new Error('Insumo da movimentação não encontrado.')
        const quantity = normalizeQuantityForUnit(movement.quantity, material.unit)
        const nextMaterial: InventoryMaterial = {
          ...material,
          currentStock: normalizeQuantityForUnit(material.currentStock + stockDeltaFor(movement.type, quantity), material.unit),
          updatedAt: now,
        }
        const nextTransaction: InventoryTransaction = {
          id: createEntityId('inventory-tx'),
          materialId: material.id,
          quantity,
          date: movement.date ?? now,
          type: movement.type,
          contractId: movement.contractId,
          notes: movement.notes.trim(),
          createdAt: now,
        }

        materialById.set(material.id, nextMaterial)
        createdTransactions.push(nextTransaction)
        transaction.set(doc(db, MATERIALS_COLLECTION, material.id), materialToFirestoreDocument(nextMaterial), { merge: true })
        transaction.set(doc(db, TRANSACTIONS_COLLECTION, nextTransaction.id), transactionToFirestoreDocument(nextTransaction))
      }
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Falha ao aplicar movimentação de estoque.' }
  }

  return { ok: true, transactions: createdTransactions }
}

export async function applyInventoryMovementsAsync(movements: InventoryMovementInput[]): Promise<InventoryMovementResult> {
  if (DATA_MODE === 'firebase') return applyInventoryMovementsFirebase(movements)
  return applyInventoryMovements(movements)
}

export async function registerInventoryInputAsync(input: { materialId: string; quantity: number; notes: string }) {
  return applyInventoryMovementsAsync([{ ...input, type: 'input' }])
}

export async function registerInventoryManualOutputAsync(input: { materialId: string; quantity: number; type: 'waste' | 'internal_use' | 'adjustment'; notes: string }) {
  return applyInventoryMovementsAsync([input])
}
