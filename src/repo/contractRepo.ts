import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { DATA_MODE } from '../data/dataMode'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type {
  Contract,
  ContractItem,
  ContractPaymentStatus,
  ContractPaymentTerm,
  ContractStatus,
  InventoryMaterial,
  MaterialConsumptionSummary,
  ProductPolicy,
} from '../types/Commercial'
import {
  asNumber,
  asRecordArray,
  asText,
  getFirestoreDb,
  normalizeQuantityForUnit,
  readLocalCollection,
  writeLocalCollection,
} from './commercialRepoUtils'
import { applyInventoryMovementsAsync, listInventoryMaterialsAsync } from './inventoryRepo'
import { listProductPoliciesAsync } from './productPolicyRepo'

const COLLECTION_NAME = 'contracts'
const LOCAL_KEY = 'orthoscan.contracts'

type ContractDocument = Record<string, unknown>
type ContractPayload = {
  id?: string
  patientId: string
  dentistId: string
  clinicId: string
  totalValue: number
  status?: ContractStatus
  paymentTerms: ContractPaymentTerm[]
  items: ContractItem[]
  version?: number
  parentContractId?: string
}
type ContractMutationResult = { ok: true; contract: Contract } | { ok: false; error: string }
type ContractApprovalResult = { ok: true; contract: Contract; movementsApplied: number } | { ok: false; error: string }
type ContractRenegotiationResult = { ok: true; source: Contract; draft: Contract } | { ok: false; error: string }

function contractStatusFromValue(value: unknown): ContractStatus {
  if (value === 'approved' || value === 'renegotiating' || value === 'archived' || value === 'draft') return value
  return 'draft'
}

function paymentStatusFromValue(value: unknown): ContractPaymentStatus {
  if (value === 'pending' || value === 'paid' || value === 'overdue' || value === 'planned') return value
  return 'planned'
}

function mapItems(value: unknown): ContractItem[] {
  return asRecordArray(value)
    .map((item) => ({
      productId: asText(item.productId) ?? asText(item.product_id) ?? '',
      quantity: Math.max(0, asNumber(item.quantity)),
    }))
    .filter((item) => item.productId && item.quantity > 0)
}

function mapPaymentTerms(value: unknown): ContractPaymentTerm[] {
  return asRecordArray(value)
    .map((item) => ({
      id: asText(item.id) ?? createEntityId('term'),
      dueDate: asText(item.dueDate) ?? asText(item.due_date) ?? '',
      amount: Math.max(0, asNumber(item.amount)),
      status: paymentStatusFromValue(item.status),
      notes: asText(item.notes),
    }))
    .filter((item) => item.dueDate && item.amount > 0)
}

function mapContractDocument(id: string, data: ContractDocument): Contract {
  const now = nowIsoDateTime()
  return {
    id: asText(data.id) ?? id,
    patientId: asText(data.patientId) ?? asText(data.patient_id) ?? '',
    dentistId: asText(data.dentistId) ?? asText(data.dentist_id) ?? '',
    clinicId: asText(data.clinicId) ?? asText(data.clinic_id) ?? '',
    totalValue: asNumber(data.totalValue ?? data.total_value),
    status: contractStatusFromValue(data.status),
    paymentTerms: mapPaymentTerms(data.paymentTerms ?? data.payment_terms),
    items: mapItems(data.items),
    version: Math.max(1, Math.round(asNumber(data.version, 1))),
    parentContractId: asText(data.parentContractId) ?? asText(data.parent_contract_id),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    approvedAt: asText(data.approvedAt) ?? asText(data.approved_at),
    archivedAt: asText(data.archivedAt) ?? asText(data.archived_at),
    inventoryAppliedAt: asText(data.inventoryAppliedAt) ?? asText(data.inventory_applied_at),
  }
}

function contractToFirestoreDocument(contract: Contract): ContractDocument {
  return {
    id: contract.id,
    patientId: contract.patientId,
    dentistId: contract.dentistId,
    clinicId: contract.clinicId,
    totalValue: contract.totalValue,
    status: contract.status,
    paymentTerms: contract.paymentTerms,
    items: contract.items,
    version: contract.version,
    parentContractId: contract.parentContractId ?? null,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    approvedAt: contract.approvedAt ?? null,
    archivedAt: contract.archivedAt ?? null,
    inventoryAppliedAt: contract.inventoryAppliedAt ?? null,
  }
}

function validateContractPayload(payload: ContractPayload) {
  if (!payload.patientId) return 'Paciente é obrigatório.'
  if (!payload.dentistId) return 'Dentista é obrigatório.'
  if (!payload.clinicId) return 'Clínica é obrigatória.'
  if (!Number.isFinite(payload.totalValue) || payload.totalValue < 0) return 'Valor total inválido.'
  if (payload.items.length === 0) return 'Inclua ao menos um produto ou serviço no contrato.'
  for (const item of payload.items) {
    if (!item.productId) return 'Selecione todos os produtos do contrato.'
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return 'Quantidade do contrato deve ser maior que zero.'
  }
  return null
}

async function readContractFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), COLLECTION_NAME, id))
  if (!snapshot.exists()) return null
  return mapContractDocument(snapshot.id, snapshot.data())
}

function consumptionKey(materialId: string) {
  return materialId
}

export function computeContractConsumptionSummary(
  items: ContractItem[],
  products: ProductPolicy[],
  materials: InventoryMaterial[],
): MaterialConsumptionSummary[] {
  const productById = new Map(products.map((item) => [item.id, item]))
  const materialById = new Map(materials.map((item) => [item.id, item]))
  const totals = new Map<string, MaterialConsumptionSummary>()

  for (const contractItem of items) {
    const product = productById.get(contractItem.productId)
    if (!product) continue
    for (const recipeItem of product.recipe) {
      const material = materialById.get(recipeItem.materialId)
      const unit = material?.unit ?? recipeItem.unit
      const quantity = normalizeQuantityForUnit(recipeItem.quantityRequired * contractItem.quantity, unit)
      const key = consumptionKey(recipeItem.materialId)
      const current = totals.get(key)
      const nextQuantity = normalizeQuantityForUnit((current?.quantity ?? 0) + quantity, unit)
      totals.set(key, {
        materialId: recipeItem.materialId,
        materialName: material?.name ?? 'Insumo não cadastrado',
        quantity: nextQuantity,
        unit,
        estimatedCost: nextQuantity * (material?.unitCost ?? 0),
      })
    }
  }

  return Array.from(totals.values()).sort((a, b) => a.materialName.localeCompare(b.materialName))
}

function diffConsumption(
  next: MaterialConsumptionSummary[],
  previous: MaterialConsumptionSummary[],
) {
  const normalizeSignedQuantity = (quantity: number, unit: MaterialConsumptionSummary['unit']) => {
    if (!Number.isFinite(quantity)) return 0
    if (unit === 'un') return Math.round(quantity)
    return Math.round(quantity * 10000) / 10000
  }
  const previousById = new Map(previous.map((item) => [item.materialId, item]))
  const nextById = new Map(next.map((item) => [item.materialId, item]))
  const materialIds = new Set([...previousById.keys(), ...nextById.keys()])
  return Array.from(materialIds)
    .map((materialId) => {
      const nextItem = nextById.get(materialId)
      const previousItem = previousById.get(materialId)
      const unit = nextItem?.unit ?? previousItem?.unit ?? 'un'
      return {
        materialId,
        quantity: normalizeSignedQuantity((nextItem?.quantity ?? 0) - (previousItem?.quantity ?? 0), unit),
        unit,
      }
    })
    .filter((item) => item.quantity !== 0)
}

function rootContractId(contract: Contract) {
  return contract.parentContractId ?? contract.id
}

function findPreviousContract(target: Contract, contracts: Contract[]) {
  const rootId = rootContractId(target)
  return contracts
    .filter((item) => item.id !== target.id)
    .filter((item) => item.id === rootId || item.parentContractId === rootId)
    .filter((item) => item.version < target.version)
    .sort((a, b) => b.version - a.version)[0] ?? null
}

async function saveContract(contract: Contract) {
  if (DATA_MODE === 'firebase') {
    await setDoc(doc(getFirestoreDb(), COLLECTION_NAME, contract.id), contractToFirestoreDocument(contract), { merge: true })
    return
  }
  const contracts = readLocalCollection<Contract>(LOCAL_KEY)
  const current = contracts.find((item) => item.id === contract.id)
  writeLocalCollection(LOCAL_KEY, current ? contracts.map((item) => (item.id === contract.id ? contract : item)) : [contract, ...contracts])
}

export function listContracts() {
  return readLocalCollection<Contract>(LOCAL_KEY).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listContractsFirebase() {
  const snapshot = await getDocs(collection(getFirestoreDb(), COLLECTION_NAME))
  return snapshot.docs
    .map((item) => mapContractDocument(item.id, item.data()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listContractsAsync() {
  if (DATA_MODE === 'firebase') return listContractsFirebase()
  return listContracts()
}

export async function getContractAsync(id: string) {
  if (DATA_MODE === 'firebase') return readContractFromFirestore(id)
  return readLocalCollection<Contract>(LOCAL_KEY).find((item) => item.id === id) ?? null
}

export function createContract(payload: ContractPayload): ContractMutationResult {
  const validationError = validateContractPayload(payload)
  if (validationError) return { ok: false, error: validationError }
  const now = nowIsoDateTime()
  const next: Contract = {
    id: payload.id ?? createEntityId('contract'),
    patientId: payload.patientId,
    dentistId: payload.dentistId,
    clinicId: payload.clinicId,
    totalValue: Math.max(0, payload.totalValue),
    status: payload.status ?? 'draft',
    paymentTerms: payload.paymentTerms,
    items: payload.items,
    version: payload.version ?? 1,
    parentContractId: payload.parentContractId,
    createdAt: now,
    updatedAt: now,
  }
  writeLocalCollection(LOCAL_KEY, [next, ...readLocalCollection<Contract>(LOCAL_KEY)])
  return { ok: true, contract: next }
}

export async function createContractFirebase(payload: ContractPayload): Promise<ContractMutationResult> {
  const validationError = validateContractPayload(payload)
  if (validationError) return { ok: false, error: validationError }
  const now = nowIsoDateTime()
  const next: Contract = {
    id: payload.id ?? createEntityId('contract'),
    patientId: payload.patientId,
    dentistId: payload.dentistId,
    clinicId: payload.clinicId,
    totalValue: Math.max(0, payload.totalValue),
    status: payload.status ?? 'draft',
    paymentTerms: payload.paymentTerms,
    items: payload.items,
    version: payload.version ?? 1,
    parentContractId: payload.parentContractId,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(getFirestoreDb(), COLLECTION_NAME, next.id), contractToFirestoreDocument(next))
  return { ok: true, contract: next }
}

export async function createContractAsync(payload: ContractPayload): Promise<ContractMutationResult> {
  if (DATA_MODE === 'firebase') return createContractFirebase(payload)
  return createContract(payload)
}

export async function updateContractAsync(id: string, patch: Partial<Contract>): Promise<ContractMutationResult> {
  const current = await getContractAsync(id)
  if (!current) return { ok: false, error: 'Contrato não encontrado.' }
  if (patch.status === 'approved' && current.status !== 'approved') {
    const draftPatch = { ...patch }
    delete draftPatch.status
    if (Object.keys(draftPatch).length > 0) {
      await saveContract({ ...current, ...draftPatch, updatedAt: nowIsoDateTime() })
    }
    const approval = await approveContractAsync(id)
    return approval.ok ? { ok: true, contract: approval.contract } : approval
  }
  const next = { ...current, ...patch, updatedAt: nowIsoDateTime() }
  await saveContract(next)
  return { ok: true, contract: next }
}

export async function approveContractAsync(id: string): Promise<ContractApprovalResult> {
  const current = await getContractAsync(id)
  if (!current) return { ok: false, error: 'Contrato não encontrado.' }
  if (current.status === 'approved') return { ok: true, contract: current, movementsApplied: 0 }
  if (current.status === 'archived') return { ok: false, error: 'Contrato arquivado não pode ser aprovado.' }
  if (current.status === 'renegotiating') return { ok: false, error: 'Aprove a nova versão em rascunho gerada pela renegociação.' }

  const [allContracts, products, materials] = await Promise.all([
    listContractsAsync(),
    listProductPoliciesAsync({ includeArchived: true }),
    listInventoryMaterialsAsync({ includeArchived: true }),
  ])
  const previous = findPreviousContract(current, allContracts)
  const nextConsumption = computeContractConsumptionSummary(current.items, products, materials)
  const previousConsumption = previous ? computeContractConsumptionSummary(previous.items, products, materials) : []
  const deltas = diffConsumption(nextConsumption, previousConsumption)
  const now = nowIsoDateTime()

  let movementsApplied = 0
  if (deltas.length > 0) {
    const movementResult = await applyInventoryMovementsAsync(
      deltas.map((delta) => ({
        materialId: delta.materialId,
        quantity: Math.abs(delta.quantity),
        type: delta.quantity > 0 ? 'consumption' : 'return',
        contractId: current.id,
        notes: previous
          ? `Ajuste automático da versão ${current.version} do contrato.`
          : `Baixa automática do contrato ${current.id}.`,
        date: now,
      })),
    )
    if (!movementResult.ok) return movementResult
    movementsApplied = movementResult.transactions.length
  }

  if (previous) {
    await saveContract({ ...previous, status: 'archived', archivedAt: now, updatedAt: now })
  }

  const next: Contract = {
    ...current,
    status: 'approved',
    approvedAt: now,
    inventoryAppliedAt: now,
    updatedAt: now,
  }
  await saveContract(next)
  return { ok: true, contract: next, movementsApplied }
}

export async function startContractRenegotiationAsync(id: string, patch?: Partial<Pick<Contract, 'items' | 'paymentTerms' | 'totalValue'>>): Promise<ContractRenegotiationResult> {
  const current = await getContractAsync(id)
  if (!current) return { ok: false, error: 'Contrato não encontrado.' }
  if (current.status !== 'approved') return { ok: false, error: 'Somente contratos aprovados podem ser renegociados.' }

  const now = nowIsoDateTime()
  const source: Contract = { ...current, status: 'renegotiating', updatedAt: now }
  const draft: Contract = {
    ...current,
    ...patch,
    id: createEntityId('contract'),
    status: 'draft',
    version: current.version + 1,
    parentContractId: rootContractId(current),
    createdAt: now,
    updatedAt: now,
    approvedAt: undefined,
    archivedAt: undefined,
    inventoryAppliedAt: undefined,
  }

  await saveContract(source)
  await saveContract(draft)
  return { ok: true, source, draft }
}
