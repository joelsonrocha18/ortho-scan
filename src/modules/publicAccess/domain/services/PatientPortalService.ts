import { buildActualChangeDateMap, buildChangeSchedule, getCaseAlignerChangeSummary, recalculateTrayDueDates, resolveAlignerArchTotals, resolveDeliveredToPatient } from '../../../../lib/alignerChange'
import { addDaysToIsoDate, formatPtBrDate, nowIsoDate, pickMinIsoDate, toIsoDate } from '../../../../shared/utils/date'
import type { Case } from '../../../../types/Case'
import type { PatientDocument, PatientDocumentMetadata } from '../../../../types/PatientDocument'
import type {
  PatientPortalCalendarDay,
  PatientPortalCalendarMonth,
  PatientPortalDocument,
  PatientPortalPhotoSlot,
  PatientPortalSnapshot,
  PatientPortalSummary,
  PatientPortalTimelineItem,
} from '../models/PatientPortal'

type BuildPatientPortalSnapshotInput = {
  patient: {
    id: string
    name: string
    cpf?: string
    birthDate?: string
  }
  caseItem?: Case | null
  clinicName?: string
  dentistName?: string
  documents?: PatientDocument[]
  todayIso?: string
}

type PortalScheduleRow = {
  trayNumber: number
  changeDate: string
}

type PhotoDocumentRow = {
  documentId: string
  trayNumber?: number
  capturedAt?: string
  title: string
  fileName?: string
  note?: string
  url?: string
  source?: 'patient_portal' | 'internal'
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function maskCpf(value?: string) {
  const digits = onlyDigits(value ?? '')
  if (digits.length !== 11) return '***.***.***-**'
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`
}

function normalizeAccessCode(value?: string) {
  return (value ?? '').trim().toUpperCase()
}

function isReadableCode(value?: string) {
  const raw = (value ?? '').trim()
  if (!raw) return false
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)
}

function resolveAccessCode(caseItem?: Pick<Case, 'treatmentCode' | 'shortId' | 'id'> | null) {
  return caseItem?.treatmentCode ?? caseItem?.shortId ?? (isReadableCode(caseItem?.id) ? caseItem?.id : '')
}

function resolveProductLabel(caseItem?: Pick<Case, 'requestedProductLabel' | 'requestedProductId' | 'productType'> | null) {
  return caseItem?.requestedProductLabel ?? caseItem?.requestedProductId ?? caseItem?.productType ?? '-'
}

function toPatientFacingStatus(value?: string | null) {
  switch (value) {
    case 'scan_received':
    case 'scan_approved':
    case 'case_created':
      return 'Em preparacao'
    case 'in_production':
    case 'qc':
    case 'shipped':
      return 'Proximos alinhadores em preparacao'
    case 'delivered':
    case 'in_use':
    case 'em_tratamento':
      return 'Em tratamento'
    case 'rework':
      return 'Ajuste em andamento'
    default:
      return (value ?? 'Em acompanhamento').replaceAll('_', ' ')
  }
}

function buildFallbackSchedule(caseItem: Case) {
  return (caseItem.trays ?? [])
    .map((tray) => ({
      trayNumber: tray.trayNumber,
      changeDate: tray.dueDate ? toIsoDate(tray.dueDate) : '',
    }))
    .filter((item): item is PortalScheduleRow => Boolean(item.changeDate))
}

function buildActualPortalChangeMap(documents: PatientDocument[]) {
  const map = new Map<number, string>()
  documents.forEach((item) => {
    if (item.category !== 'foto') return
    const trayNumber = item.metadata?.trayNumber
    const capturedAt = item.metadata?.capturedAt?.slice(0, 10)
    if (!trayNumber || !capturedAt) return
    map.set(trayNumber, capturedAt)
  })
  return map
}

function buildScheduleRows(caseItem?: Case | null, documents: PatientDocument[] = []) {
  if (!caseItem) return [] as PortalScheduleRow[]
  const totals = resolveAlignerArchTotals(caseItem)
  const delivered = resolveDeliveredToPatient(caseItem, totals)
  if (caseItem.installation?.installedAt && (totals.upper > 0 || totals.lower > 0)) {
    const actualPortalChanges = buildActualPortalChangeMap(documents)
    const actualUpperByTray = buildActualChangeDateMap(caseItem.installation, 'superior')
    const actualLowerByTray = buildActualChangeDateMap(caseItem.installation, 'inferior')
    actualPortalChanges.forEach((date, trayNumber) => {
      actualUpperByTray.set(trayNumber, date)
      actualLowerByTray.set(trayNumber, date)
    })

    const adjustedTrays = recalculateTrayDueDates({
      trays: caseItem.trays,
      changeEveryDays: caseItem.changeEveryDays,
      installedAt: caseItem.installation.installedAt,
      actualUpperByTray,
      actualLowerByTray,
    })

    return buildChangeSchedule({
      installedAt: caseItem.installation.installedAt,
      changeEveryDays: caseItem.changeEveryDays,
      totalUpper: totals.upper,
      totalLower: totals.lower,
      deliveredUpper: delivered.upper,
      deliveredLower: delivered.lower,
      trays: adjustedTrays,
      actualUpperByTray,
      actualLowerByTray,
    }).map((item) => ({
      trayNumber: item.trayNumber,
      changeDate: item.changeDate,
    }))
  }
  return buildFallbackSchedule(caseItem)
}

function buildTimelineMilestones(caseItem: Case): PatientPortalTimelineItem[] {
  const items: PatientPortalTimelineItem[] = [
    {
      id: `milestone-created-${caseItem.id}`,
      date: caseItem.createdAt.slice(0, 10),
      title: 'Tratamento cadastrado',
      description: `Caso ${caseItem.treatmentCode ?? caseItem.id} preparado para acompanhamento do paciente.`,
      status: 'done',
      kind: 'milestone',
    },
  ]

  if (caseItem.installation?.installedAt) {
    items.push({
      id: `installation-${caseItem.id}`,
      date: caseItem.installation.installedAt.slice(0, 10),
      title: 'Uso do tratamento iniciado',
      description: 'A partir desta data as trocas passam a ser acompanhadas no portal.',
      status: 'done',
      kind: 'milestone',
    })
  }

  return items
}

function resolvePhotoMetadata(document: PatientDocument): PatientDocumentMetadata {
  return document.metadata ?? {}
}

function buildPhotoDocuments(documents: PatientDocument[]) {
  return [...documents]
    .filter((item) => item.category === 'foto')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map<PhotoDocumentRow>((item) => {
      const metadata = resolvePhotoMetadata(item)
      return {
        documentId: item.id,
        trayNumber: metadata.trayNumber,
        capturedAt: metadata.capturedAt ?? item.createdAt.slice(0, 10),
        title: item.title,
        fileName: item.fileName,
        note: item.note,
        url: item.url,
        source: metadata.source,
      }
    })
}

function findPhotoForTray(
  trayNumber: number,
  photoDocs: PhotoDocumentRow[],
  usedDocumentIds: Set<string>,
) {
  const exact = photoDocs.find((item) => item.trayNumber === trayNumber && !usedDocumentIds.has(item.documentId))
  if (exact) return exact
  return photoDocs.find((item) => item.trayNumber === undefined && !usedDocumentIds.has(item.documentId))
}

function buildPhotoSlots(scheduleRows: PortalScheduleRow[], documents: PatientDocument[], todayIso: string) {
  const photoDocs = buildPhotoDocuments(documents)
  const usedDocumentIds = new Set<string>()

  return scheduleRows.slice(0, 12).map<PatientPortalPhotoSlot>((row) => {
    const photo = findPhotoForTray(row.trayNumber, photoDocs, usedDocumentIds)
    if (photo) {
      usedDocumentIds.add(photo.documentId)
    }
    const recordedAt = photo?.capturedAt?.slice(0, 10)
    const status = photo
      ? 'recebida'
      : row.changeDate < todayIso
        ? 'pendente'
        : 'aguardando'

    return {
      id: `photo-slot-${row.trayNumber}`,
      trayNumber: row.trayNumber,
      plannedDate: row.changeDate,
      recordedAt,
      documentId: photo?.documentId,
      title: photo?.title ?? `Foto do alinhador #${row.trayNumber}`,
      fileName: photo?.fileName,
      note: photo?.note,
      previewUrl: photo?.url,
      status,
    }
  })
}

function buildChangeTimeline(scheduleRows: PortalScheduleRow[], photoSlots: PatientPortalPhotoSlot[], todayIso: string) {
  return scheduleRows.slice(0, 16).map<PatientPortalTimelineItem>((row) => {
    const photoSlot = photoSlots.find((item) => item.trayNumber === row.trayNumber)
    const status =
      row.changeDate < todayIso ? 'done' : row.changeDate === todayIso ? 'today' : 'upcoming'

    return {
      id: `change-${row.trayNumber}`,
      date: row.changeDate,
      title: `Troca do alinhador #${row.trayNumber}`,
      description:
        photoSlot?.status === 'recebida'
          ? `Selfie confirmada em ${formatPtBrDate(photoSlot.recordedAt)}.`
          : photoSlot?.status === 'pendente'
            ? 'Aguardando a confirmação da selfie desta troca.'
            : 'Troca futura prevista para o tratamento.',
      trayNumber: row.trayNumber,
      status,
      kind: 'change',
      photoStatus: photoSlot?.status,
    }
  })
}

function buildCalendarMonth(baseDate: Date, highlightedDates: Map<string, number[]>, todayIso: string): PatientPortalCalendarMonth {
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
  const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = monthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const cells: Array<PatientPortalCalendarDay | null> = []
  const weekdayOffset = monthStart.getDay()
  const cursor = new Date(monthStart)

  for (let index = 0; index < weekdayOffset; index += 1) {
    cells.push(null)
  }

  while (cursor.getMonth() === monthStart.getMonth()) {
    const isoDate = toIsoDate(cursor)
    cells.push({
      isoDate,
      dayNumber: cursor.getDate(),
      isToday: isoDate === todayIso,
      isChangeDay: highlightedDates.has(isoDate),
      trayNumbers: highlightedDates.get(isoDate) ?? [],
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  return {
    key: monthKey,
    label: monthLabel.replace(/^\w/, (char) => char.toUpperCase()),
    cells,
  }
}

function buildCalendarMonths(scheduleRows: PortalScheduleRow[], todayIso: string) {
  const dates = new Map<string, number[]>()
  scheduleRows.forEach((row) => {
    const current = dates.get(row.changeDate) ?? []
    current.push(row.trayNumber)
    dates.set(row.changeDate, current)
  })

  const today = new Date(`${todayIso}T00:00:00`)
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)

  return [buildCalendarMonth(currentMonth, dates, todayIso), buildCalendarMonth(nextMonth, dates, todayIso)]
}

function findLastRecordedPhotoSlot(photoSlots: PatientPortalPhotoSlot[]) {
  return [...photoSlots]
    .filter((item): item is PatientPortalPhotoSlot & { recordedAt: string } => Boolean(item.recordedAt))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.trayNumber - right.trayNumber)
    .at(-1)
}

function resolveNextChangeDate(
  photoSlots: PatientPortalPhotoSlot[],
  changeEveryDays: number,
) {
  const lastRecordedSlot = findLastRecordedPhotoSlot(photoSlots)
  if (lastRecordedSlot && changeEveryDays > 0) {
    const hasRemainingTray = photoSlots.some((item) => item.trayNumber > lastRecordedSlot.trayNumber)
    if (!hasRemainingTray) return undefined
    return addDaysToIsoDate(lastRecordedSlot.recordedAt, changeEveryDays)
  }

  return photoSlots.find((item) => item.status !== 'recebida')?.plannedDate
}

export function isMatchingPatientAccessCode(caseItem: Pick<Case, 'id' | 'shortId' | 'treatmentCode'>, accessCode: string) {
  const normalized = normalizeAccessCode(accessCode)
  if (!normalized) return false
  const candidates = [
    normalizeAccessCode(caseItem.treatmentCode),
    normalizeAccessCode(caseItem.shortId),
    isReadableCode(caseItem.id) ? normalizeAccessCode(caseItem.id) : '',
  ].filter(Boolean)
  return candidates.includes(normalized)
}

export function buildPatientPortalSnapshot(input: BuildPatientPortalSnapshotInput): PatientPortalSnapshot {
  const todayIso = input.todayIso ?? nowIsoDate()
  const caseItem = input.caseItem ?? null
  const documents = [...(input.documents ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const scheduleRows = buildScheduleRows(caseItem, documents)
  const photoSlots = buildPhotoSlots(scheduleRows, documents, todayIso)
  const changeTimeline = buildChangeTimeline(scheduleRows, photoSlots, todayIso)
  const milestoneTimeline = caseItem ? buildTimelineMilestones(caseItem) : []
  const timeline = [...milestoneTimeline, ...changeTimeline].sort((left, right) => left.date.localeCompare(right.date))
  const calendarMonths = buildCalendarMonths(scheduleRows, todayIso)

  const alignerSummary = caseItem ? getCaseAlignerChangeSummary(caseItem, todayIso) : null
  const changeEveryDays = caseItem?.changeEveryDays ?? 0
  const nextChangeDate = resolveNextChangeDate(photoSlots, changeEveryDays)
  const lastRecordedSlot = findLastRecordedPhotoSlot(photoSlots)
  const lastRecordedDate = lastRecordedSlot?.recordedAt
  const summary: PatientPortalSummary = {
    patientId: input.patient.id,
    patientName: input.patient.name,
    cpfMasked: maskCpf(input.patient.cpf),
    birthDate: input.patient.birthDate ? formatPtBrDate(input.patient.birthDate) : '-',
    clinicName: input.clinicName,
    dentistName: input.dentistName,
    activeCaseCode: resolveAccessCode(caseItem),
    treatmentStatus: toPatientFacingStatus(caseItem?.lifecycleStatus ?? caseItem?.status),
    nextChangeDate: nextChangeDate ? formatPtBrDate(nextChangeDate) : undefined,
    lastChangeDate: lastRecordedDate ? formatPtBrDate(lastRecordedDate) : alignerSummary?.lastChangeDate ? formatPtBrDate(alignerSummary.lastChangeDate) : undefined,
    productLabel: resolveProductLabel(caseItem),
    treatmentOrigin: caseItem?.treatmentOrigin,
    changeEveryDays,
    totalTrays: caseItem?.totalTrays ?? 0,
    deliveredTrays: alignerSummary?.deliveredToPatient ?? { upper: 0, lower: 0 },
    currentTrays: alignerSummary?.current ?? { upper: 0, lower: 0 },
  }

  return {
    summary,
    accessCode: resolveAccessCode(caseItem) || '',
    timeline,
    photoSlots,
    calendarMonths,
    documents: documents.map<PatientPortalDocument>((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      createdAt: item.createdAt,
      fileName: item.fileName,
      url: item.url,
      note: item.note,
      trayNumber: item.metadata?.trayNumber,
      capturedAt: item.metadata?.capturedAt,
      source: item.metadata?.source,
    })),
  }
}

export function resolvePatientPortalAccessCode(caseItem?: Pick<Case, 'id' | 'shortId' | 'treatmentCode'> | null) {
  return resolveAccessCode(caseItem)
}

export function resolvePatientPortalNextChangeDate(caseItem?: Case | null) {
  if (!caseItem) return undefined
  const alignerSummary = getCaseAlignerChangeSummary(caseItem)
  return pickMinIsoDate([alignerSummary.nextDueDate])
}
