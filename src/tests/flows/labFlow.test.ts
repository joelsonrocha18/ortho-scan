import { beforeEach, describe, expect, it } from 'vitest'
import { addLabItem, canMoveToStatus, createAdvanceLabOrder, generateLabOrder, listLabItems, moveLabItem, nextStatus } from '../../data/labRepo'
import { getCase } from '../../data/caseRepo'
import { loadDb, saveDb } from '../../data/db'
import { clearQaSeed, seedQaData } from '../seed'

describe('LAB flow and commercial gate', () => {
  beforeEach(() => {
    clearQaSeed()
    seedQaData()
  })

  it('allows LAB OS only when contract is approved', () => {
    const denied = generateLabOrder('qa_case_2')
    expect(denied.ok).toBe(false)

    const allowed = generateLabOrder('qa_case_1')
    expect(allowed.ok).toBe(true)

    const invalidDirect = addLabItem({
      caseId: 'qa_case_2',
      arch: 'superior',
      trayNumber: 1,
      patientName: 'Paciente 4',
      plannedDate: '2026-02-01',
      dueDate: '2026-02-10',
      status: 'aguardando_iniciar',
      priority: 'Medio',
    })
    expect(invalidDirect.ok).toBe(false)
  })

  it('supports only adjacent LAB board transitions', () => {
    expect(canMoveToStatus('aguardando_iniciar', 'em_producao')).toBe(true)
    expect(canMoveToStatus('aguardando_iniciar', 'controle_qualidade')).toBe(false)
    expect(nextStatus('controle_qualidade')).toBe('prontas')

    const moved = moveLabItem('qa_lab_1', 'controle_qualidade')
    expect(moved.item?.status).toBe('controle_qualidade')

    const invalidJump = moveLabItem('qa_lab_1', 'aguardando_iniciar')
    expect(invalidJump.item?.status).toBe('controle_qualidade')
  })

  it('syncs LAB movement with case tray state', () => {
    const moved = moveLabItem('qa_lab_1', 'controle_qualidade')
    expect(moved.item?.status).toBe('controle_qualidade')

    const caseItem = getCase('qa_case_1')
    const tray = caseItem?.trays.find((t) => t.trayNumber === 1)
    expect(tray?.state).toBe('rework')
  })

  it('creates replenishment bank item for partial delivery cases', () => {
    const db = loadDb()
    db.cases = db.cases.map((item) => {
      if (item.id !== 'qa_case_1') return item
      return {
        ...item,
        contract: { status: 'aprovado', approvedAt: new Date().toISOString() },
        trays: item.trays.map((tray) => {
          if (tray.trayNumber === 1) return { ...tray, state: 'entregue' as const }
          if (tray.trayNumber === 2) return { ...tray, state: 'pendente' as const, dueDate: new Date().toISOString().slice(0, 10) }
          return tray
        }),
      }
    })
    saveDb(db)

    const items = listLabItems()
    const bankItem = items.find((item) => item.caseId === 'qa_case_1' && item.requestKind === 'reposicao_programada')

    expect(bankItem).toBeTruthy()
    expect(bankItem?.status).toBe('aguardando_iniciar')
    expect(bankItem?.requestCode).toMatch(/^ORTH-\d{5}\/\d+$/)
  })

  it('creates advance OS using the first pending tray number', () => {
    const db = loadDb()
    db.cases = db.cases.map((item) => {
      if (item.id !== 'qa_case_1') return item
      return {
        ...item,
        trays: item.trays.map((tray) => {
          if (tray.trayNumber === 1) return { ...tray, state: 'entregue' as const }
          if (tray.trayNumber === 2) return { ...tray, state: 'pendente' as const }
          return tray
        }),
      }
    })
    saveDb(db)

    const result = createAdvanceLabOrder('qa_lab_1', { plannedUpperQty: 5, plannedLowerQty: 10 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.trayNumber).toBe(2)
  })
})
