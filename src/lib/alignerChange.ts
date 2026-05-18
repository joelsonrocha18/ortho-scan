import { addDaysToIsoDate, diffIsoDays, formatPtBrDate, nowIsoDate, pickMaxIsoDate, pickMinIsoDate } from '../shared/utils/date'
import type { Case, CaseInstallation, CaseTray, TrayState } from '../types/Case'
import { buildWhatsappUrl, isValidWhatsapp } from './whatsapp'

export type AlignerArch = 'superior' | 'inferior'

export type ChangeScheduleRow = {
  trayNumber: number
  upperPlannedDate?: string
  lowerPlannedDate?: string
  upperChangeDate?: string
  lowerChangeDate?: string
  changeDate: string
  superiorState: TrayState | 'nao_aplica'
  inferiorState: TrayState | 'nao_aplica'
}

export type CaseAlignerChangeSummary = {
  totals: { upper: number; lower: number }
  deliveredToPatient: { upper: number; lower: number }
  current: { upper: number; lower: number }
  next: {
    upper?: { trayNumber: number; changeDate: string }
    lower?: { trayNumber: number; changeDate: string }
  }
  nextDueDate?: string
  lastChangeDate?: string
  daysUntilDue?: number
  status: 'not_started' | 'awaiting_delivery' | 'today' | 'overdue' | 'upcoming' | 'later' | 'complete'
  messageTarget: { upper?: number; lower?: number }
}

function countCurrentTrayFromSchedule(
  scheduleDates: Array<string | undefined>,
  deliveredToPatient: number,
  todayIso: string,
) {
  let currentTray = 0
  for (let trayNumber = 1; trayNumber <= deliveredToPatient; trayNumber += 1) {
    const scheduledDate = scheduleDates[trayNumber]
    if (!scheduledDate || scheduledDate > todayIso) break
    currentTray = trayNumber
  }
  return currentTray
}

export function addDaysIso(baseIsoDate: string, days: number) {
  return addDaysToIsoDate(baseIsoDate, days)
}

export function resolveAlignerArchTotals(source: {
  arch?: Case['arch']
  totalTrays?: number
  totalTraysUpper?: number
  totalTraysLower?: number
}) {
  const totalUpper =
    source.arch === 'inferior'
      ? 0
      : typeof source.totalTraysUpper === 'number'
        ? source.totalTraysUpper
        : (source.totalTrays ?? 0)
  const totalLower =
    source.arch === 'superior'
      ? 0
      : typeof source.totalTraysLower === 'number'
        ? source.totalTraysLower
        : (source.totalTrays ?? 0)

  return {
    upper: Math.max(0, Math.trunc(totalUpper)),
    lower: Math.max(0, Math.trunc(totalLower)),
  }
}

export function resolveDeliveredToPatient(caseItem: Pick<Case, 'installation'>, totals: { upper: number; lower: number }) {
  return {
    upper: Math.min(totals.upper, Math.max(0, Math.trunc(caseItem.installation?.deliveredUpper ?? 0))),
    lower: Math.min(totals.lower, Math.max(0, Math.trunc(caseItem.installation?.deliveredLower ?? 0))),
  }
}

export function buildActualChangeDateMap(
  installation: CaseInstallation | undefined,
  arch: AlignerArch,
) {
  const map = new Map<number, string>()
  ;(installation?.actualChangeDates ?? []).forEach((entry) => {
    if (!entry?.trayNumber || !entry?.changedAt) return
    if (entry.arch && entry.arch !== arch && entry.arch !== 'ambos') return
    map.set(Math.max(0, Math.trunc(entry.trayNumber)), entry.changedAt.slice(0, 10))
  })
  return map
}

export function buildArchScheduleDates(
  installedAt: string | undefined,
  changeEveryDays: number | undefined,
  totalTrays: number,
  actualChangeDatesByTray: Map<number, string>,
) {
  const dates: Array<string | undefined> = []
  if (!installedAt || totalTrays <= 0) return dates
  const changeDays = Math.max(1, Math.trunc(changeEveryDays ?? 0) || 1)
  let currentDate = installedAt.slice(0, 10)
  for (let trayNumber = 1; trayNumber <= totalTrays; trayNumber += 1) {
    if (trayNumber > 1) {
      currentDate = addDaysIso(currentDate, changeDays)
    }
    const actualDate = actualChangeDatesByTray.get(trayNumber) ?? currentDate
    dates[trayNumber] = actualDate
    currentDate = actualDate
  }
  return dates
}

export function scheduleStateForTray(
  trayNumber: number,
  maxForArch: number,
  deliveredCount: number,
  trays: CaseTray[],
): TrayState | 'nao_aplica' {
  if (trayNumber > maxForArch) return 'nao_aplica'
  const tray = trays.find((item) => item.trayNumber === trayNumber)
  if (tray?.state === 'rework') return 'rework'
  if (trayNumber <= deliveredCount) return 'entregue'
  if (!tray) return 'pendente'
  if (tray.state === 'entregue') return 'pendente'
  return tray.state
}

function resolvePlannedDate(
  plannedOverride: string | undefined,
  calculatedDate: string | undefined,
  previousAnchorDate: string | undefined,
  trayNumber: number,
) {
  const normalizedOverride = plannedOverride?.slice(0, 10)
  if (!normalizedOverride) return calculatedDate
  if (trayNumber > 1 && previousAnchorDate && normalizedOverride <= previousAnchorDate) return calculatedDate
  return normalizedOverride
}

export function buildChangeSchedule(payload: {
  installedAt?: string
  changeEveryDays: number
  totalUpper: number
  totalLower: number
  deliveredUpper: number
  deliveredLower: number
  trays: CaseTray[]
  actualUpperByTray: Map<number, string>
  actualLowerByTray: Map<number, string>
}): ChangeScheduleRow[] {
  if (!payload.installedAt) return []
  const max = Math.max(payload.totalUpper, payload.totalLower)
  const schedule: ChangeScheduleRow[] = []
  const installedAt = payload.installedAt.slice(0, 10)
  let nextUpperDate = installedAt
  let nextLowerDate = installedAt

  for (let trayNumber = 1; trayNumber <= max; trayNumber += 1) {
    const tray = payload.trays.find((item) => item.trayNumber === trayNumber)
    const plannedOverride = tray?.dueDate?.slice(0, 10)
    const previousUpperAnchor = nextUpperDate
    const previousLowerAnchor = nextLowerDate
    if (trayNumber > 1 && trayNumber <= payload.totalUpper) {
      nextUpperDate = addDaysIso(nextUpperDate, payload.changeEveryDays)
    }
    if (trayNumber > 1 && trayNumber <= payload.totalLower) {
      nextLowerDate = addDaysIso(nextLowerDate, payload.changeEveryDays)
    }
    const upperPlannedDate = trayNumber <= payload.totalUpper
      ? resolvePlannedDate(plannedOverride, nextUpperDate, previousUpperAnchor, trayNumber)
      : undefined
    const lowerPlannedDate = trayNumber <= payload.totalLower
      ? resolvePlannedDate(plannedOverride, nextLowerDate, previousLowerAnchor, trayNumber)
      : undefined
    const upperChangeDate = trayNumber <= payload.totalUpper ? (payload.actualUpperByTray.get(trayNumber) ?? upperPlannedDate) : undefined
    const lowerChangeDate = trayNumber <= payload.totalLower ? (payload.actualLowerByTray.get(trayNumber) ?? lowerPlannedDate) : undefined
    if (trayNumber <= payload.totalUpper && upperChangeDate) {
      nextUpperDate = upperChangeDate
    }
    if (trayNumber <= payload.totalLower && lowerChangeDate) {
      nextLowerDate = lowerChangeDate
    }
    schedule.push({
      trayNumber,
      upperPlannedDate,
      lowerPlannedDate,
      upperChangeDate,
      lowerChangeDate,
      changeDate: pickMinIsoDate([upperChangeDate, lowerChangeDate]) ?? installedAt,
      superiorState: scheduleStateForTray(trayNumber, payload.totalUpper, payload.deliveredUpper, payload.trays),
      inferiorState: scheduleStateForTray(trayNumber, payload.totalLower, payload.deliveredLower, payload.trays),
    })
  }

  return schedule
}

export function recalculateTrayDueDates(payload: {
  trays: CaseTray[]
  changeEveryDays: number
  installedAt?: string
  actualUpperByTray: Map<number, string>
  actualLowerByTray: Map<number, string>
  startTrayNumber?: number
  overrideDueDates?: Map<number, string>
}) {
  const sortedTrays = [...payload.trays].sort((left, right) => left.trayNumber - right.trayNumber)
  if (sortedTrays.length === 0) return payload.trays

  const startTrayNumber = Math.max(1, payload.startTrayNumber ?? 1)
  const changeDays = Math.max(1, Math.trunc(payload.changeEveryDays || 1))
  const overrideDueDates = payload.overrideDueDates ?? new Map<number, string>()
  const actualByTray = new Map<number, string>()

  sortedTrays.forEach((tray) => {
    const actualDate = pickMaxIsoDate([
      payload.actualUpperByTray.get(tray.trayNumber),
      payload.actualLowerByTray.get(tray.trayNumber),
    ])
    if (actualDate) actualByTray.set(tray.trayNumber, actualDate)
  })

  let anchorDate = payload.installedAt?.slice(0, 10) ?? sortedTrays[0]?.dueDate

  return sortedTrays.map((tray) => {
    let dueDate = tray.dueDate?.slice(0, 10)

    if (!anchorDate) {
      anchorDate = dueDate
    }

    if (tray.trayNumber >= startTrayNumber) {
      if (overrideDueDates.has(tray.trayNumber)) {
        dueDate = overrideDueDates.get(tray.trayNumber)?.slice(0, 10)
      } else if (tray.trayNumber === 1) {
        dueDate = anchorDate
      } else if (anchorDate) {
        dueDate = addDaysIso(anchorDate, changeDays)
      }
    } else if (!dueDate) {
      dueDate = tray.trayNumber === 1 ? anchorDate : anchorDate ? addDaysIso(anchorDate, changeDays) : dueDate
    }

    const actualDate = actualByTray.get(tray.trayNumber)
    anchorDate = actualDate ?? dueDate ?? anchorDate

    return {
      ...payload.trays.find((item) => item.trayNumber === tray.trayNumber)!,
      dueDate: dueDate ?? payload.trays.find((item) => item.trayNumber === tray.trayNumber)?.dueDate,
    }
  })
}

export function getCaseAlignerChangeSummary(caseItem: Case, todayIso: string = nowIsoDate()): CaseAlignerChangeSummary {
  const totals = resolveAlignerArchTotals(caseItem)
  const deliveredToPatient = resolveDeliveredToPatient(caseItem, totals)
  const installedAt = caseItem.installation?.installedAt?.slice(0, 10)

  if (!installedAt || (deliveredToPatient.upper <= 0 && deliveredToPatient.lower <= 0)) {
    return {
      totals,
      deliveredToPatient,
      current: { upper: 0, lower: 0 },
      next: {},
      status: 'not_started',
      messageTarget: {},
    }
  }

  const upperSchedule = buildArchScheduleDates(
    installedAt,
    caseItem.changeEveryDays,
    totals.upper,
    buildActualChangeDateMap(caseItem.installation, 'superior'),
  )
  const lowerSchedule = buildArchScheduleDates(
    installedAt,
    caseItem.changeEveryDays,
    totals.lower,
    buildActualChangeDateMap(caseItem.installation, 'inferior'),
  )

  const currentUpper = countCurrentTrayFromSchedule(upperSchedule, deliveredToPatient.upper, todayIso)
  const currentLower = countCurrentTrayFromSchedule(lowerSchedule, deliveredToPatient.lower, todayIso)
  const maxAvailableUpper = Math.min(totals.upper, deliveredToPatient.upper)
  const maxAvailableLower = Math.min(totals.lower, deliveredToPatient.lower)

  const nextUpper =
    currentUpper < maxAvailableUpper
      ? {
          trayNumber: currentUpper + 1,
          changeDate: upperSchedule[currentUpper + 1] ?? installedAt,
        }
      : undefined
  const nextLower =
    currentLower < maxAvailableLower
      ? {
          trayNumber: currentLower + 1,
          changeDate: lowerSchedule[currentLower + 1] ?? installedAt,
        }
      : undefined

  const nextDueDate = pickMinIsoDate([nextUpper?.changeDate, nextLower?.changeDate])
  const daysUntilDue = nextDueDate ? diffIsoDays(nextDueDate, todayIso) : undefined
  const messageTarget = {
    upper: nextUpper && nextUpper.changeDate === nextDueDate ? nextUpper.trayNumber : undefined,
    lower: nextLower && nextLower.changeDate === nextDueDate ? nextLower.trayNumber : undefined,
  }

  let status: CaseAlignerChangeSummary['status'] = 'awaiting_delivery'
  if (!nextDueDate) {
    const upperComplete = totals.upper <= 0 || currentUpper >= totals.upper
    const lowerComplete = totals.lower <= 0 || currentLower >= totals.lower
    status = upperComplete && lowerComplete ? 'complete' : 'awaiting_delivery'
  } else {
    const nextDueInDays = diffIsoDays(nextDueDate, todayIso)
    if (nextDueInDays < 0) {
      status = 'overdue'
    } else if (nextDueInDays === 0) {
      status = 'today'
    } else if (nextDueInDays <= 7) {
      status = 'upcoming'
    } else {
      status = 'later'
    }
  }

  return {
    totals,
    deliveredToPatient,
    current: {
      upper: currentUpper,
      lower: currentLower,
    },
    next: {
      upper: nextUpper,
      lower: nextLower,
    },
    nextDueDate,
    lastChangeDate: pickMaxIsoDate([
      currentUpper > 0 ? upperSchedule[currentUpper] : undefined,
      currentLower > 0 ? lowerSchedule[currentLower] : undefined,
    ]),
    daysUntilDue,
    status,
    messageTarget,
  }
}

function formatAlignerTarget(target: { upper?: number | null; lower?: number | null }) {
  const upper = typeof target.upper === 'number' && target.upper > 0 ? Math.trunc(target.upper) : undefined
  const lower = typeof target.lower === 'number' && target.lower > 0 ? Math.trunc(target.lower) : undefined

  if (upper && lower) {
    if (upper === lower) return `alinhador numero ${upper}`
    return `alinhador superior numero ${upper} e inferior numero ${lower}`
  }
  if (upper) return `alinhador superior numero ${upper}`
  if (lower) return `alinhador inferior numero ${lower}`
  return 'proximo alinhador'
}

export function buildAlignerWhatsappMessage(
  patientName: string,
  target: { upper?: number | null; lower?: number | null },
  dueDate?: string,
  todayIso: string = nowIsoDate(),
) {
  const patientLabel = patientName.trim() || 'paciente'
  const targetLabel = formatAlignerTarget(target)
  const reminderLine =
    dueDate && dueDate < todayIso
      ? `Passando para lembrar que a troca para o ${targetLabel} estava prevista para ${formatPtBrDate(dueDate)}.`
      : dueDate && dueDate > todayIso
      ? `Passando para lembrar que sua próxima troca para o ${targetLabel} está programada para ${formatPtBrDate(dueDate)}.`
        : `Passando para lembrar que hoje e o dia de realizar a troca para o ${targetLabel}.`

  return [
    `Olá, ${patientLabel}!`,
    '',
    reminderLine,
    '',
    'Seguir corretamente o periodo de troca e essencial para que seu tratamento evolua conforme o planejamento.',
    '',
    'Após realizar a troca, se possível, nos confirme por aqui com um "OK".',
    'Caso tenha qualquer dúvida ou desconforto, nossa equipe está à disposição para te ajudar!',
  ].join('\n')
}

export function buildAlignerWhatsappHref(
  patientWhatsapp: string | undefined,
  patientName: string,
  target: { upper?: number | null; lower?: number | null },
  dueDate?: string,
  todayIso: string = nowIsoDate(),
) {
  if (!patientWhatsapp || !isValidWhatsapp(patientWhatsapp)) return ''
  const baseUrl = buildWhatsappUrl(patientWhatsapp)
  if (!baseUrl) return ''
  return `${baseUrl}?text=${encodeURIComponent(buildAlignerWhatsappMessage(patientName, target, dueDate, todayIso))}`
}
