import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { DATA_MODE } from '../data/dataMode'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import type { InventoryMaterial, ProductPolicy, ProductRecipeItem } from '../types/Commercial'
import {
  asInventoryUnit,
  asNumber,
  asRecordArray,
  asText,
  getFirestoreDb,
  normalizeQuantityForUnit,
  normalizeText,
  readLocalCollection,
  writeLocalCollection,
} from './commercialRepoUtils'

const COLLECTION_NAME = 'products_policy'
const LOCAL_KEY = 'orthoscan.productsPolicy'

type ProductPolicyDocument = Record<string, unknown>
type ProductPolicyPayload = {
  id?: string
  serviceName: string
  category: string
  salePrice: number
  recipe: ProductRecipeItem[]
}
type ProductPolicyMutationResult = { ok: true; product: ProductPolicy } | { ok: false; error: string }
type ProductPolicyVoidResult = { ok: true } | { ok: false; error: string }

function mapRecipe(value: unknown): ProductRecipeItem[] {
  return asRecordArray(value)
    .map((item) => {
      const materialId = asText(item.materialId) ?? asText(item.material_id) ?? ''
      const unit = asInventoryUnit(item.unit)
      return {
        materialId,
        quantityRequired: normalizeQuantityForUnit(asNumber(item.quantityRequired ?? item.quantity_required), unit),
        unit,
      }
    })
    .filter((item) => item.materialId && item.quantityRequired > 0)
}

function mapProductPolicyDocument(id: string, data: ProductPolicyDocument): ProductPolicy {
  const now = nowIsoDateTime()
  return {
    id: asText(data.id) ?? id,
    serviceName: asText(data.serviceName) ?? asText(data.service_name) ?? 'Serviço sem nome',
    category: asText(data.category) ?? 'Geral',
    salePrice: asNumber(data.salePrice ?? data.sale_price),
    recipe: mapRecipe(data.recipe),
    createdAt: asText(data.createdAt) ?? asText(data.created_at) ?? now,
    updatedAt: asText(data.updatedAt) ?? asText(data.updated_at) ?? now,
    archivedAt: asText(data.archivedAt) ?? asText(data.archived_at),
  }
}

function productPolicyToFirestoreDocument(product: ProductPolicy): ProductPolicyDocument {
  return {
    id: product.id,
    serviceName: product.serviceName,
    category: product.category,
    salePrice: product.salePrice,
    recipe: product.recipe,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    archivedAt: product.archivedAt ?? null,
  }
}

function validateProductPayload(payload: ProductPolicyPayload) {
  if (!normalizeText(payload.serviceName)) return 'Nome do serviço é obrigatório.'
  if (!normalizeText(payload.category)) return 'Categoria é obrigatória.'
  if (!Number.isFinite(payload.salePrice) || payload.salePrice < 0) return 'Preço de venda inválido.'
  for (const item of payload.recipe) {
    if (!item.materialId) return 'Selecione o insumo de todos os itens da ficha técnica.'
    if (!Number.isFinite(item.quantityRequired) || item.quantityRequired <= 0) return 'Quantidade da ficha técnica deve ser maior que zero.'
  }
  return null
}

async function readProductPolicyFromFirestore(id: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), COLLECTION_NAME, id))
  if (!snapshot.exists()) return null
  return mapProductPolicyDocument(snapshot.id, snapshot.data())
}

export function calculateProductProductionCost(product: Pick<ProductPolicy, 'recipe'>, materials: InventoryMaterial[]) {
  const materialById = new Map(materials.map((item) => [item.id, item]))
  return product.recipe.reduce((total, recipeItem) => {
    const material = materialById.get(recipeItem.materialId)
    if (!material) return total
    return total + recipeItem.quantityRequired * material.unitCost
  }, 0)
}

export function listProductPolicies(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived ?? false
  return readLocalCollection<ProductPolicy>(LOCAL_KEY)
    .filter((item) => (includeArchived ? true : !item.archivedAt))
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName))
}

export async function listProductPoliciesFirebase(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived ?? false
  const snapshot = await getDocs(collection(getFirestoreDb(), COLLECTION_NAME))
  return snapshot.docs
    .map((item) => mapProductPolicyDocument(item.id, item.data()))
    .filter((item) => (includeArchived ? true : !item.archivedAt))
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName))
}

export async function listProductPoliciesAsync(options?: { includeArchived?: boolean }) {
  if (DATA_MODE === 'firebase') return listProductPoliciesFirebase(options)
  return listProductPolicies(options)
}

export async function getProductPolicyAsync(id: string) {
  if (DATA_MODE === 'firebase') return readProductPolicyFromFirestore(id)
  return readLocalCollection<ProductPolicy>(LOCAL_KEY).find((item) => item.id === id) ?? null
}

export function upsertProductPolicy(payload: ProductPolicyPayload): ProductPolicyMutationResult {
  const validationError = validateProductPayload(payload)
  if (validationError) return { ok: false, error: validationError }

  const items = readLocalCollection<ProductPolicy>(LOCAL_KEY)
  const now = nowIsoDateTime()
  const current = payload.id ? items.find((item) => item.id === payload.id) : undefined
  const next: ProductPolicy = {
    id: current?.id ?? payload.id ?? createEntityId('product-policy'),
    serviceName: payload.serviceName.trim(),
    category: payload.category.trim(),
    salePrice: Math.max(0, payload.salePrice),
    recipe: payload.recipe.map((item) => ({
      ...item,
      quantityRequired: normalizeQuantityForUnit(item.quantityRequired, item.unit),
    })),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    archivedAt: current?.archivedAt,
  }
  writeLocalCollection(LOCAL_KEY, current ? items.map((item) => (item.id === next.id ? next : item)) : [next, ...items])
  return { ok: true, product: next }
}

export async function upsertProductPolicyFirebase(payload: ProductPolicyPayload): Promise<ProductPolicyMutationResult> {
  const validationError = validateProductPayload(payload)
  if (validationError) return { ok: false, error: validationError }

  const now = nowIsoDateTime()
  const current = payload.id ? await readProductPolicyFromFirestore(payload.id) : null
  const next: ProductPolicy = {
    id: current?.id ?? payload.id ?? createEntityId('product-policy'),
    serviceName: payload.serviceName.trim(),
    category: payload.category.trim(),
    salePrice: Math.max(0, payload.salePrice),
    recipe: payload.recipe.map((item) => ({
      ...item,
      quantityRequired: normalizeQuantityForUnit(item.quantityRequired, item.unit),
    })),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    archivedAt: current?.archivedAt,
  }
  await setDoc(doc(getFirestoreDb(), COLLECTION_NAME, next.id), productPolicyToFirestoreDocument(next), { merge: true })
  return { ok: true, product: next }
}

export async function upsertProductPolicyAsync(payload: ProductPolicyPayload): Promise<ProductPolicyMutationResult> {
  if (DATA_MODE === 'firebase') return upsertProductPolicyFirebase(payload)
  return upsertProductPolicy(payload)
}

export function archiveProductPolicy(id: string): ProductPolicyVoidResult {
  const items = readLocalCollection<ProductPolicy>(LOCAL_KEY)
  const current = items.find((item) => item.id === id)
  if (!current) return { ok: false, error: 'Produto ou serviço não encontrado.' }
  const next = { ...current, archivedAt: nowIsoDateTime(), updatedAt: nowIsoDateTime() }
  writeLocalCollection(LOCAL_KEY, items.map((item) => (item.id === id ? next : item)))
  return { ok: true }
}

export async function archiveProductPolicyFirebase(id: string): Promise<ProductPolicyVoidResult> {
  const current = await readProductPolicyFromFirestore(id)
  if (!current) return { ok: false, error: 'Produto ou serviço não encontrado.' }
  const next = { ...current, archivedAt: nowIsoDateTime(), updatedAt: nowIsoDateTime() }
  await setDoc(doc(getFirestoreDb(), COLLECTION_NAME, id), productPolicyToFirestoreDocument(next), { merge: true })
  return { ok: true }
}

export async function archiveProductPolicyAsync(id: string): Promise<ProductPolicyVoidResult> {
  if (DATA_MODE === 'firebase') return archiveProductPolicyFirebase(id)
  return archiveProductPolicy(id)
}
