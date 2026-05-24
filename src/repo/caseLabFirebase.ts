import { doc, setDoc } from 'firebase/firestore'
import { db as firestoreDb } from '../lib/firebaseClient'
import { getCaseFirebase } from '../data/caseRepo'
import { listLabOrdersFirebase } from '../modules/lab/infra/firebase/FirestoreLabRepository'
import { BUSINESS_EVENTS } from '../shared/observability'
import { nowIsoDateTime } from '../shared/utils/date'
import { createEntityId } from '../shared/utils/id'
import { logger } from '../lib/logger'
import { normalizeProductType, type ProductType } from '../types/Product'
import { labOrderToFirestoreDocument } from '../modules/lab/infra/firebase/firestoreLabMappers'

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase não configurado.')
  }
  return firestoreDb
}

export async function generateCaseLabOrderFirebase(caseId: string) {
  const current = await getCaseFirebase(caseId)
  if (!current) return { ok: false as const, error: 'Caso não encontrado.' }
  if (current.contract?.status !== 'aprovado') {
    return { ok: false as const, error: 'Contrato não aprovado. Não é possível gerar OS para o laboratório.' }
  }

  const existingItems = (await listLabOrdersFirebase()).filter((item) => item.caseId === caseId)
  const existing = existingItems.find((item) => (item.requestKind ?? 'producao') === 'producao')
  if (existing) return { ok: true as const, alreadyExists: true as const }

  const now = nowIsoDateTime()
  const today = now.slice(0, 10)
  const due = new Date(`${today}T00:00:00`)
  due.setDate(due.getDate() + 7)
  const dueDate = due.toISOString().slice(0, 10)
  const productType = normalizeProductType(current.productType ?? current.productId)
  const requestCode = current.treatmentCode ?? current.id

  const order = {
    id: createEntityId('lab'),
    requestCode,
    productType: productType as ProductType,
    productId: productType as ProductType,
    requestedProductId: current.requestedProductId,
    requestedProductLabel: current.requestedProductLabel,
    requestKind: 'producao' as const,
    expectedReplacementDate: dueDate,
    caseId,
    arch: current.arch ?? 'ambos',
    plannedUpperQty: 0,
    plannedLowerQty: 0,
    trayNumber: 1,
    patientName: current.patientName ?? '-',
    plannedDate: today,
    dueDate,
    status: 'aguardando_iniciar' as const,
    priority: 'Medio' as const,
    notes: 'OS gerada a partir do fluxo comercial do caso. Defina quantidade por arcada antes de produzir.',
    createdAt: now,
    updatedAt: now,
  }

  await setDoc(doc(getFirestoreDb(), 'lab_items', order.id), labOrderToFirestoreDocument(order))
  logger.business(BUSINESS_EVENTS.LAB_SENT, 'Caso enviado para o LAB.', {
    caseId,
    requestCode,
    trayNumber: 1,
    productType,
    dueDate,
    source: 'caseLabFirebase.generateCaseLabOrderFirebase',
  })
  return { ok: true as const, alreadyExists: false as const }
}
