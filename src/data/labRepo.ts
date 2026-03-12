import { loadDb, saveDb } from './db'
import { pushAudit } from './audit'
import { debitReplacementBankForLabStart } from './replacementBankRepo'
import { syncLabItemToCaseTray } from './sync'
import { loadSystemSettings } from '../lib/systemSettings'
import type { LabItem, LabStatus } from '../types/Lab'
import { isAlignerProductType, normalizeProductType } from '../types/Product'

const statusFlow: LabStatus[] = ['aguardando_iniciar', 'em_producao', 'controle_qualidade', 'prontas']

function nowIso() {
  return new Date().toISOString()
}

function hasProductionPlan(item: Pick<LabItem, 'plannedUpperQty' | 'plannedLowerQty'>) {
  const upper = item.plannedUpperQty
  const lower = item.plannedLowerQty
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return false
  if ((upper ?? 0) < 0 || (lower ?? 0) < 0) return false
  return (upper ?? 0) + (lower ?? 0) > 0
}

function validatePlanForCase(
  caseItem: { totalTraysUpper?: number; totalTraysLower?: number; totalTrays: number },
  item: Pick<LabItem, 'plannedUpperQty' | 'plannedLowerQty'>,
) {
  const upper = item.plannedUpperQty ?? 0
  const lower = item.plannedLowerQty ?? 0
  const maxUpper = caseItem.totalTraysUpper ?? caseItem.totalTrays
  const maxLower = caseItem.totalTraysLower ?? caseItem.totalTrays
  if (upper > maxUpper) return `Quantidade superior excede o planejamento do caso (${maxUpper}).`
  if (lower > maxLower) return `Quantidade inferior excede o planejamento do caso (${maxLower}).`
  return null
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function caseCode(caseItem: { treatmentCode?: string; id: string }) {
  return caseItem.treatmentCode ?? caseItem.id
}

function nextRequestRevision(db: ReturnType<typeof loadDb>, baseCode: string) {
  const max = db.labItems.reduce((acc, item) => {
    if (!item.requestCode) return acc
    const match = item.requestCode.match(/^(.+)\/([0-9]+)$/)
    if (!match || match[1] !== baseCode) return acc
    return Math.max(acc, Number(match[2]))
  }, 0)
  return max + 1
}

function isDeliveredToDentist(
  caseItem: { trays: Array<{ trayNumber: number; state: string }> },
  trayNumber: number,
) {
  const tray = caseItem.trays.find((current) => current.trayNumber === trayNumber)
  return tray?.state === 'entregue'
}

function nextPendingTrayNumber(caseItem: { trays: Array<{ trayNumber: number; state: string }> }) {
  const pending = caseItem.trays
    .filter((tray) => tray.state !== 'entregue')
    .map((tray) => tray.trayNumber)
    .sort((a, b) => a - b)
  return pending[0]
}

function getGuideAutomationConfig() {
  try {
    const settings = loadSystemSettings()
    return {
      enabled: settings.guideAutomation?.enabled !== false,
      leadDays: Math.max(0, Math.trunc(settings.guideAutomation?.leadDays ?? 10)),
    }
  } catch {
    return {
      enabled: true,
      leadDays: 10,
    }
  }
}

function ensureProgrammedReplenishments(db: ReturnType<typeof loadDb>) {
  const automation = getGuideAutomationConfig()
  if (!automation.enabled) return false
  const today = new Date().toISOString().slice(0, 10)
  let created = false
  db.cases.forEach((caseItem) => {
    if (caseItem.contract?.status !== 'aprovado') return
    const hasDelivered = caseItem.trays.some((tray) => tray.state === 'entregue')
    const hasPending = caseItem.trays.some((tray) => tray.state === 'pendente')
    if (!hasDelivered || !hasPending) return
    const code = caseCode(caseItem)
    caseItem.trays
      .filter((tray) => tray.state === 'pendente' && Boolean(tray.dueDate))
      .forEach((tray) => {
        const expected = tray.dueDate as string
        const startDate = addDays(expected, -automation.leadDays)
        if (startDate > today) return
        const key = `${caseItem.id}_${tray.trayNumber}_${expected}`
        const exists = db.labItems.some(
          (item) =>
            item.caseId === caseItem.id &&
            item.requestKind === 'reposicao_programada' &&
            item.expectedReplacementDate === expected &&
            item.trayNumber === tray.trayNumber,
        )
        if (exists) return
        const revision = nextRequestRevision(db, code)
        db.labItems = [
          {
            id: `lab_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
            caseId: caseItem.id,
            productType: normalizeProductType(caseItem.productType),
            productId: normalizeProductType(caseItem.productId ?? caseItem.productType),
            requestedProductId: caseItem.requestedProductId,
            requestedProductLabel: caseItem.requestedProductLabel,
            requestCode: `${code}/${revision}`,
            requestKind: 'reposicao_programada',
            expectedReplacementDate: expected,
            arch: caseItem.arch ?? 'ambos',
            plannedUpperQty: 0,
            plannedLowerQty: 0,
            planningDefinedAt: undefined,
            trayNumber: tray.trayNumber,
            patientName: caseItem.patientName,
            plannedDate: startDate,
            dueDate: expected,
            status: 'aguardando_iniciar',
            priority: 'Medio',
            notes: `Solicitacao automatica de reposição programada (${key}).`,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          },
          ...db.labItems,
        ]
        created = true
      })
  })
  return created
}

function ensureLabRequestCodes(db: ReturnType<typeof loadDb>) {
  const caseById = new Map(db.cases.map((item) => [item.id, item]))
  let changed = false
  const nextItems: LabItem[] = [...db.labItems]

  for (let index = 0; index < nextItems.length; index += 1) {
    const item = nextItems[index]
    if (!item.caseId) continue
    const linkedCase = caseById.get(item.caseId)
    if (!linkedCase) continue

    const baseCode = caseCode(linkedCase)
    const kind = item.requestKind ?? 'producao'
    if (item.requestCode && item.requestCode.trim().length > 0) {
      if (!item.requestKind) {
        changed = true
        nextItems[index] = { ...item, requestKind: kind, updatedAt: nowIso() }
      }
      continue
    }

    const hasBase = nextItems.some((other) => other.id !== item.id && other.caseId === item.caseId && other.requestCode === baseCode)
    const requestCode =
      kind === 'producao' && !hasBase
        ? baseCode
        : `${baseCode}/${nextRequestRevision({ ...db, labItems: nextItems }, baseCode)}`
    changed = true
    nextItems[index] = {
      ...item,
      requestKind: kind,
      requestCode,
      updatedAt: nowIso(),
    }
  }

  db.labItems = nextItems
  return changed
}

function dedupeProgrammedReplenishments(db: ReturnType<typeof loadDb>) {
  const keepByKey = new Map<string, LabItem>()
  const passthrough: LabItem[] = []
  let changed = false

  db.labItems.forEach((item) => {
    if (item.requestKind !== 'reposicao_programada' || item.status !== 'aguardando_iniciar') {
      passthrough.push(item)
      return
    }
    const key = `${item.caseId ?? '-'}_${item.trayNumber}_${item.expectedReplacementDate ?? item.dueDate}`
    const current = keepByKey.get(key)
    if (!current) {
      keepByKey.set(key, item)
      return
    }
    changed = true
    if ((item.updatedAt ?? '') > (current.updatedAt ?? '')) {
      keepByKey.set(key, item)
    }
  })

  if (!changed) return false
  db.labItems = [...keepByKey.values(), ...passthrough]
  return true
}

function removeLegacyAutoReworkItems(db: ReturnType<typeof loadDb>) {
  const before = db.labItems.length
  db.labItems = db.labItems.filter((item) => {
    if (item.requestKind !== 'reconfeccao') return true
    const note = (item.notes ?? '').toLowerCase()
    const isLegacyAuto = note.includes('reconfeccao automatica por defeito identificado')
    if (!isLegacyAuto) return true
    const linkedCase = item.caseId ? db.cases.find((current) => current.id === item.caseId) : null
    if (!linkedCase) return false
    const tray = linkedCase.trays.find((current) => current.trayNumber === item.trayNumber)
    return tray?.state === 'rework'
  })
  return db.labItems.length !== before
}

function ensureInitialReplenishmentSeed(
  db: ReturnType<typeof loadDb>,
  source: LabItem,
): LabItem | null {
  if (!source.caseId) return null
  if ((source.requestKind ?? 'producao') !== 'producao') return null
  if (source.status !== 'em_producao') return null
  const linkedCase = db.cases.find((item) => item.id === source.caseId)
  if (!linkedCase) return null

  const expectedReplacementDate =
    linkedCase.trays.find((tray) => tray.trayNumber === source.trayNumber)?.dueDate
    ?? source.expectedReplacementDate
    ?? source.dueDate
  const dueDate = expectedReplacementDate ?? source.dueDate
  const exists = db.labItems.some(
    (item) =>
      item.caseId === source.caseId &&
      item.requestKind === 'reposicao_programada' &&
      item.trayNumber === source.trayNumber,
  )
  if (exists) return null

  const now = nowIso()
  const baseCode = caseCode(linkedCase)
  const seeded: LabItem = {
    ...source,
    id: `lab_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    requestCode: `${baseCode}/${nextRequestRevision(db, baseCode)}`,
    requestKind: 'reposicao_programada',
    expectedReplacementDate,
    plannedUpperQty: 0,
    plannedLowerQty: 0,
    planningDefinedAt: undefined,
    plannedDate: now.slice(0, 10),
    dueDate,
    status: 'aguardando_iniciar',
    notes: `Reposição inicial gerada no início da confeccao da placa #${source.trayNumber}.`,
    createdAt: now,
    updatedAt: now,
  }
  db.labItems = [seeded, ...db.labItems]
  return seeded
}

export function canMoveToStatus(current: LabStatus, next: LabStatus) {
  const currentIndex = statusFlow.indexOf(current)
  const nextIndex = statusFlow.indexOf(next)
  return currentIndex >= 0 && nextIndex >= 0 && Math.abs(nextIndex - currentIndex) <= 1
}

export function previousStatus(status: LabStatus) {
  const index = statusFlow.indexOf(status)
  if (index <= 0) {
    return null
  }
  return statusFlow[index - 1]
}

export function nextStatus(status: LabStatus) {
  const index = statusFlow.indexOf(status)
  if (index < 0 || index >= statusFlow.length - 1) {
    return null
  }
  return statusFlow[index + 1]
}

export function listLabItems() {
  const db = loadDb()
  const coded = ensureLabRequestCodes(db)
  const created = ensureProgrammedReplenishments(db)
  const deduped = dedupeProgrammedReplenishments(db)
  const cleaned = removeLegacyAutoReworkItems(db)
  const changed = coded || created || deduped || cleaned
  if (changed) {
    saveDb(db)
  }
  return [...db.labItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

export function addLabItem(item: Omit<LabItem, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = loadDb()
  let linkedCase: (typeof db.cases)[number] | null = null
  if (item.caseId) {
    const caseItem = db.cases.find((current) => current.id === item.caseId)
    if (!caseItem) {
      return { ok: false as const, error: 'Caso vinculado não encontrado.' }
    }
    if (caseItem.contract?.status !== 'aprovado') {
      return { ok: false as const, error: 'Contrato não aprovado. Não e possível gerar OS para o laboratorio.' }
    }
    linkedCase = caseItem
  }

  if (linkedCase) {
    const invalidPlan = validatePlanForCase(linkedCase, item)
    if (invalidPlan) {
      return { ok: false as const, error: invalidPlan }
    }
  }

  const now = nowIso()
  const normalizedUpper = Math.trunc(item.plannedUpperQty ?? 0)
  const normalizedLower = Math.trunc(item.plannedLowerQty ?? 0)
  const baseCode = linkedCase ? caseCode(linkedCase) : `OS-${Date.now()}`
  const resolvedRequestCode = (() => {
    if (item.requestCode && item.requestCode.trim().length > 0) return item.requestCode
    if (!linkedCase) return baseCode
    const kind = item.requestKind ?? 'producao'
    const hasBase = db.labItems.some((other) => other.caseId === linkedCase.id && other.requestCode === baseCode)
    if (kind === 'producao' && !hasBase) return baseCode
    return `${baseCode}/${nextRequestRevision(db, baseCode)}`
  })()
  const resolvedUpper = normalizedUpper
  const resolvedLower = normalizedLower
  const resolvedProductType = normalizeProductType(item.productType ?? linkedCase?.productType)
  const planDefined = hasProductionPlan({ plannedUpperQty: resolvedUpper, plannedLowerQty: resolvedLower })
  const requiresAlignerPlan = isAlignerProductType(resolvedProductType)
  const resolvedStatus = requiresAlignerPlan
    ? (planDefined ? (item.status === 'aguardando_iniciar' ? 'em_producao' : item.status) : 'aguardando_iniciar')
    : item.status
  const newItem: LabItem = {
    ...item,
    productType: resolvedProductType,
    productId: normalizeProductType(item.productId ?? item.productType ?? linkedCase?.productId ?? linkedCase?.productType),
    requestedProductId: item.requestedProductId ?? linkedCase?.requestedProductId,
    requestedProductLabel: item.requestedProductLabel ?? linkedCase?.requestedProductLabel,
    arch: item.arch ?? 'ambos',
    requestCode: resolvedRequestCode,
    requestKind: item.requestKind ?? 'producao',
    expectedReplacementDate: item.expectedReplacementDate ?? item.dueDate,
    plannedUpperQty: resolvedUpper,
    plannedLowerQty: resolvedLower,
    planningDefinedAt: planDefined ? now : undefined,
    status: resolvedStatus,
    id: `lab_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
  }

  if (newItem.status === 'em_producao') {
    const debit = debitReplacementBankForLabStart(newItem, db)
    if (!debit.ok) {
      return { ok: false as const, error: debit.error }
    }
  }

  db.labItems = [newItem, ...db.labItems]
  if (item.caseId && newItem.status !== 'aguardando_iniciar') {
    db.cases = db.cases.map((caseItem) =>
      caseItem.id === item.caseId && caseItem.phase !== 'finalizado'
        ? { ...caseItem, phase: 'em_producao', status: 'em_producao', updatedAt: now }
        : caseItem,
    )
  }
  const sync = syncLabItemToCaseTray(newItem, db)
  const seededReplenishment = ensureInitialReplenishmentSeed(db, newItem)
  pushAudit(db, {
    entity: 'lab',
    entityId: newItem.id,
    action: 'lab.create',
    message: `OS ${newItem.requestCode ?? newItem.id} criada para ${newItem.patientName}.`,
  })
  if (seededReplenishment) {
    pushAudit(db, {
      entity: 'lab',
      entityId: seededReplenishment.id,
      action: 'lab.replenishment_seeded',
      message: `Reposição inicial ${seededReplenishment.requestCode ?? seededReplenishment.id} gerada automaticamente.`,
    })
  }
  saveDb(db)
  return { ok: true as const, item: newItem, sync }
}

export function updateLabItem(id: string, patch: Partial<LabItem>) {
  const db = loadDb()
  let changed: LabItem | null = null
  let error: string | null = null

  db.labItems = db.labItems.map((item) => {
    if (item.id !== id) {
      return item
    }
    const nextCaseId = patch.caseId ?? item.caseId
    const mergedPlan = {
      plannedUpperQty: Math.trunc(patch.plannedUpperQty ?? item.plannedUpperQty ?? 0),
      plannedLowerQty: Math.trunc(patch.plannedLowerQty ?? item.plannedLowerQty ?? 0),
    }
    const nextProductType = normalizeProductType(patch.productType ?? patch.productId ?? item.productId ?? item.productType)

    let linkedCase: (typeof db.cases)[number] | null = null
    if (nextCaseId) {
      const caseItem = db.cases.find((current) => current.id === nextCaseId)
      if (!caseItem || caseItem.contract?.status !== 'aprovado') {
        error = 'Caso vinculado invalido ou sem contrato aprovado.'
        return item
      }
      linkedCase = caseItem
      const invalidPlan = validatePlanForCase(caseItem, mergedPlan)
      if (invalidPlan) {
        error = invalidPlan
        return item
      }
    }

    const requestedStatus = patch.status ?? item.status
    const planDefined = hasProductionPlan(mergedPlan)
    const requiresAlignerPlan = isAlignerProductType(nextProductType)
    const nextStatus = item.status === 'aguardando_iniciar'
      ? (requiresAlignerPlan ? (planDefined ? 'em_producao' : 'aguardando_iniciar') : requestedStatus)
      : (requiresAlignerPlan && !planDefined && requestedStatus === 'em_producao' ? 'aguardando_iniciar' : requestedStatus)
    if (linkedCase && isDeliveredToDentist(linkedCase, patch.trayNumber ?? item.trayNumber) && nextStatus !== item.status) {
      error = 'Não e permitido regredir/editar status de placa ja entregue ao dentista.'
      return item
    }
    if (!canMoveToStatus(item.status, nextStatus)) {
      error = 'Transicao de status invalida para este item.'
      return item
    }
    const nextArch = patch.arch ?? item.arch
    if (nextStatus === 'em_producao' && !nextArch) {
      error = 'Defina a arcada do produto antes de iniciar producao.'
      return item
    }
    if (nextStatus === 'em_producao' && requiresAlignerPlan && !planDefined) {
      error = 'Defina quantidades por arcada antes de iniciar producao.'
      return item
    }
    const now = nowIso()
    if (item.status !== 'em_producao' && nextStatus === 'em_producao') {
      const debit = debitReplacementBankForLabStart(
        {
          ...item,
          ...patch,
          productType: nextProductType,
          productId: normalizeProductType(patch.productId ?? patch.productType ?? item.productId ?? item.productType),
          arch: nextArch,
          plannedUpperQty: mergedPlan.plannedUpperQty,
          plannedLowerQty: mergedPlan.plannedLowerQty,
          status: nextStatus,
        },
        db,
      )
      if (!debit.ok) {
        error = debit.error
        return item
      }
    }

    changed = {
      ...item,
      ...patch,
      status: nextStatus,
      arch: nextArch,
      productType: nextProductType,
      productId: normalizeProductType(patch.productId ?? patch.productType ?? item.productId ?? item.productType),
      plannedUpperQty: mergedPlan.plannedUpperQty,
      plannedLowerQty: mergedPlan.plannedLowerQty,
      planningDefinedAt: hasProductionPlan(mergedPlan) ? item.planningDefinedAt ?? now : undefined,
      updatedAt: now,
    }

    return changed
  })

  const updatedItem = db.labItems.find((item) => item.id === id) ?? null
  const sync = changed ? syncLabItemToCaseTray(changed, db) : { ok: true as const }
  const seededReplenishment = changed ? ensureInitialReplenishmentSeed(db, changed) : null
  if (updatedItem) {
    pushAudit(db, {
      entity: 'lab',
      entityId: updatedItem.id,
      action: 'lab.update',
      message: `OS ${updatedItem.requestCode ?? updatedItem.id} atualizada para status ${updatedItem.status}.`,
    })
  }
  if (seededReplenishment) {
    pushAudit(db, {
      entity: 'lab',
      entityId: seededReplenishment.id,
      action: 'lab.replenishment_seeded',
      message: `Reposição inicial ${seededReplenishment.requestCode ?? seededReplenishment.id} gerada automaticamente.`,
    })
  }
  saveDb(db)
  return { item: updatedItem, sync, error: changed ? undefined : error ?? 'Não foi possível atualizar o item.' }
}

export function moveLabItem(id: string, status: LabStatus) {
  const db = loadDb()
  let changed: LabItem | null = null
  let error: string | null = null

  db.labItems = db.labItems.map((item) => {
    if (item.id !== id) {
      return item
    }
    const linkedCase = item.caseId ? db.cases.find((current) => current.id === item.caseId) : null
    if (linkedCase && isDeliveredToDentist(linkedCase, item.trayNumber) && status !== item.status) {
      error = 'Não e permitido regredir/editar status de placa ja entregue ao dentista.'
      return item
    }
    if (!canMoveToStatus(item.status, status)) {
      error = 'Transicao de status invalida para este item.'
      return item
    }
    if (item.status === 'aguardando_iniciar' && status === 'em_producao') {
      if (!item.arch) {
        error = 'Defina a arcada do produto antes de iniciar producao.'
        return item
      }
      if (isAlignerProductType(normalizeProductType(item.productId ?? item.productType)) && !hasProductionPlan(item)) {
        error = 'Defina quantidades por arcada antes de iniciar producao.'
        return item
      }
    }
    if (status === 'em_producao' && !item.arch) {
      error = 'Defina a arcada do produto antes de iniciar producao.'
      return item
    }

    const now = nowIso()
    if (item.status !== 'em_producao' && status === 'em_producao') {
      const debit = debitReplacementBankForLabStart({ ...item, status }, db)
      if (!debit.ok) {
        error = debit.error
        return item
      }
    }
    changed = { ...item, status, updatedAt: now }
    return changed
  })

  const movedItem = db.labItems.find((item) => item.id === id) ?? null
  const sync = changed ? syncLabItemToCaseTray(changed, db) : { ok: true as const }
  const seededReplenishment = changed ? ensureInitialReplenishmentSeed(db, changed) : null
  if (movedItem) {
    pushAudit(db, {
      entity: 'lab',
      entityId: movedItem.id,
      action: 'lab.move',
      message: `OS ${movedItem.requestCode ?? movedItem.id} movida para ${movedItem.status}.`,
    })
  }
  if (seededReplenishment) {
    pushAudit(db, {
      entity: 'lab',
      entityId: seededReplenishment.id,
      action: 'lab.replenishment_seeded',
      message: `Reposição inicial ${seededReplenishment.requestCode ?? seededReplenishment.id} gerada automaticamente.`,
    })
  }
  saveDb(db)
  return { item: movedItem, sync, error: changed ? undefined : error ?? 'Não foi possível mover o item.' }
}

export function deleteLabItem(id: string) {
  const db = loadDb()
  const removed = db.labItems.find((item) => item.id === id) ?? null
  if (!removed) {
    saveDb(db)
    return
  }
  const isReworkProduction = (item: LabItem) =>
    (item.requestKind ?? 'producao') === 'producao' && (item.notes ?? '').toLowerCase().includes('rework da placa')

  const idsToRemove = new Set<string>([id])
  if (removed.caseId) {
    if (removed.requestKind === 'reconfeccao') {
      db.labItems
        .filter(
          (item) =>
            item.id !== removed.id &&
            item.caseId === removed.caseId &&
            item.trayNumber === removed.trayNumber &&
            isReworkProduction(item),
        )
        .forEach((item) => idsToRemove.add(item.id))
    } else if (isReworkProduction(removed)) {
      db.labItems
        .filter(
          (item) =>
            item.id !== removed.id &&
            item.caseId === removed.caseId &&
            item.trayNumber === removed.trayNumber &&
            item.requestKind === 'reconfeccao',
        )
        .forEach((item) => idsToRemove.add(item.id))
    }
  }

  const removedItems = db.labItems.filter((item) => idsToRemove.has(item.id))
  db.labItems = db.labItems.filter((item) => !idsToRemove.has(item.id))
  removedItems.forEach((item) => {
    pushAudit(db, {
      entity: 'lab',
      entityId: item.id,
      action: 'lab.delete',
      message: `OS ${item.requestCode ?? item.id} removida.`,
    })
    const linkedCase = item.caseId ? db.cases.find((current) => current.id === item.caseId) : null
    if (linkedCase?.patientId) {
      pushAudit(db, {
        entity: 'patient',
        entityId: linkedCase.patientId,
        action: 'patient.history.lab_delete',
        message: `OS LAB removida (${item.requestCode ?? item.id}) - placa #${item.trayNumber}.`,
      })
    }
  })
  saveDb(db)
}

export function generateLabOrder(caseId: string) {
  const db = loadDb()
  const caseItem = db.cases.find((item) => item.id === caseId)
  if (!caseItem) {
    return { ok: false as const, error: 'Caso não encontrado.' }
  }
  if (caseItem.contract?.status !== 'aprovado') {
    return { ok: false as const, error: 'Contrato não aprovado. Não e possível gerar OS para o laboratorio.' }
  }

  const existing = db.labItems.find((item) => item.caseId === caseId && (item.requestKind ?? 'producao') === 'producao')
  if (existing) {
    return { ok: true as const, item: existing, alreadyExists: true as const }
  }

  const today = new Date().toISOString().slice(0, 10)
  const due = new Date(`${today}T00:00:00`)
  due.setDate(due.getDate() + 7)
  const dueDate = due.toISOString().slice(0, 10)

  const created = addLabItem({
    caseId,
    requestCode: caseCode(caseItem),
    requestKind: 'producao',
    expectedReplacementDate: dueDate,
    arch: caseItem.arch ?? 'ambos',
    patientName: caseItem.patientName,
    trayNumber: 1,
    plannedDate: today,
    dueDate,
    status: 'aguardando_iniciar',
    priority: 'Medio',
    plannedUpperQty: undefined,
    plannedLowerQty: undefined,
    notes: 'OS gerada a partir do fluxo comercial do caso. Defina quantidade por arcada antes de produzir.',
  })

  if (!created.ok) {
    return { ok: false as const, error: created.error }
  }

  return { ok: true as const, item: created.item, alreadyExists: false as const }
}

export function createAdvanceLabOrder(
  sourceLabItemId: string,
  payload: { plannedUpperQty: number; plannedLowerQty: number; dueDate?: string },
) {
  const db = loadDb()
  const source = db.labItems.find((item) => item.id === sourceLabItemId)
  if (!source) {
    return { ok: false as const, error: 'OS de origem não encontrada.' }
  }
  if (!source.caseId) {
    return { ok: false as const, error: 'OS sem caso vinculado.' }
  }
  const linkedCase = db.cases.find((item) => item.id === source.caseId)
  if (!linkedCase) {
    return { ok: false as const, error: 'Caso vinculado não encontrado.' }
  }
  if (linkedCase.contract?.status !== 'aprovado') {
    return { ok: false as const, error: 'Contrato não aprovado para gerar OS antecipada.' }
  }
  const plannedUpperQty = Math.max(0, Math.trunc(payload.plannedUpperQty))
  const plannedLowerQty = Math.max(0, Math.trunc(payload.plannedLowerQty))
  if (plannedUpperQty + plannedLowerQty <= 0) {
    return { ok: false as const, error: 'Informe quantidade maior que zero para gerar OS antecipada.' }
  }
  const invalidPlan = validatePlanForCase(linkedCase, { plannedUpperQty, plannedLowerQty })
  if (invalidPlan) {
    return { ok: false as const, error: invalidPlan }
  }
  const nextTrayNumber = nextPendingTrayNumber(linkedCase)
  if (!nextTrayNumber) {
    return { ok: false as const, error: 'Não ha placas pendentes para gerar OS antecipada.' }
  }

  const now = nowIso()
  const today = now.slice(0, 10)
  const baseCode = caseCode(linkedCase)
  const dueDate = payload.dueDate ?? source.expectedReplacementDate ?? source.dueDate
  const sourceIsRevision = Boolean(source.requestCode && new RegExp(`^${baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`).test(source.requestCode))
  const requestCode = source.requestKind === 'reposicao_programada' && sourceIsRevision
    ? (source.requestCode as string)
    : `${baseCode}/${nextRequestRevision(db, baseCode)}`

  if (source.requestKind === 'reposicao_programada') {
    db.labItems = db.labItems.filter((item) => item.id !== source.id)
  }
  const newItem: LabItem = {
    ...source,
    productType: normalizeProductType(source.productType ?? linkedCase.productType),
    productId: normalizeProductType(source.productId ?? source.productType ?? linkedCase.productId ?? linkedCase.productType),
    id: `lab_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    requestCode,
    requestKind: 'producao',
    expectedReplacementDate: source.expectedReplacementDate ?? source.dueDate,
    trayNumber: nextTrayNumber,
    plannedUpperQty,
    plannedLowerQty,
    planningDefinedAt: now,
    plannedDate: today,
    dueDate,
    // OS antecipada entra na esteira para início manual da producao.
    status: 'aguardando_iniciar',
    priority: 'Urgente',
    notes: `OS antecipada gerada manualmente a partir de ${source.requestCode ?? source.id}.`,
    createdAt: now,
    updatedAt: now,
  }
  db.labItems = [newItem, ...db.labItems]
  const sync = syncLabItemToCaseTray(newItem, db)
  pushAudit(db, {
    entity: 'lab',
    entityId: source.id,
    action: 'lab.advance_source_consumed',
    message: `Base de reposição ${source.requestCode ?? source.id} consumida para antecipacao.`,
  })
  pushAudit(db, {
    entity: 'lab',
    entityId: newItem.id,
    action: 'lab.advance_created',
    message: `OS antecipada ${newItem.requestCode ?? newItem.id} criada para ${newItem.patientName}.`,
  })
  saveDb(db)
  return { ok: true as const, item: newItem, sync }
}

