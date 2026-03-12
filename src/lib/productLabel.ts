import { loadSystemSettings } from './systemSettings'
import { isAlignerProductType, normalizeProductType, PRODUCT_TYPE_LABEL } from '../types/Product'

type ProductLabelSource = {
  requestedProductId?: string | null
  requestedProductLabel?: string | null
  productType?: unknown
  productId?: unknown
  alignerFallbackLabel?: string
}

export function findCatalogProductName(requestedProductId?: string | null) {
  const normalizedId = (requestedProductId ?? '').trim()
  if (!normalizedId) return ''
  try {
    const match = (loadSystemSettings().priceCatalog ?? []).find((item) => item.id === normalizedId)
    return match?.name?.trim() ?? ''
  } catch {
    return ''
  }
}

export function resolveRequestedProductLabel(source: ProductLabelSource) {
  const resolvedProductType = normalizeProductType(source.productId ?? source.productType, 'alinhador_12m')
  if (isAlignerProductType(resolvedProductType)) {
    return source.alignerFallbackLabel?.trim() || 'Alinhador'
  }

  const explicitLabel = (source.requestedProductLabel ?? '').trim()
  if (explicitLabel) return explicitLabel

  const catalogLabel = findCatalogProductName(source.requestedProductId)
  if (catalogLabel) return catalogLabel

  return PRODUCT_TYPE_LABEL[resolvedProductType]
}
