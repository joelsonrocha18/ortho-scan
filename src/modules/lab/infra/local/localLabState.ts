import type { AppDb } from '../../../../data/db'
import { nowIsoDateTime } from '../../../../shared/utils/date'
import { createEntityId } from '../../../../shared/utils/id'
import type { Case } from '../../../../types/Case'
import type { LabItem } from '../../../../types/Lab'
import type { LabOrder } from '../../domain/entities/LabOrder'
import {
  hasProductionPlan,
  isProgrammedReplenishmentOrder,
  toLabOrder,
} from '../../domain/entities/LabOrder'

function caseCode(caseItem: Pick<Case, 'treatmentCode' | 'id'>) {
  return caseItem.treatmentCode ?? caseItem.id
}

export function nextRequestRevision(db: Pick<AppDb, 'labItems'>, baseCode: string) {
  const max = db.labItems.reduce((acc, item) => {
    if (!item.requestCode) return acc
    const match = item.requestCode.match(/^(.+)\/([0-9]+)$/)
    if (!match || match[1] !== baseCode) return acc
    return Math.max(acc, Number(match[2]))
  }, 0)
  return max + 1
}

export function nextPendingTrayNumber(caseItem: Pick<Case, 'trays'>) {
  const pending = caseItem.trays
    .filter((tray) => tray.state !== 'entregue')
    .map((tray) => tray.trayNumber)
    .sort((a, b) => a - b)
  return pending[0]
}

export function isDeliveredToDentist(caseItem: Pick<Case, 'trays'>, trayNumber: number) {
  const tray = caseItem.trays.find((current) => current.trayNumber === trayNumber)
  return tray?.state === 'entregue'
}

export function ensureLabRequestCodes(db: AppDb) {
  const caseById = new Map(db.cases.map((item) => [item.id, item]))
  let changed = false
  const nextItems = [...db.labItems]

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
        nextItems[index] = { ...item, requestKind: kind, updatedAt: nowIsoDateTime() }
      }
      continue
    }

    const hasBase = nextItems.some((other) => other.id !== item.id && other.caseId === item.caseId && other.requestCode === baseCode)
    const requestCode =
      kind === 'producao' && !hasBase
        ? baseCode
        : `${baseCode}/${nextRequestRevision({ labItems: nextItems } as Pick<AppDb, 'labItems'>, baseCode)}`
    changed = true
    nextItems[index] = {
      ...item,
      requestKind: kind,
      requestCode,
      updatedAt: nowIsoDateTime(),
    }
  }

  db.labItems = nextItems
  return changed
}

export function dedupeProgrammedReplenishments(db: AppDb) {
  const keepByKey = new Map<string, LabItem>()
  const passthrough: LabItem[] = []
  let changed = false

  db.labItems.forEach((item) => {
    if ((item.requestKind ?? 'producao') !== 'reposicao_programada' || item.status !== 'aguardando_iniciar') {
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

export function removeLegacyAutoReworkOrders(db: AppDb) {
  const before = db.labItems.length
  db.labItems = db.labItems.filter((item) => {
    if ((item.requestKind ?? 'producao') !== 'reconfeccao') return true
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

export function listLocalLabOrders(db: AppDb) {
  const coded = ensureLabRequestCodes(db)
  const deduped = dedupeProgrammedReplenishments(db)
  const cleaned = removeLegacyAutoReworkOrders(db)
  return {
    changed: coded || deduped || cleaned,
    items: [...db.labItems].map(toLabOrder).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  }
}

export function buildResolvedRequestCode(
  db: AppDb,
  linkedCase: Pick<Case, 'id' | 'treatmentCode'> | null,
  payload: Pick<LabOrder, 'requestCode' | 'requestKind'>,
) {
  if (payload.requestCode && payload.requestCode.trim().length > 0) {
    return payload.requestCode
  }
  const baseCode = linkedCase ? caseCode(linkedCase) : `OS-${createEntityId('lab-code', 0)}`
  if (!linkedCase) return baseCode
  const kind = payload.requestKind ?? 'producao'
  const hasBase = db.labItems.some((other) => other.caseId === linkedCase.id && other.requestCode === baseCode)
  if (kind === 'producao' && !hasBase) return baseCode
  return `${baseCode}/${nextRequestRevision(db, baseCode)}`
}

export function resolveProductionPlanning(
  order: Pick<LabOrder, 'plannedUpperQty' | 'plannedLowerQty'>,
) {
  const plannedUpperQty = Math.trunc(order.plannedUpperQty ?? 0)
  const plannedLowerQty = Math.trunc(order.plannedLowerQty ?? 0)
  return {
    plannedUpperQty,
    plannedLowerQty,
    planDefined: hasProductionPlan({
      plannedUpperQty,
      plannedLowerQty,
    }),
  }
}

export function isProgrammedReplacementSource(order: Pick<LabOrder, 'requestKind'>) {
  return isProgrammedReplenishmentOrder(order)
}
