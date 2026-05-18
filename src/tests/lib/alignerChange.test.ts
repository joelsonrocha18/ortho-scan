import { describe, expect, it } from 'vitest'
import { buildAlignerWhatsappMessage, buildArchScheduleDates, buildChangeSchedule, getCaseAlignerChangeSummary, recalculateTrayDueDates } from '../../lib/alignerChange'
import type { Case } from '../../types/Case'

function makeCase(overrides?: Partial<Case>): Case {
  return {
    id: 'case_test',
    patientName: 'Maria Silva',
    scanDate: '2026-03-01',
    totalTrays: 4,
    totalTraysUpper: 4,
    totalTraysLower: 4,
    changeEveryDays: 7,
    status: 'em_tratamento',
    phase: 'em_producao',
    trays: [
      { trayNumber: 1, state: 'entregue' },
      { trayNumber: 2, state: 'entregue' },
      { trayNumber: 3, state: 'entregue' },
      { trayNumber: 4, state: 'entregue' },
    ],
    attachments: [],
    arch: 'ambos',
    installation: {
      installedAt: '2026-03-01',
      deliveredUpper: 4,
      deliveredLower: 4,
      actualChangeDates: [],
    },
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('alignerChange helpers', () => {
  it('shifts future schedule dates when an actual change date is informed', () => {
    const schedule = buildArchScheduleDates(
      '2026-03-01',
      7,
      3,
      new Map([[2, '2026-03-10']]),
    )

    expect(schedule[1]).toBe('2026-03-01')
    expect(schedule[2]).toBe('2026-03-10')
    expect(schedule[3]).toBe('2026-03-17')
  })

  it('returns the next due arch based on delivered trays and actual change dates', () => {
    const summary = getCaseAlignerChangeSummary(
      makeCase({
        installation: {
          installedAt: '2026-03-01',
          deliveredUpper: 4,
          deliveredLower: 4,
          actualChangeDates: [{ trayNumber: 2, changedAt: '2026-03-10', arch: 'inferior' }],
        },
      }),
      '2026-03-15',
    )

    expect(summary.current.upper).toBe(3)
    expect(summary.current.lower).toBe(2)
    expect(summary.next.upper).toEqual({ trayNumber: 4, changeDate: '2026-03-22' })
    expect(summary.next.lower).toEqual({ trayNumber: 3, changeDate: '2026-03-17' })
    expect(summary.nextDueDate).toBe('2026-03-17')
    expect(summary.daysUntilDue).toBe(2)
    expect(summary.status).toBe('upcoming')
    expect(summary.messageTarget).toEqual({ upper: undefined, lower: 3 })
  })

  it('respects manually adjusted tray due dates when building the schedule', () => {
    const schedule = buildChangeSchedule({
      installedAt: '2026-03-01',
      changeEveryDays: 7,
      totalUpper: 3,
      totalLower: 0,
      deliveredUpper: 0,
      deliveredLower: 0,
      trays: [
        { trayNumber: 1, state: 'pendente', dueDate: '2026-03-01' },
        { trayNumber: 2, state: 'pendente', dueDate: '2026-03-12' },
        { trayNumber: 3, state: 'pendente' },
      ],
      actualUpperByTray: new Map(),
      actualLowerByTray: new Map(),
    })

    expect(schedule.map((row) => row.upperPlannedDate)).toEqual([
      '2026-03-01',
      '2026-03-12',
      '2026-03-19',
    ])
  })

  it('ignores stale stored due dates after a previous real change date', () => {
    const schedule = buildChangeSchedule({
      installedAt: '2025-09-03',
      changeEveryDays: 10,
      totalUpper: 10,
      totalLower: 0,
      deliveredUpper: 10,
      deliveredLower: 0,
      trays: [
        { trayNumber: 8, state: 'entregue', dueDate: '2025-11-12' },
        { trayNumber: 9, state: 'entregue', dueDate: '2025-11-22' },
        { trayNumber: 10, state: 'entregue', dueDate: '2025-12-02' },
      ],
      actualUpperByTray: new Map([[8, '2026-04-06']]),
      actualLowerByTray: new Map(),
    })

    expect(schedule.find((row) => row.trayNumber === 9)?.upperPlannedDate).toBe('2026-04-16')
    expect(schedule.find((row) => row.trayNumber === 10)?.upperPlannedDate).toBe('2026-04-26')
  })

  it('recalculates future tray due dates using the latest actual change as the next anchor', () => {
    const trays = recalculateTrayDueDates({
      trays: [
        { trayNumber: 1, state: 'entregue', dueDate: '2026-03-01' },
        { trayNumber: 2, state: 'entregue', dueDate: '2026-03-17' },
        { trayNumber: 3, state: 'entregue', dueDate: '2026-03-27' },
        { trayNumber: 4, state: 'pendente', dueDate: '2026-04-06' },
        { trayNumber: 5, state: 'pendente', dueDate: '2026-04-16' },
      ],
      changeEveryDays: 10,
      installedAt: '2026-03-01',
      actualUpperByTray: new Map([
        [2, '2026-03-21'],
        [3, '2026-04-05'],
      ]),
      actualLowerByTray: new Map([
        [2, '2026-03-21'],
        [3, '2026-04-05'],
      ]),
      startTrayNumber: 2,
      overrideDueDates: new Map([[2, '2026-03-17']]),
    })

    expect(trays.find((tray) => tray.trayNumber === 3)?.dueDate).toBe('2026-03-31')
    expect(trays.find((tray) => tray.trayNumber === 4)?.dueDate).toBe('2026-04-15')
    expect(trays.find((tray) => tray.trayNumber === 5)?.dueDate).toBe('2026-04-25')
  })

  it('recalculates stored due dates from the previous tray real change date', () => {
    const trays = recalculateTrayDueDates({
      trays: [
        { trayNumber: 8, state: 'entregue', dueDate: '2025-11-12' },
        { trayNumber: 9, state: 'entregue', dueDate: '2025-11-22' },
        { trayNumber: 10, state: 'entregue', dueDate: '2025-12-02' },
      ],
      changeEveryDays: 10,
      installedAt: '2025-09-03',
      actualUpperByTray: new Map([[8, '2026-04-06']]),
      actualLowerByTray: new Map(),
      startTrayNumber: 9,
    })

    expect(trays.find((tray) => tray.trayNumber === 8)?.dueDate).toBe('2025-11-12')
    expect(trays.find((tray) => tray.trayNumber === 9)?.dueDate).toBe('2026-04-16')
    expect(trays.find((tray) => tray.trayNumber === 10)?.dueDate).toBe('2026-04-26')
  })

  it('uses the edited main card date as the shared planned date for both arches and cascades forward', () => {
    const trays = recalculateTrayDueDates({
      trays: [
        { trayNumber: 1, state: 'entregue', dueDate: '2026-01-22' },
        { trayNumber: 2, state: 'entregue', dueDate: '2026-02-01' },
        { trayNumber: 3, state: 'pendente', dueDate: '2026-02-11' },
        { trayNumber: 4, state: 'pendente', dueDate: '2026-02-21' },
      ],
      changeEveryDays: 10,
      installedAt: '2026-01-22',
      actualUpperByTray: new Map(),
      actualLowerByTray: new Map(),
      startTrayNumber: 3,
      overrideDueDates: new Map([[3, '2026-04-09']]),
    })

    const schedule = buildChangeSchedule({
      installedAt: '2026-01-22',
      changeEveryDays: 10,
      totalUpper: 4,
      totalLower: 4,
      deliveredUpper: 2,
      deliveredLower: 2,
      trays,
      actualUpperByTray: new Map(),
      actualLowerByTray: new Map(),
    })

    expect(schedule.find((row) => row.trayNumber === 3)?.upperPlannedDate).toBe('2026-04-09')
    expect(schedule.find((row) => row.trayNumber === 3)?.lowerPlannedDate).toBe('2026-04-09')
    expect(schedule.find((row) => row.trayNumber === 4)?.upperPlannedDate).toBe('2026-04-19')
    expect(schedule.find((row) => row.trayNumber === 4)?.lowerPlannedDate).toBe('2026-04-19')
  })

  it('builds a whatsapp reminder that mentions the correct arch and date', () => {
    const message = buildAlignerWhatsappMessage(
      'Maria Silva',
      { upper: 6, lower: 5 },
      '2026-03-20',
      '2026-03-15',
    )

    expect(message).toContain('Maria Silva')
    expect(message).toContain('alinhador superior numero 6 e inferior numero 5')
    expect(message).toContain('20/03/2026')
  })
})
