import { beforeEach, describe, expect, it } from 'vitest'
import { loadDb, saveDb } from '../../../data/db'
import { createLocalLabRepository } from '../../../modules/lab'
import { RegisterLabOrderUseCase, RegisterReworkUseCase, RegisterShipmentUseCase, UpdateLabStageUseCase } from '../../../modules/lab/application/useCases'
import { CaseLifecycleService } from '../../../modules/cases'
import { LabSLAService } from '../../../modules/lab/domain/services/LabSLAService'
import { ProductionQueueService } from '../../../modules/lab/domain/services/ProductionQueueService'
import { ReworkFinancialImpactService } from '../../../modules/lab/domain/services/ReworkFinancialImpactService'
import { toLabOrder, type LabOrder } from '../../../modules/lab'
import { clearQaSeed, seedQaData } from '../../seed'

describe('LAB module', () => {
  beforeEach(() => {
    clearQaSeed()
    seedQaData()
  })

  it('registers LAB order with auto production when aligner plan is defined', async () => {
    const repo = createLocalLabRepository(null)
    const useCase = new RegisterLabOrderUseCase(repo)

    const result = await Promise.resolve(useCase.execute({
      caseId: 'qa_case_1',
      productType: 'alinhador_12m',
      productId: 'alinhador_12m',
      arch: 'ambos',
      plannedUpperQty: 2,
      plannedLowerQty: 2,
      patientName: 'Paciente 1',
      trayNumber: 3,
      plannedDate: '2026-03-01',
      dueDate: '2026-03-10',
      status: 'aguardando_iniciar',
      priority: 'Urgente',
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.order.status).toBe('em_producao')
    expect(result.data.order.stage).toBe('in_production')
    expect(result.data.order.requestKind).toBe('producao')
    expect(result.data.order.domainEvents?.some((event) => event.name === 'LabStarted')).toBe(true)
  })

  it('registers shipment and writes case delivery lots', async () => {
    const db = loadDb()
    db.labItems = db.labItems.map((item) =>
      item.id === 'qa_lab_1'
        ? {
            ...item,
            status: 'prontas',
            arch: 'superior',
            plannedUpperQty: 2,
            plannedLowerQty: 0,
          }
        : item,
    )
    saveDb(db)

    const repo = createLocalLabRepository(null)
    const useCase = new RegisterShipmentUseCase(repo)
    const result = await Promise.resolve(useCase.execute({
      labOrderId: 'qa_lab_1',
      deliveredToDoctorAt: '2026-03-20',
      upperQty: 2,
      lowerQty: 0,
      note: 'Entrega parcial superior',
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.deliveredUpperQty).toBe(2)

    const nextDb = loadDb()
    const caseItem = nextDb.cases.find((item) => item.id === 'qa_case_1')
    expect(caseItem?.deliveryLots?.length).toBe(1)
    expect(caseItem?.deliveryLots?.[0]?.fromTray).toBe(1)
    expect(caseItem?.deliveryLots?.[0]?.toTray).toBe(2)
    expect(caseItem?.trays.find((tray) => tray.trayNumber === 1)?.state).toBe('entregue')
    expect(caseItem?.trays.find((tray) => tray.trayNumber === 2)?.state).toBe('entregue')
    const shipmentAudit = nextDb.auditLogs.find((entry) => entry.action === 'lab.shipment_registered' && entry.entityId === 'qa_lab_1')
    const deliveryAudit = nextDb.auditLogs.find((entry) => entry.action === 'case.delivery_registered' && entry.entityId === 'qa_case_1')
    expect(shipmentAudit?.context?.deliveredUpperQty).toBe(2)
    expect(deliveryAudit?.context?.caseId).toBe('qa_case_1')
  })

  it('registers rework and adjusts delivered case state', async () => {
    const db = loadDb()
    db.cases = db.cases.map((item) =>
      item.id === 'qa_case_1'
        ? {
            ...item,
            deliveryLots: [
              {
                id: 'lot_test',
                arch: 'ambos',
                fromTray: 1,
                toTray: 3,
                quantity: 3,
                deliveredToDoctorAt: '2026-03-10',
                createdAt: '2026-03-10T10:00:00.000Z',
              },
            ],
            installation: {
              installedAt: '2026-03-12',
              deliveredUpper: 3,
              deliveredLower: 3,
            },
          }
        : item,
    )
    saveDb(db)

    const repo = createLocalLabRepository(null)
    const useCase = new RegisterReworkUseCase(repo)
    const result = await Promise.resolve(useCase.execute({
      caseId: 'qa_case_1',
      trayNumber: 2,
      arch: 'ambos',
      reason: 'Ajuste de margem',
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.createdReworkOrder).toBeTruthy()
    expect(result.data.createdProductionOrder).toBeTruthy()
    expect(result.data.financialImpact?.currency).toBe('BRL')
    expect(result.data.financialImpact?.estimatedAmount).toBeGreaterThan(0)

    const nextDb = loadDb()
    const caseItem = nextDb.cases.find((item) => item.id === 'qa_case_1')
    expect(caseItem?.trays.find((tray) => tray.trayNumber === 2)?.state).toBe('rework')
    const enrichedCase = caseItem
      ? CaseLifecycleService.refreshCase(caseItem, nextDb.labItems.filter((item) => item.caseId === 'qa_case_1').map(toLabOrder))
      : null
    expect(enrichedCase?.reworkSummary?.reworkCount).toBeGreaterThan(0)
    expect(caseItem?.installation?.deliveredUpper).toBe(2)
    expect(caseItem?.installation?.deliveredLower).toBe(2)
    expect(caseItem?.deliveryLots?.length).toBe(2)
    expect(nextDb.labItems.some((item) => item.caseId === 'qa_case_1' && item.trayNumber === 2 && item.requestKind === 'reconfeccao')).toBe(true)
    expect(nextDb.labItems.some((item) => item.caseId === 'qa_case_1' && item.trayNumber === 2 && item.requestKind === 'producao' && item.reworkOfCaseId === 'qa_case_1')).toBe(true)
    const reworkAudit = nextDb.auditLogs.find((entry) => entry.action === 'case.rework_registered' && entry.entityId === 'qa_case_1')
    expect(reworkAudit?.context?.trayNumber).toBe(2)
    expect(reworkAudit?.context?.reworkOrderId).toBeTruthy()
  })

  it('builds pipeline without explicit rework and programmed replenishment waiting', () => {
    const items: LabOrder[] = [
      { id: '1', patientName: 'A', trayNumber: 1, dueDate: '2026-03-10', status: 'em_producao', priority: 'Medio', plannedDate: '2026-03-01', arch: 'ambos', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z', requestKind: 'producao' },
      { id: '2', patientName: 'B', trayNumber: 2, dueDate: '2026-03-10', status: 'aguardando_iniciar', priority: 'Medio', plannedDate: '2026-03-01', arch: 'ambos', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z', requestKind: 'reposicao_programada' },
      { id: '3', patientName: 'C', trayNumber: 3, dueDate: '2026-03-10', status: 'controle_qualidade', priority: 'Medio', plannedDate: '2026-03-01', arch: 'ambos', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z', requestKind: 'reconfeccao' },
    ]

    const result = ProductionQueueService.getPipelineOrders(items, new Map())
    expect(result.map((item) => item.id)).toEqual(['3', '1'])
  })

  it('lists pronta rework orders for delivery registration', () => {
    const items: LabOrder[] = [
      {
        id: 'lab_ready_rework',
        caseId: 'qa_case_1',
        patientName: 'Paciente Rework',
        trayNumber: 2,
        dueDate: '2026-03-20',
        status: 'prontas',
        priority: 'Medio',
        plannedDate: '2026-03-15',
        arch: 'ambos',
        createdAt: '2026-03-15T00:00:00.000Z',
        updatedAt: '2026-03-15T00:00:00.000Z',
        requestKind: 'reconfeccao',
      },
    ]

    const result = ProductionQueueService.getReadyDeliveryOrders(items, new Map())
    expect(result.map((item) => item.id)).toEqual(['lab_ready_rework'])
  })

  it('evaluates SLA and prioritizes delayed work in the production queue', () => {
    const overdueOrder: LabOrder = {
      id: 'lab_overdue_1',
      patientName: 'Paciente SLA',
      trayNumber: 4,
      dueDate: '2026-03-05',
      status: 'em_producao',
      priority: 'Urgente',
      plannedDate: '2026-03-01',
      arch: 'ambos',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      requestKind: 'producao',
      planningDefinedAt: '2026-03-01T00:00:00.000Z',
      stageTimeline: [{ stage: 'in_production', at: '2026-03-01T00:00:00.000Z' }],
    }

    const sla = LabSLAService.evaluate(overdueOrder, '2026-03-10T12:00:00.000Z')
    expect(sla.status).toBe('overdue')
    expect(sla.alerts.length).toBeGreaterThan(0)

    const queue = ProductionQueueService.buildQueue([overdueOrder], new Map(), '2026-03-10')
    expect(queue[0]?.id).toBe('lab_overdue_1')
    expect(queue[0]?.sla?.status).toBe('overdue')
  })

  it('estimates financial impact for orthodontic rework', () => {
    const impact = ReworkFinancialImpactService.estimate({
      arch: 'ambos',
      trayCount: 2,
      productType: 'alinhador_12m',
      reason: 'Recorte fora do padrão',
    })

    expect(impact.currency).toBe('BRL')
    expect(impact.estimatedAmount).toBeGreaterThan(0)
    expect(impact.reason).toContain('Recorte')
  })

  it('blocks lab mutation without permission when actor is provided', async () => {
    const repo = createLocalLabRepository(null)
    const receptionist = {
      id: 'qa_receptionist',
      name: 'Recepcao',
      email: 'recepcao@qa.local',
      role: 'receptionist',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    } as const
    const useCase = new RegisterReworkUseCase(repo, receptionist)

    const result = await Promise.resolve(useCase.execute({
      caseId: 'qa_case_1',
      trayNumber: 2,
      arch: 'ambos',
      reason: 'Ajuste autorizado',
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Sem permissao')
  })

  it('allows advancing lab stage without production checklist gate', async () => {
    const db = loadDb()
    db.labItems = db.labItems.map((item) =>
      item.id === 'qa_lab_1'
        ? {
            ...item,
            arch: 'ambos',
            plannedUpperQty: 2,
            plannedLowerQty: 2,
            status: 'aguardando_iniciar',
          }
        : item,
    )
    saveDb(db)

    const repo = createLocalLabRepository(null)
    const updateStage = new UpdateLabStageUseCase(repo)

    const advanced = await Promise.resolve(updateStage.execute({
      id: 'qa_lab_1',
      nextStage: 'em_producao',
    }))
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.data.order.status).toBe('em_producao')
  })
})
