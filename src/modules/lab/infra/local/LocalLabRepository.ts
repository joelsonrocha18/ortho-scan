import { listCasesForUser, listLabItemsForUser, listPatientsForUser } from '../../../../auth/scope'
import { pushAudit } from '../../../../data/audit'
import type { AppDb } from '../../../../data/db'
import { loadDb, saveDb } from '../../../../data/db'
import { debitReplacementBankForLabStart, handleRework as handleReplacementRework, markReplacementBankDeliveredByLot } from '../../../../data/replacementBankRepo'
import { syncLabItemToCaseTray } from '../../../../data/sync'
import { ok, err, type Result } from '../../../../shared/errors'
import { createOrthoDomainEvent, mergeOrthoDomainEvents } from '../../../../shared/domain'
import { BUSINESS_EVENTS, logger } from '../../../../shared/observability'
import { buildStandaloneLabDueDate, canTransitionLabOrderStage, hasProductionPlan, isReworkProductionOrder, resolveAutomaticLabOrderStage, resolveLabOrderProductType, requiresLabPlan, toLabOrder, validatePlanForCase, assertReadyToStartProduction, buildLabOrderNotesWithReason, createLabOrderDraft, normalizeLabArch, normalizeLabPriority } from '../../domain/entities/LabOrder'
import type { LabOrder } from '../../domain/entities/LabOrder'
import { CaseLifecycleService } from '../../../cases/domain/services/CaseLifecycleService'
import { LabSLAService } from '../../domain/services/LabSLAService'
import { ReworkFinancialImpactService } from '../../domain/services/ReworkFinancialImpactService'
import { adjustInstallationForRework, removeTrayFromDeliveryLots } from '../../domain/services/ReworkCaseAdjustments'
import { LabStage } from '../../domain/valueObjects/LabStage'
import type { User } from '../../../../types/User'
import { createEntityId } from '../../../../shared/utils/id'
import { nowIsoDate, nowIsoDateTime, toIsoDate } from '../../../../shared/utils/date'
import type { LabStageValue } from '../../../../types/Domain'
import { normalizeProductType, isAlignerProductType } from '../../../../types/Product'
import type { Case } from '../../../../types/Case'
import type { LabItem } from '../../../../types/Lab'
import type {
  CreateAdvanceLabOrderInput,
  LabOverview,
  LabPatientOption,
  LabRepository,
  RegisterLabOrderInput,
  RegisterReworkInput,
  RegisterReworkOutput,
  RegisterShipmentInput,
  RegisterShipmentOutput,
  UpdateLabOrderInput,
  UpdateLabStageInput,
} from '../../application/ports/LabRepository'
import {
  buildResolvedRequestCode,
  ensureInitialReplenishmentSeed,
  isDeliveredToDentist,
  listLocalLabOrders,
  nextPendingTrayNumber,
  resolveProductionPlanning,
} from './localLabState'

function buildPatientOptions(db: AppDb, currentUser: User | null): LabPatientOption[] {
  const patients = currentUser ? listPatientsForUser(db, currentUser) : db.patients
  return patients.map((patient) => {
    const dentist = patient.primaryDentistId ? db.dentists.find((item) => item.id === patient.primaryDentistId) : undefined
    const clinic = patient.clinicId ? db.clinics.find((item) => item.id === patient.clinicId) : undefined
    return {
      id: patient.id,
      shortId: patient.shortId,
      name: patient.name,
      birthDate: patient.birthDate,
      dentistId: patient.primaryDentistId,
      clinicId: patient.clinicId,
      dentistName: dentist?.name,
      clinicName: clinic?.tradeName,
    }
  })
}

function sortOrders(items: LabItem[]) {
  return [...items].map(toLabOrder).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

function nextRangeByArch(
  caseItem: Pick<Case, 'deliveryLots'>,
  arch: 'superior' | 'inferior',
  trayNumber: number,
  qty: number,
) {
  const lots = caseItem.deliveryLots ?? []
  const maxDelivered = lots.reduce((acc, lot) => {
    if (lot.arch === arch || lot.arch === 'ambos') {
      return Math.max(acc, lot.toTray)
    }
    return acc
  }, 0)
  const fromTray = Math.max(maxDelivered + 1, trayNumber)
  const toTray = fromTray + qty - 1
  return { fromTray, toTray }
}

function appendStageTimeline(item: LabItem, stage: LabStageValue, at: string) {
  const timeline = [...(item.stageTimeline ?? [])]
  const latest = timeline[timeline.length - 1]
  if (!latest || latest.stage !== stage) {
    timeline.push({ stage, at })
  }
  return timeline
}

function appendDomainEvents(item: LabItem, stage: LabStageValue, at: string) {
  const aggregateId = item.caseId ?? item.id
  const aggregateType = item.caseId ? 'case' : 'lab'
  const incoming = []

  if (stage === 'in_production') {
    incoming.push(createOrthoDomainEvent('LabStarted', aggregateId, aggregateType, {
      caseId: item.caseId,
      labOrderId: item.id,
      trayNumber: item.trayNumber,
      requestCode: item.requestCode,
      labStage: stage,
    }, at))
  }

  if (stage === 'shipped' || stage === 'delivered') {
    incoming.push(createOrthoDomainEvent('LabShipped', aggregateId, aggregateType, {
      caseId: item.caseId,
      labOrderId: item.id,
      trayNumber: item.trayNumber,
      requestCode: item.requestCode,
      labStage: stage,
    }, at))
  }

  return mergeOrthoDomainEvents(item.domainEvents ?? [], incoming)
}

function enrichLabItemDomainState(item: LabItem, at = item.updatedAt || item.createdAt): LabItem {
  const stage = LabStage.fromOrder(item).value
  const enriched: LabItem = {
    ...item,
    stage,
    stageTimeline: appendStageTimeline(item, stage, at),
    domainEvents: appendDomainEvents(item, stage, at),
  }
  return {
    ...enriched,
    sla: LabSLAService.evaluate(toLabOrder(enriched), at),
  }
}

function refreshCaseDomainState(db: AppDb, caseId?: string | null) {
  if (!caseId) return
  const caseItem = db.cases.find((item) => item.id === caseId)
  if (!caseItem) return

  const labOrders = db.labItems
    .filter((item) => item.caseId === caseId)
    .map((item) => toLabOrder(enrichLabItemDomainState(item)))

  const refreshed = CaseLifecycleService.refreshCase(caseItem, labOrders)
  db.cases = db.cases.map((item) => (item.id === refreshed.id ? refreshed : item))
}

export class LocalLabRepository implements LabRepository {
  private readonly currentUser: User | null

  constructor(currentUser: User | null) {
    this.currentUser = currentUser
  }

  private loadPreparedDb() {
    const db = loadDb()
    const prepared = listLocalLabOrders(db)
    if (prepared.changed) {
      saveDb(db)
    }
    return { db, prepared }
  }

  loadOverview(): Result<LabOverview, string> {
    const { db } = this.loadPreparedDb()
    const visibleCaseList = this.currentUser ? listCasesForUser(db, this.currentUser) : db.cases
    const cases = visibleCaseList.map((caseItem) =>
      CaseLifecycleService.refreshCase(
        caseItem,
        db.labItems.filter((item) => item.caseId === caseItem.id).map((item) => toLabOrder(enrichLabItemDomainState(item))),
      ),
    )
    const items = (this.currentUser ? listLabItemsForUser(db, this.currentUser) : db.labItems)
      .map((item) => enrichLabItemDomainState(item))
      .map(toLabOrder)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return ok({
      items,
      cases,
      patientOptions: buildPatientOptions(db, this.currentUser),
      dentists: db.dentists.map((item) => ({
        id: item.id,
        name: item.name ?? '-',
        gender: item.gender,
      })),
      clinics: db.clinics.map((item) => ({
        id: item.id,
        tradeName: item.tradeName ?? '-',
      })),
      casePrintFallbackByCaseId: {},
    })
  }

  listOrders() {
    const { db } = this.loadPreparedDb()
    return ok(sortOrders((this.currentUser ? listLabItemsForUser(db, this.currentUser) : db.labItems).map((item) => enrichLabItemDomainState(item))))
  }

  findById(id: string) {
    const { db } = this.loadPreparedDb()
    const item = db.labItems.find((entry) => entry.id === id)
    return item ? toLabOrder(enrichLabItemDomainState(item)) : null
  }

  createOrder(input: RegisterLabOrderInput) {
    const db = loadDb()
    let linkedCase: Case | null = null
    if (input.caseId) {
      const caseItem = db.cases.find((current) => current.id === input.caseId)
      if (!caseItem) {
        return err('Caso vinculado não encontrado.')
      }
      if (caseItem.contract?.status !== 'aprovado') {
        return err('Contrato não aprovado. Não é possível gerar OS para o laboratório.')
      }
      linkedCase = caseItem
    }

    const normalizedDraft = createLabOrderDraft({
      ...input,
      arch: normalizeLabArch(input.arch),
      priority: normalizeLabPriority(input.priority),
      dueDate: input.dueDate,
      plannedDate: input.plannedDate ?? nowIsoDate(),
      requestKind: input.requestKind ?? 'producao',
    })

    if (linkedCase) {
      const invalidPlan = validatePlanForCase(linkedCase, normalizedDraft)
      if (invalidPlan) {
        return err(invalidPlan)
      }
    }

    const nowIso = nowIsoDateTime()
    const resolvedProductType = resolveLabOrderProductType(normalizedDraft, linkedCase)
    const planning = resolveProductionPlanning(normalizedDraft)
    const resolvedStatus = requiresLabPlan(normalizedDraft, linkedCase)
      ? resolveAutomaticLabOrderStage(normalizedDraft.status, normalizedDraft, linkedCase)
      : normalizedDraft.status

    const nextItem = enrichLabItemDomainState({
      ...normalizedDraft,
      productType: resolvedProductType,
      productId: normalizeProductType(input.productId ?? input.productType ?? linkedCase?.productId ?? linkedCase?.productType),
      requestedProductId: input.requestedProductId ?? linkedCase?.requestedProductId,
      requestedProductLabel: input.requestedProductLabel ?? linkedCase?.requestedProductLabel,
      requestCode: buildResolvedRequestCode(db, linkedCase, {
        requestCode: normalizedDraft.requestCode,
        requestKind: normalizedDraft.requestKind ?? 'producao',
      } as LabOrder),
      requestKind: normalizedDraft.requestKind ?? 'producao',
      expectedReplacementDate: normalizedDraft.expectedReplacementDate ?? normalizedDraft.dueDate,
      plannedUpperQty: planning.plannedUpperQty,
      plannedLowerQty: planning.plannedLowerQty,
      planningDefinedAt: planning.planDefined ? nowIso : undefined,
      status: resolvedStatus,
      id: createEntityId('lab'),
      createdAt: nowIso,
      updatedAt: nowIso,
    }, nowIso)

    if (nextItem.status === 'em_producao') {
      const debit = debitReplacementBankForLabStart(nextItem, db)
      if (!debit.ok) {
        return err(debit.error)
      }
    }

    db.labItems = [nextItem, ...db.labItems]
    if (nextItem.caseId && nextItem.status !== 'aguardando_iniciar') {
      db.cases = db.cases.map((caseItem) =>
        caseItem.id === nextItem.caseId && caseItem.phase !== 'finalizado'
          ? { ...caseItem, phase: 'em_producao', status: 'em_producao', updatedAt: nowIso }
          : caseItem,
      )
    }
    refreshCaseDomainState(db, nextItem.caseId)

    const sync = syncLabItemToCaseTray(nextItem, db)
    const seededReplenishment = ensureInitialReplenishmentSeed(db, toLabOrder(nextItem))
    pushAudit(db, {
      entity: 'lab',
      entityId: nextItem.id,
      action: 'lab.create',
      message: 'OS LAB criada.',
      context: {
        labOrderId: nextItem.id,
        caseId: nextItem.caseId,
        requestCode: nextItem.requestCode ?? nextItem.id,
        requestKind: nextItem.requestKind ?? 'producao',
        trayNumber: nextItem.trayNumber,
        status: nextItem.status,
        stage: nextItem.stage,
      },
    })
    if (seededReplenishment) {
      pushAudit(db, {
        entity: 'lab',
        entityId: seededReplenishment.id,
        action: 'lab.replenishment_seeded',
        message: 'Reposição inicial gerada automaticamente.',
        context: {
          labOrderId: seededReplenishment.id,
          caseId: seededReplenishment.caseId,
          requestCode: seededReplenishment.requestCode ?? seededReplenishment.id,
          trayNumber: seededReplenishment.trayNumber,
        },
      })
    }
    saveDb(db)
    if (nextItem.caseId && (nextItem.requestKind ?? 'producao') === 'producao') {
      logger.business(BUSINESS_EVENTS.LAB_SENT, 'Caso enviado para o LAB.', {
        labOrderId: nextItem.id,
        caseId: nextItem.caseId,
        requestCode: nextItem.requestCode ?? nextItem.id,
        trayNumber: nextItem.trayNumber,
        productType: nextItem.productType,
        status: nextItem.status,
        stage: nextItem.stage,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
    }
    return ok({
      order: toLabOrder(nextItem),
      syncMessage: sync.ok ? undefined : sync.message,
    })
  }

  updateOrder(id: string, input: UpdateLabOrderInput) {
    const db = loadDb()
    let changed: LabItem | null = null
    let error = ''
    let previousCaseId: string | undefined

    db.labItems = db.labItems.map((item) => {
      if (item.id !== id) {
        return item
      }

      previousCaseId = item.caseId

      const nextCaseId = input.caseId ?? item.caseId
      const mergedPlan = {
        plannedUpperQty: Math.trunc(input.plannedUpperQty ?? item.plannedUpperQty ?? 0),
        plannedLowerQty: Math.trunc(input.plannedLowerQty ?? item.plannedLowerQty ?? 0),
      }
      const nextProductType = normalizeProductType(input.productType ?? input.productId ?? item.productId ?? item.productType)

      let linkedCase: Case | null = null
      if (nextCaseId) {
        const caseItem = db.cases.find((current) => current.id === nextCaseId)
        if (!caseItem || caseItem.contract?.status !== 'aprovado') {
          error = 'Caso vinculado inválido ou sem contrato aprovado.'
          return item
        }
        linkedCase = caseItem
        const invalidPlan = validatePlanForCase(caseItem, mergedPlan)
        if (invalidPlan) {
          error = invalidPlan
          return item
        }
      }

      const requestedStatus = input.status ?? item.status
      const shouldAutoResolveStatus =
        input.status !== undefined
        || input.plannedUpperQty !== undefined
        || input.plannedLowerQty !== undefined
        || input.productType !== undefined
        || input.productId !== undefined
        || input.arch !== undefined
      const autoStatus = resolveAutomaticLabOrderStage(requestedStatus, {
        plannedUpperQty: mergedPlan.plannedUpperQty,
        plannedLowerQty: mergedPlan.plannedLowerQty,
        productType: nextProductType,
        productId: nextProductType,
      } as LabOrder, linkedCase)
      const nextStatus = item.status === 'aguardando_iniciar' && shouldAutoResolveStatus
        ? autoStatus
        : (requiresLabPlan({
          productType: nextProductType,
          productId: nextProductType,
          plannedUpperQty: mergedPlan.plannedUpperQty,
          plannedLowerQty: mergedPlan.plannedLowerQty,
        } as LabOrder, linkedCase) && !hasProductionPlan(mergedPlan) && requestedStatus === 'em_producao' ? 'aguardando_iniciar' : requestedStatus)

      if (linkedCase && isDeliveredToDentist(linkedCase, input.trayNumber ?? item.trayNumber) && nextStatus !== item.status) {
        error = 'Não é permitido regredir/editar status de placa já entregue ao dentista.'
        return item
      }
      if (!canTransitionLabOrderStage(item.status, nextStatus)) {
        error = 'Transição de status inválida para este item.'
        return item
      }
      const nextArch = normalizeLabArch(input.arch ?? item.arch)
      if (nextStatus === 'em_producao') {
        try {
          assertReadyToStartProduction({
            ...item,
            ...input,
            arch: nextArch,
            productType: nextProductType,
            productId: nextProductType,
            plannedUpperQty: mergedPlan.plannedUpperQty,
            plannedLowerQty: mergedPlan.plannedLowerQty,
          } as LabOrder, linkedCase)
        } catch (cause) {
          error = cause instanceof Error ? cause.message : 'Não foi possível iniciar produção.'
          return item
        }
      }
      const nowIso = nowIsoDateTime()
      if (item.status !== 'em_producao' && nextStatus === 'em_producao') {
        const debit = debitReplacementBankForLabStart(
          {
            ...item,
            ...input,
            productType: nextProductType,
            productId: nextProductType,
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

      changed = enrichLabItemDomainState({
        ...item,
        ...input,
        status: nextStatus,
        arch: nextArch,
        productType: nextProductType,
        productId: normalizeProductType(input.productId ?? input.productType ?? item.productId ?? item.productType),
        plannedUpperQty: mergedPlan.plannedUpperQty,
        plannedLowerQty: mergedPlan.plannedLowerQty,
        planningDefinedAt: hasProductionPlan(mergedPlan) ? item.planningDefinedAt ?? nowIso : undefined,
        dueDate: input.dueDate ? toIsoDate(input.dueDate) : item.dueDate,
        plannedDate: input.plannedDate ? toIsoDate(input.plannedDate) : item.plannedDate,
        updatedAt: nowIso,
      }, nowIso)

      return changed
    })

    if (!changed) {
      return err(error || 'Não foi possível atualizar o item.')
    }

    const updatedOrder = changed as LabItem
    const sync = syncLabItemToCaseTray(updatedOrder, db)
    const seededReplenishment = ensureInitialReplenishmentSeed(db, toLabOrder(updatedOrder))
    refreshCaseDomainState(db, previousCaseId)
    refreshCaseDomainState(db, updatedOrder.caseId)
    pushAudit(db, {
      entity: 'lab',
      entityId: updatedOrder.id,
      action: 'lab.update',
      message: `OS ${updatedOrder.requestCode ?? updatedOrder.id} atualizada para status ${updatedOrder.status}.`,
      context: {
        labOrderId: updatedOrder.id,
        caseId: updatedOrder.caseId,
        previousCaseId,
        status: updatedOrder.status,
        stage: updatedOrder.stage,
      },
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
    return ok({
      order: toLabOrder(updatedOrder),
      syncMessage: sync.ok ? undefined : sync.message,
    })
  }

  moveOrderToStage(input: UpdateLabStageInput) {
    const current = this.findById(input.id)
    if (!current) {
      return err('Item LAB não encontrado.')
    }
    return this.updateOrder(input.id, { status: input.nextStage })
  }

  deleteOrder(id: string) {
    const db = loadDb()
    const removed = db.labItems.find((item) => item.id === id) ?? null
    if (!removed) {
      saveDb(db)
      return ok(null)
    }

    const idsToRemove = new Set<string>([id])
    if (removed.caseId) {
      if ((removed.requestKind ?? 'producao') === 'reconfeccao') {
        db.labItems
          .filter(
            (item) =>
              item.id !== removed.id &&
              item.caseId === removed.caseId &&
              item.trayNumber === removed.trayNumber &&
              isReworkProductionOrder(toLabOrder(item)),
          )
          .forEach((item) => idsToRemove.add(item.id))
      } else if (isReworkProductionOrder(toLabOrder(removed))) {
        db.labItems
          .filter(
            (item) =>
              item.id !== removed.id &&
              item.caseId === removed.caseId &&
              item.trayNumber === removed.trayNumber &&
              (item.requestKind ?? 'producao') === 'reconfeccao',
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
    refreshCaseDomainState(db, removed.caseId)
    saveDb(db)
    return ok(null)
  }

  createAdvanceOrder(input: CreateAdvanceLabOrderInput) {
    const db = loadDb()
    const source = db.labItems.find((item) => item.id === input.sourceLabItemId)
    if (!source) {
      return err('OS de origem não encontrada.')
    }
    if (!source.caseId) {
      return err('OS sem caso vinculado.')
    }
    const linkedCase = db.cases.find((item) => item.id === source.caseId)
    if (!linkedCase) {
      return err('Caso vinculado não encontrado.')
    }
    if (linkedCase.contract?.status !== 'aprovado') {
      return err('Contrato não aprovado para gerar OS antecipada.')
    }

    const plannedUpperQty = Math.max(0, Math.trunc(input.plannedUpperQty))
    const plannedLowerQty = Math.max(0, Math.trunc(input.plannedLowerQty))
    if (plannedUpperQty + plannedLowerQty <= 0) {
      return err('Informe quantidade maior que zero para gerar OS antecipada.')
    }

    const invalidPlan = validatePlanForCase(linkedCase, { plannedUpperQty, plannedLowerQty } as LabOrder)
    if (invalidPlan) {
      return err(invalidPlan)
    }

    const nextTrayNumber = nextPendingTrayNumber(linkedCase)
    if (!nextTrayNumber) {
      return err('Não há placas pendentes para gerar OS antecipada.')
    }

    const nowIso = nowIsoDateTime()
    const today = nowIso.slice(0, 10)
    const baseCode = linkedCase.treatmentCode ?? linkedCase.id
    const dueDate = input.dueDate ?? source.expectedReplacementDate ?? source.dueDate
    const sourceIsRevision = Boolean(
      source.requestCode &&
      new RegExp(`^${baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`).test(source.requestCode),
    )
    const requestCode = (source.requestKind ?? 'producao') === 'reposicao_programada' && sourceIsRevision
      ? (source.requestCode as string)
      : `${baseCode}/${1 + db.labItems.reduce((acc, item) => {
        const match = item.requestCode?.match(new RegExp(`^${baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d+)$`))
        if (!match) return acc
        return Math.max(acc, Number(match[1]))
      }, 0)}`

    if ((source.requestKind ?? 'producao') === 'reposicao_programada') {
      db.labItems = db.labItems.filter((item) => item.id !== source.id)
    }

    const nextItem = enrichLabItemDomainState({
      ...source,
      productType: normalizeProductType(source.productType ?? linkedCase.productType),
      productId: normalizeProductType(source.productId ?? source.productType ?? linkedCase.productId ?? linkedCase.productType),
      id: createEntityId('lab'),
      requestCode,
      requestKind: 'producao',
      expectedReplacementDate: source.expectedReplacementDate ?? source.dueDate,
      trayNumber: nextTrayNumber,
      plannedUpperQty,
      plannedLowerQty,
      planningDefinedAt: nowIso,
      plannedDate: today,
      dueDate,
      status: 'aguardando_iniciar',
      priority: 'Urgente',
      notes: `OS antecipada gerada manualmente a partir de ${source.requestCode ?? source.id}.`,
      createdAt: nowIso,
      updatedAt: nowIso,
    }, nowIso)
    db.labItems = [nextItem, ...db.labItems]
    refreshCaseDomainState(db, nextItem.caseId)
    const sync = syncLabItemToCaseTray(nextItem, db)
    pushAudit(db, {
      entity: 'lab',
      entityId: source.id,
      action: 'lab.advance_source_consumed',
      message: `Base de reposição ${source.requestCode ?? source.id} consumida para antecipacao.`,
    })
    pushAudit(db, {
      entity: 'lab',
      entityId: nextItem.id,
      action: 'lab.advance_created',
      message: `OS antecipada ${nextItem.requestCode ?? nextItem.id} criada para ${nextItem.patientName}.`,
    })
    saveDb(db)
    return ok({
      order: toLabOrder(nextItem),
      syncMessage: sync.ok ? undefined : sync.message,
    })
  }

  registerShipment(input: RegisterShipmentInput): Result<RegisterShipmentOutput, string> {
    const initialDb = loadDb()
    const storedOrder = initialDb.labItems.find((item) => item.id === input.labOrderId)
    if (!storedOrder) {
      return err('Selecione uma OS pronta valida.')
    }

    const deliveredToDoctorAt = toIsoDate(input.deliveredToDoctorAt)
    const updated = this.updateOrder(input.labOrderId, {
      deliveredToProfessionalAt: deliveredToDoctorAt,
      notes: input.note ?? storedOrder.notes,
    })
    if (!updated.ok) return updated

    const updatedOrder = updated.data.order
    if (!updatedOrder.caseId) {
      const auditDb = loadDb()
      pushAudit(auditDb, {
        entity: 'lab',
        entityId: updatedOrder.id,
        action: 'lab.shipment_registered',
        message: 'Entrega LAB registrada.',
        context: {
          labOrderId: updatedOrder.id,
          deliveredToDoctorAt,
          deliveredUpperQty: 0,
          deliveredLowerQty: 0,
          stage: updatedOrder.stage,
        },
      })
      saveDb(auditDb)
      logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
        labOrderId: updatedOrder.id,
        deliveredToDoctorAt,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
        stage: updatedOrder.stage,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
      return ok({
        order: updatedOrder,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
      })
    }

    const currentDb = loadDb()
    const caseItem = currentDb.cases.find((item) => item.id === updatedOrder.caseId)
    if (!caseItem) {
      return err('Pedido não encontrado.')
    }

    const productType = resolveLabOrderProductType(updatedOrder, caseItem)
    const isAligner = isAlignerProductType(productType)
    const isRework = (updatedOrder.requestKind ?? 'producao') === 'reconfeccao' || isReworkProductionOrder(updatedOrder)

    if (!isRework && !isAligner) {
      const db = loadDb()
      db.cases = db.cases.map((entry) =>
        entry.id === caseItem.id
          ? { ...entry, status: 'em_entrega', phase: 'em_producao', updatedAt: nowIsoDateTime() }
          : entry,
      )
      refreshCaseDomainState(db, caseItem.id)
      pushAudit(db, {
        entity: 'lab',
        entityId: updatedOrder.id,
        action: 'lab.shipment_registered',
        message: 'Entrega LAB registrada.',
        context: {
          labOrderId: updatedOrder.id,
          caseId: caseItem.id,
          deliveredToDoctorAt,
          deliveredUpperQty: 0,
          deliveredLowerQty: 0,
          stage: updatedOrder.stage,
        },
      })
      pushAudit(db, {
        entity: 'case',
        entityId: caseItem.id,
        action: 'case.delivery_registered',
        message: 'Entrega ao profissional registrada.',
        context: {
          caseId: caseItem.id,
          labOrderId: updatedOrder.id,
          deliveredToDoctorAt,
          deliveredUpperQty: 0,
          deliveredLowerQty: 0,
          lifecycleStatus: db.cases.find((entry) => entry.id === caseItem.id)?.lifecycleStatus,
        },
      })
      saveDb(db)
      logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
        labOrderId: updatedOrder.id,
        caseId: caseItem.id,
        deliveredToDoctorAt,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
        stage: updatedOrder.stage,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
      return ok({
        order: this.findById(updatedOrder.id) ?? updatedOrder,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
      })
    }

    const upperQty = Math.max(0, Math.trunc(input.upperQty))
    const lowerQty = Math.max(0, Math.trunc(input.lowerQty))
    const ops: Array<{ arch: 'superior' | 'inferior'; fromTray: number; toTray: number }> = []
    if (isRework) {
      if (updatedOrder.arch === 'superior' || updatedOrder.arch === 'ambos') {
        ops.push({ arch: 'superior', fromTray: updatedOrder.trayNumber, toTray: updatedOrder.trayNumber })
      }
      if (updatedOrder.arch === 'inferior' || updatedOrder.arch === 'ambos') {
        ops.push({ arch: 'inferior', fromTray: updatedOrder.trayNumber, toTray: updatedOrder.trayNumber })
      }
    } else {
      if (upperQty > 0) {
        ops.push({ arch: 'superior', ...nextRangeByArch(caseItem, 'superior', updatedOrder.trayNumber, upperQty) })
      }
      if (lowerQty > 0) {
        ops.push({ arch: 'inferior', ...nextRangeByArch(caseItem, 'inferior', updatedOrder.trayNumber, lowerQty) })
      }
    }

    if (!ops.length) {
      return err('Nenhum lote valido para registrar.')
    }

    const latestDb = loadDb()
    const targetCase = latestDb.cases.find((item) => item.id === caseItem.id)
    if (!targetCase) return err('Pedido não encontrado.')
    const upperTotal = targetCase.totalTraysUpper ?? targetCase.totalTrays
    const lowerTotal = targetCase.totalTraysLower ?? targetCase.totalTrays

    for (const op of ops) {
      if (op.arch === 'superior' && op.toTray > upperTotal) {
        return err(`Quantidade superior excede o total da arcada superior (${upperTotal}).`)
      }
      if (op.arch === 'inferior' && op.toTray > lowerTotal) {
        return err(`Quantidade inferior excede o total da arcada inferior (${lowerTotal}).`)
      }
    }

    for (const op of ops) {
      const refreshedDb = loadDb()
      const refreshedCase = refreshedDb.cases.find((item) => item.id === caseItem.id)
      if (!refreshedCase) return err('Pedido não encontrado.')
      const nextTrays = refreshedCase.trays.map((tray) =>
        tray.trayNumber >= op.fromTray && tray.trayNumber <= op.toTray
          ? { ...tray, state: 'entregue' as const, deliveredAt: deliveredToDoctorAt }
          : tray,
      )
      refreshedDb.cases = refreshedDb.cases.map((entry) =>
        entry.id === refreshedCase.id
          ? {
              ...entry,
              trays: nextTrays,
              deliveryLots: [
                ...(entry.deliveryLots ?? []),
                {
                  id: createEntityId('lot'),
                  arch: op.arch,
                  fromTray: op.fromTray,
                  toTray: op.toTray,
                  quantity: op.toTray - op.fromTray + 1,
                  deliveredToDoctorAt,
                  note: input.note?.trim() || undefined,
                  createdAt: nowIsoDateTime(),
                },
              ],
              status: 'em_entrega',
              phase: 'em_producao',
              updatedAt: nowIsoDateTime(),
            }
          : entry,
      )
      markReplacementBankDeliveredByLot({ id: refreshedCase.id }, {
        arch: op.arch,
        fromTray: op.fromTray,
        toTray: op.toTray,
        deliveredToDoctorAt,
      }, refreshedDb)
      saveDb(refreshedDb)
    }

    const deliveredUpperQty = ops.filter((op) => op.arch === 'superior').reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
    const deliveredLowerQty = ops.filter((op) => op.arch === 'inferior').reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
    const auditDb = loadDb()
    refreshCaseDomainState(auditDb, caseItem.id)
    pushAudit(auditDb, {
      entity: 'lab',
      entityId: updatedOrder.id,
      action: 'lab.shipment_registered',
      message: 'Entrega LAB registrada.',
      context: {
        labOrderId: updatedOrder.id,
        caseId: caseItem.id,
        deliveredToDoctorAt,
        deliveredUpperQty,
        deliveredLowerQty,
        stage: updatedOrder.stage,
      },
    })
    pushAudit(auditDb, {
      entity: 'case',
      entityId: caseItem.id,
      action: 'case.delivery_registered',
      message: 'Entrega ao profissional registrada.',
      context: {
        caseId: caseItem.id,
        labOrderId: updatedOrder.id,
        deliveredToDoctorAt,
        deliveredUpperQty,
        deliveredLowerQty,
        lifecycleStatus: auditDb.cases.find((entry) => entry.id === caseItem.id)?.lifecycleStatus,
      },
    })
    saveDb(auditDb)
    logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
      labOrderId: updatedOrder.id,
      caseId: caseItem.id,
      deliveredToDoctorAt,
      deliveredUpperQty,
      deliveredLowerQty,
      stage: updatedOrder.stage,
    }, this.currentUser ? {
      id: this.currentUser.id,
      role: this.currentUser.role,
    } : undefined)

    return ok({
      order: this.findById(updatedOrder.id) ?? updatedOrder,
      deliveredUpperQty,
      deliveredLowerQty,
    })
  }

  registerRework(input: RegisterReworkInput): Result<RegisterReworkOutput, string> {
    const db = loadDb()
    const targetCase = db.cases.find((item) => item.id === input.caseId)
    if (!targetCase) {
      return err('Caso não encontrado.')
    }
    const tray = targetCase.trays.find((item) => item.trayNumber === input.trayNumber)
    if (!tray) {
      return err('Placa não encontrada no caso.')
    }

    targetCase.trays = targetCase.trays.map((item) =>
      item.trayNumber === input.trayNumber
        ? { ...item, state: 'rework', notes: input.reason.trim() || item.notes }
        : item,
    )
    targetCase.deliveryLots = removeTrayFromDeliveryLots(targetCase.deliveryLots ?? [], input.trayNumber, input.arch)
    targetCase.installation = adjustInstallationForRework(targetCase.installation, input.trayNumber, input.arch)
    targetCase.updatedAt = nowIsoDateTime()
    refreshCaseDomainState(db, targetCase.id)
    saveDb(db)
    handleReplacementRework(input.caseId, input.trayNumber, input.arch)

    const latestDb = loadDb()
    const linkedLabItems = latestDb.labItems.filter((item) => item.caseId === input.caseId)
    const hasOpenRework = linkedLabItems.some(
      (item) =>
        item.trayNumber === input.trayNumber &&
        (item.requestKind ?? 'producao') === 'reconfeccao' &&
        item.status !== 'prontas',
    )
    const hasOpenReworkProduction = linkedLabItems.some(
      (item) =>
        item.trayNumber === input.trayNumber &&
        isReworkProductionOrder(item) &&
        item.status !== 'prontas',
    )

    const today = nowIsoDate()
    const dueDate = tray.dueDate ?? buildStandaloneLabDueDate(today)
    const financialImpact = ReworkFinancialImpactService.estimate({
      arch: normalizeLabArch(input.arch),
      trayCount: 1,
      productType: targetCase.productId ?? targetCase.productType,
      reason: input.reason,
    })
    let createdReworkOrder: LabOrder | undefined
    let createdProductionOrder: LabOrder | undefined

    if (!hasOpenRework) {
      const created = this.createOrder({
        caseId: input.caseId,
        productType: targetCase.productType ?? 'alinhador_12m',
        productId: targetCase.productId ?? targetCase.productType ?? 'alinhador_12m',
        requestKind: 'reconfeccao',
        arch: normalizeLabArch(input.arch),
        plannedUpperQty: 0,
        plannedLowerQty: 0,
        patientName: targetCase.patientName,
        trayNumber: input.trayNumber,
        plannedDate: today,
        dueDate,
        status: 'aguardando_iniciar',
        priority: 'Urgente',
        notes: input.reason.trim(),
        reworkOfCaseId: input.caseId,
        reworkOfTrayNumber: input.trayNumber,
        financialImpact,
      })
      if (!created.ok) return created
      createdReworkOrder = created.data.order
    }

    if (!hasOpenReworkProduction) {
      const created = this.createOrder({
        caseId: input.caseId,
        productType: targetCase.productType ?? 'alinhador_12m',
        productId: targetCase.productId ?? targetCase.productType ?? 'alinhador_12m',
        requestKind: 'producao',
        arch: normalizeLabArch(input.arch),
        plannedUpperQty: 0,
        plannedLowerQty: 0,
        patientName: targetCase.patientName,
        trayNumber: input.trayNumber,
        plannedDate: today,
        dueDate,
        status: 'aguardando_iniciar',
        priority: 'Urgente',
        notes: buildLabOrderNotesWithReason('OS de produção para reconfecção', input.trayNumber, input.reason),
        reworkOfCaseId: input.caseId,
        reworkOfTrayNumber: input.trayNumber,
      })
      if (!created.ok) return created
      createdProductionOrder = created.data.order
    }

    const finalDb = loadDb()
    pushAudit(finalDb, {
      entity: 'case',
      entityId: input.caseId,
      action: 'case.rework_registered',
      message: 'Reconfecção registrada.',
      context: {
        caseId: input.caseId,
        trayNumber: input.trayNumber,
        arch: input.arch,
        reworkOrderId: createdReworkOrder?.id,
        productionOrderId: createdProductionOrder?.id,
        estimatedFinancialImpact: financialImpact.estimatedAmount,
      },
    })
    refreshCaseDomainState(finalDb, input.caseId)
    saveDb(finalDb)
    logger.business(BUSINESS_EVENTS.LAB_REWORK_REGISTERED, 'Reconfecção registrada.', {
      caseId: input.caseId,
      trayNumber: input.trayNumber,
      arch: input.arch,
      reworkOrderId: createdReworkOrder?.id,
      productionOrderId: createdProductionOrder?.id,
      estimatedFinancialImpact: financialImpact.estimatedAmount,
    }, this.currentUser ? {
      id: this.currentUser.id,
      role: this.currentUser.role,
    } : undefined)

    return ok({
      caseId: input.caseId,
      trayNumber: input.trayNumber,
      createdReworkOrder,
      createdProductionOrder,
      financialImpact,
    })
  }
}

export function createLocalLabRepository(currentUser: User | null) {
  return new LocalLabRepository(currentUser)
}
