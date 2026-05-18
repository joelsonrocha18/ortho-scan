import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { can } from '../../../../auth/permissions'
import { listCasesForUser } from '../../../../auth/scope'
import { useToast } from '../../../../app/ToastProvider'
import { DATA_MODE } from '../../../../data/dataMode'
import { getCurrentUser } from '../../../../lib/auth'
import { buildChangeSchedule } from '../../../../lib/alignerChange'
import { buildPatientPortalWhatsappHref, resolvePatientPortalAccessCode } from '../../../../lib/accessLinks'
import { resolveRequestedProductLabel } from '../../../../lib/productLabel'
import { useDb } from '../../../../lib/useDb'
import { useSupabaseSyncTick } from '../../../../lib/useSupabaseSyncTick'
import { listPatientDocs, resolvePatientDocUrl } from '../../../../repo/patientDocsRepo'
import { downloadBlob } from '../../../../repo/storageRepo'
import { formatPtBrDateTime, nowIsoDate } from '../../../../shared/utils/date'
import type { Case, CaseTray, TrayState } from '../../../../types/Case'
import { isAlignerProductType, normalizeProductType } from '../../../../types/Product'
import { RegisterReworkUseCase } from '../../../lab'
import { createLabRepository } from '../../../lab/infra'
import { CaseLifecycleService, toReadableCaseCode as formatReadableCaseCode } from '../../domain'
import { useCaseDetailActions } from './useCaseDetailActions'
import { useCaseModuleActions } from './useCaseModuleActions'
import { useCaseSupabaseDetail } from './useCaseSupabaseDetail'
import { useCaseTimeline } from './useCaseTimeline'
import {
  caseProgress,
  caseStatusLabelMap,
  caseStatusToneMap,
  formatBrlCurrencyInput,
  getReplenishmentAlerts,
  groupCaseScanFiles,
  hasRevisionSuffix,
  isReworkProductionLabItem,
} from '../lib/caseDetailPresentation'

type AttachmentType = 'imagem' | 'documento' | 'outro'
type PageState = 'ready' | 'not_found' | 'forbidden'
type PatientPortalTrayPhoto = {
  documentId: string
  title: string
  capturedAt?: string
  sentAt?: string
  deviceLabel?: string
  previewUrl?: string
  note?: string
  fileName?: string
  filePath?: string
}

export function useCaseDetailController() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const { updateCaseStatus, addCaseNote, publishPlanningVersion, approvePlanningVersion, listCaseTimeline } = useCaseModuleActions(currentUser)
  const labRepository = useMemo(() => createLabRepository(currentUser), [currentUser])
  const registerTrayRework = useMemo(() => new RegisterReworkUseCase(labRepository, currentUser), [currentUser, labRepository])
  const canWrite = can(currentUser, 'cases.write')
  const canWriteLocalOnly = canWrite && !isSupabaseMode
  const canManageTray = canWrite
  const canReadLab = can(currentUser, 'lab.read')
  const canDeleteCase = can(currentUser, 'cases.delete') && currentUser?.role === 'master_admin'
  const [selectedTray, setSelectedTray] = useState<CaseTray | null>(null)
  const [trayState, setSelectedTrayState] = useState<TrayState>('pendente')
  const [reworkArch, setReworkArch] = useState<'superior' | 'inferior' | 'ambos'>('ambos')
  const [trayNote, setTrayNote] = useState('')
  const [budgetValue, setBudgetValue] = useState('')
  const [budgetNotes, setBudgetNotes] = useState('')
  const [contractNotes, setContractNotes] = useState('')
  const [installationDate, setInstallationDate] = useState(nowIsoDate())
  const [installationNote, setInstallationNote] = useState('')
  const [installationDeliveredUpper, setInstallationDeliveredUpper] = useState('0')
  const [installationDeliveredLower, setInstallationDeliveredLower] = useState('0')
  const [changeEveryDaysInput, setChangeEveryDaysInput] = useState('7')
  const [planningVersionNote, setPlanningVersionNote] = useState('')
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false)
  const [attachmentType, setAttachmentType] = useState<AttachmentType>('imagem')
  const [attachmentNote, setAttachmentNote] = useState('')
  const [attachmentDate, setAttachmentDate] = useState(nowIsoDate())
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [patientPortalPhotosByTray, setPatientPortalPhotosByTray] = useState<Map<number, PatientPortalTrayPhoto>>(new Map())
  const [optimisticTrays, setOptimisticTrays] = useState<CaseTray[] | null>(null)
  const [optimisticActualChangeDates, setOptimisticActualChangeDates] = useState<NonNullable<Case['installation']>['actualChangeDates'] | null>(null)
  const initializedCaseIdRef = useRef<string | null>(null)
  const supabaseSyncTick = useSupabaseSyncTick()
  const supabaseDetail = useCaseSupabaseDetail(params.id, isSupabaseMode, supabaseSyncTick)
  const refreshSupabase = supabaseDetail.refreshSupabase

  const currentCase = useMemo(
    () => (isSupabaseMode ? supabaseDetail.supabaseCase : params.id ? db.cases.find((item) => item.id === params.id) ?? null : null),
    [db.cases, isSupabaseMode, params.id, supabaseDetail.supabaseCase],
  )
  const resolvedCase = currentCase
  const displayedTrays = optimisticTrays ?? resolvedCase?.trays ?? []
  const timelineRefreshSignature = `${params.id ?? ''}::${supabaseSyncTick}::${db.auditLogs?.length ?? 0}::${resolvedCase?.updatedAt ?? ''}::${resolvedCase?.timelineEntries?.length ?? 0}`
  const { timelineEntries } = useCaseTimeline(resolvedCase?.id, listCaseTimeline, timelineRefreshSignature)
  const localSourceScan = useMemo(
    () => (!isSupabaseMode && resolvedCase?.sourceScanId ? db.scans.find((item) => item.id === resolvedCase.sourceScanId) : undefined),
    [db.scans, isSupabaseMode, resolvedCase],
  )
  const isAlignerCase = useMemo(
    () => (resolvedCase ? isAlignerProductType(normalizeProductType(resolvedCase.productId ?? resolvedCase.productType)) : false),
    [resolvedCase],
  )
  const scopedCases = useMemo(() => listCasesForUser(db, currentUser), [currentUser, db])
  const totalUpper = useMemo(() => {
    if (!resolvedCase) return 0
    if (resolvedCase.arch === 'inferior') return 0
    if (typeof resolvedCase.totalTraysUpper === 'number') return Math.max(0, resolvedCase.totalTraysUpper)
    if (typeof resolvedCase.totalTraysLower === 'number') return 0
    return Math.max(0, resolvedCase.totalTrays)
  }, [resolvedCase])
  const totalLower = useMemo(() => {
    if (!resolvedCase) return 0
    if (resolvedCase.arch === 'superior') return 0
    if (typeof resolvedCase.totalTraysLower === 'number') return Math.max(0, resolvedCase.totalTraysLower)
    if (typeof resolvedCase.totalTraysUpper === 'number') return 0
    return Math.max(0, resolvedCase.totalTrays)
  }, [resolvedCase])
  const hasUpperArch = totalUpper > 0
  const hasLowerArch = totalLower > 0
  const deliveredUpper = resolvedCase?.installation?.deliveredUpper ?? 0
  const deliveredLower = resolvedCase?.installation?.deliveredLower ?? 0
  const deliveredToDentist = useMemo(() => CaseLifecycleService.deliveredToDentistByArch(resolvedCase), [resolvedCase])
  const readyToDeliverPatient = useMemo(
    () => ({ upper: Math.max(0, deliveredToDentist.upper - deliveredUpper), lower: Math.max(0, deliveredToDentist.lower - deliveredLower) }),
    [deliveredLower, deliveredToDentist.lower, deliveredToDentist.upper, deliveredUpper],
  )
  const actualChangeDateUpperByTray = useMemo(() => {
    const map = new Map<number, string>()
    ;(resolvedCase?.installation?.actualChangeDates ?? []).forEach((entry) => {
      if (entry.trayNumber > 0 && entry.changedAt && (!entry.arch || entry.arch === 'superior' || entry.arch === 'ambos')) map.set(entry.trayNumber, entry.changedAt)
    })
    ;(optimisticActualChangeDates ?? []).forEach((entry) => {
      if (entry.trayNumber > 0 && entry.changedAt && (!entry.arch || entry.arch === 'superior' || entry.arch === 'ambos')) map.set(entry.trayNumber, entry.changedAt)
    })
    return map
  }, [resolvedCase, optimisticActualChangeDates])
  const actualChangeDateLowerByTray = useMemo(() => {
    const map = new Map<number, string>()
    ;(resolvedCase?.installation?.actualChangeDates ?? []).forEach((entry) => {
      if (entry.trayNumber > 0 && entry.changedAt && (!entry.arch || entry.arch === 'inferior' || entry.arch === 'ambos')) map.set(entry.trayNumber, entry.changedAt)
    })
    ;(optimisticActualChangeDates ?? []).forEach((entry) => {
      if (entry.trayNumber > 0 && entry.changedAt && (!entry.arch || entry.arch === 'inferior' || entry.arch === 'ambos')) map.set(entry.trayNumber, entry.changedAt)
    })
    return map
  }, [resolvedCase, optimisticActualChangeDates])
  const progressUpper = useMemo(() => caseProgress(totalUpper, deliveredUpper), [deliveredUpper, totalUpper])
  const progressLower = useMemo(() => caseProgress(totalLower, deliveredLower), [deliveredLower, totalLower])
  const todayIso = useMemo(() => nowIsoDate(), [])
  const changeSchedule = useMemo(
    () =>
      resolvedCase
        ? buildChangeSchedule({
          installedAt: resolvedCase.installation?.installedAt,
          changeEveryDays: resolvedCase.changeEveryDays,
          totalUpper,
          totalLower,
          deliveredUpper: progressUpper.delivered,
          deliveredLower: progressLower.delivered,
          trays: displayedTrays,
          actualUpperByTray: actualChangeDateUpperByTray,
          actualLowerByTray: actualChangeDateLowerByTray,
        })
        : [],
    [actualChangeDateLowerByTray, actualChangeDateUpperByTray, displayedTrays, progressLower.delivered, progressUpper.delivered, resolvedCase, totalLower, totalUpper],
  )
  const patientProgressUpper = useMemo(() => caseProgress(totalUpper, Math.min(changeSchedule.filter((row) => row.trayNumber <= totalUpper && (row.upperChangeDate ?? '') <= todayIso).length, Math.max(0, Math.trunc(deliveredUpper)))), [changeSchedule, deliveredUpper, todayIso, totalUpper])
  const patientProgressLower = useMemo(() => caseProgress(totalLower, Math.min(changeSchedule.filter((row) => row.trayNumber <= totalLower && (row.lowerChangeDate ?? '') <= todayIso).length, Math.max(0, Math.trunc(deliveredLower)))), [changeSchedule, deliveredLower, todayIso, totalLower])
  const nextTrayRequired = useMemo(() => (hasUpperArch && hasLowerArch ? Math.max(0, Math.min(deliveredUpper, deliveredLower)) + 1 : hasUpperArch ? Math.max(0, Math.trunc(deliveredUpper)) + 1 : hasLowerArch ? Math.max(0, Math.trunc(deliveredLower)) + 1 : 0), [deliveredLower, deliveredUpper, hasLowerArch, hasUpperArch])
  const maxPlannedTrays = Math.max(totalUpper, totalLower)
  const nextReplacementDueDate = useMemo(() => (nextTrayRequired <= 0 || nextTrayRequired > maxPlannedTrays ? undefined : changeSchedule.find((row) => row.trayNumber === nextTrayRequired)?.changeDate), [changeSchedule, maxPlannedTrays, nextTrayRequired])
  const linkedLabItems = useMemo(() => (resolvedCase ? (isSupabaseMode ? supabaseDetail.supabaseLabItems : db.labItems.filter((item) => item.caseId === resolvedCase.id)) : []), [db.labItems, isSupabaseMode, resolvedCase, supabaseDetail.supabaseLabItems])
  const dentistDeliveryDateByArchTray = useMemo(() => {
    const upper = new Map<number, string>()
    const lower = new Map<number, string>()
    ;[...(resolvedCase?.deliveryLots ?? [])].sort((a, b) => a.deliveredToDoctorAt.localeCompare(b.deliveredToDoctorAt)).forEach((lot) => {
      const appliesUpper = lot.arch === 'superior' || lot.arch === 'ambos'
      const appliesLower = lot.arch === 'inferior' || lot.arch === 'ambos'
      for (let tray = lot.fromTray; tray <= lot.toTray; tray += 1) {
        if (appliesUpper && !upper.has(tray)) upper.set(tray, lot.deliveredToDoctorAt)
        if (appliesLower && !lower.has(tray)) lower.set(tray, lot.deliveredToDoctorAt)
      }
    })
    return { upper, lower }
  }, [resolvedCase])
  const manualChangeCompletionUpperByTray = useMemo(() => new Map((resolvedCase?.installation?.manualChangeCompletion ?? []).filter((entry) => !entry.arch || entry.arch === 'superior' || entry.arch === 'ambos').map((entry) => [entry.trayNumber, Boolean(entry.completed)])), [resolvedCase])
  const manualChangeCompletionLowerByTray = useMemo(() => new Map((resolvedCase?.installation?.manualChangeCompletion ?? []).filter((entry) => !entry.arch || entry.arch === 'inferior' || entry.arch === 'ambos').map((entry) => [entry.trayNumber, Boolean(entry.completed)])), [resolvedCase])
  const readyLabItems = useMemo(() => linkedLabItems.filter((item) => item.status === 'prontas' && (item.requestKind === 'reconfeccao' || isReworkProductionLabItem(item) ? ['rework', 'pronta', 'entregue'].includes(resolvedCase?.trays.find((row) => row.trayNumber === item.trayNumber)?.state ?? '') : resolvedCase?.trays.find((row) => row.trayNumber === item.trayNumber)?.state === 'pronta')), [linkedLabItems, resolvedCase])
  const deliveredToProfessionalByTray = useMemo(() => {
    const map = new Map<number, number>()
    ;(resolvedCase?.deliveryLots ?? []).forEach((lot) => { for (let tray = lot.fromTray; tray <= lot.toTray; tray += 1) map.set(tray, (map.get(tray) ?? 0) + 1) })
    return map
  }, [resolvedCase])
  const deliveredLabItemIds = useMemo(() => new Set(linkedLabItems.filter((item) => item.status === 'prontas' && !readyLabItems.some((row) => row.id === item.id) && (((item.requestKind ?? 'producao') === 'producao' && (resolvedCase?.deliveryLots?.length ?? 0) > 0 && !hasRevisionSuffix(item.requestCode)) || resolvedCase?.trays.find((row) => row.trayNumber === item.trayNumber)?.state === 'entregue' || (deliveredToProfessionalByTray.get(item.trayNumber) ?? 0) > 0)).map((item) => item.id)), [deliveredToProfessionalByTray, linkedLabItems, readyLabItems, resolvedCase])
  const pipelineLabItems = useMemo(() => linkedLabItems.filter((item) => !deliveredLabItemIds.has(item.id) && item.requestKind !== 'reconfeccao'), [deliveredLabItemIds, linkedLabItems])
  const hasProductionOrder = useMemo(() => linkedLabItems.some((item) => (item.requestKind ?? 'producao') === 'producao'), [linkedLabItems])
  const hasDentistDelivery = (resolvedCase?.deliveryLots?.length ?? 0) > 0
  const deliveredToProfessionalCount = useMemo(() => (hasUpperArch && hasLowerArch ? Math.max(0, Math.min(deliveredToDentist.upper, deliveredToDentist.lower)) : hasUpperArch ? Math.max(0, deliveredToDentist.upper) : hasLowerArch ? Math.max(0, deliveredToDentist.lower) : 0), [deliveredToDentist.lower, deliveredToDentist.upper, hasLowerArch, hasUpperArch])
  const labSummary = useMemo(() => {
    const emProducao = pipelineLabItems.filter((item) => item.status === 'em_producao').length
    const controleQualidade = pipelineLabItems.filter((item) => item.status === 'controle_qualidade').length
    const prontas = readyLabItems.length
    return isAlignerCase && maxPlannedTrays > 0
      ? { aguardando_iniciar: Math.max(0, maxPlannedTrays - deliveredToProfessionalCount - emProducao - controleQualidade - prontas), em_producao: emProducao, controle_qualidade: controleQualidade, prontas, entregues: Math.min(deliveredToProfessionalCount, maxPlannedTrays), osItens: linkedLabItems.length }
      : { aguardando_iniciar: pipelineLabItems.filter((item) => item.status === 'aguardando_iniciar').length, em_producao: emProducao, controle_qualidade: controleQualidade, prontas, entregues: deliveredLabItemIds.size, osItens: linkedLabItems.length }
  }, [deliveredLabItemIds.size, deliveredToProfessionalCount, isAlignerCase, linkedLabItems.length, maxPlannedTrays, pipelineLabItems, readyLabItems.length])
  const replacementSummary = useMemo(() => ({ totalContratado: Math.max(0, totalUpper + totalLower), entreguePaciente: Math.max(0, Math.trunc(deliveredUpper)) + Math.max(0, Math.trunc(deliveredLower)), saldoRestante: Math.max(0, totalUpper + totalLower - Math.max(0, Math.trunc(deliveredUpper)) - Math.max(0, Math.trunc(deliveredLower))) }), [deliveredLower, deliveredUpper, totalLower, totalUpper])
  const canConcludeTreatmentManually = useMemo(() => (resolvedCase ? CaseLifecycleService.canManuallyConcludeTreatment(resolvedCase, totalUpper, totalLower) : false), [resolvedCase, totalLower, totalUpper])
  const groupedScanFiles = useMemo(() => groupCaseScanFiles(resolvedCase), [resolvedCase])
  const replenishmentAlerts = useMemo(() => (resolvedCase ? getReplenishmentAlerts(resolvedCase.id, nextReplacementDueDate, todayIso) : []), [nextReplacementDueDate, resolvedCase, todayIso])
  const patientDisplayName = useMemo(() => (!resolvedCase ? '' : !resolvedCase.patientId ? resolvedCase.patientName : db.patients.find((item) => item.id === resolvedCase.patientId)?.name ?? resolvedCase.patientName), [db.patients, resolvedCase])
  const patientRecord = useMemo(() => (resolvedCase?.patientId ? db.patients.find((item) => item.id === resolvedCase.patientId) : undefined), [db.patients, resolvedCase])
  const patientWhatsapp = useMemo(() => (isSupabaseMode ? supabaseDetail.supabaseCaseRefs.patientWhatsapp ?? patientRecord?.whatsapp ?? patientRecord?.phone : patientRecord?.whatsapp ?? patientRecord?.phone), [isSupabaseMode, patientRecord?.phone, patientRecord?.whatsapp, supabaseDetail.supabaseCaseRefs.patientWhatsapp])
  const patientPortalAccessCode = useMemo(() => resolvePatientPortalAccessCode(resolvedCase), [resolvedCase])
  const patientPortalWhatsappHref = useMemo(
    () =>
      buildPatientPortalWhatsappHref({
        patientName: patientDisplayName,
        whatsapp: patientWhatsapp,
        accessCode: patientPortalAccessCode,
      }),
    [patientDisplayName, patientPortalAccessCode, patientWhatsapp],
  )
  const dentistsById = useMemo(() => new Map(db.dentists.map((item) => [item.id, item])), [db.dentists])
  const clinicsById = useMemo(() => new Map(db.clinics.map((item) => [item.id, item])), [db.clinics])
  const clinicName = isSupabaseMode ? (supabaseDetail.supabaseCaseRefs.clinicName ?? (resolvedCase?.clinicId ? clinicsById.get(resolvedCase.clinicId)?.tradeName : undefined)) : (resolvedCase?.clinicId ? clinicsById.get(resolvedCase.clinicId)?.tradeName : undefined)
  const dentist = resolvedCase?.dentistId ? dentistsById.get(resolvedCase.dentistId) : undefined
  const requester = resolvedCase?.requestedByDentistId ? dentistsById.get(resolvedCase.requestedByDentistId) : undefined
  const dentistNameResolved = isSupabaseMode ? (supabaseDetail.supabaseCaseRefs.dentistName ?? dentist?.name) : dentist?.name
  const requesterNameResolved = isSupabaseMode ? (supabaseDetail.supabaseCaseRefs.requesterName ?? requester?.name) : requester?.name
  const dentistLabel = dentistNameResolved ? `${(isSupabaseMode ? supabaseDetail.supabaseCaseRefs.dentistGender : dentist?.gender) === 'feminino' ? 'Dra.' : 'Dr.'} ${dentistNameResolved}` : '-'
  const requesterLabel = requesterNameResolved ? `${(isSupabaseMode ? supabaseDetail.supabaseCaseRefs.requesterGender : requester?.gender) === 'feminino' ? 'Dra.' : 'Dr.'} ${requesterNameResolved}` : dentistLabel
  const displayProductLabel = useMemo(() => (!resolvedCase ? '-' : resolveRequestedProductLabel({ requestedProductLabel: isSupabaseMode ? supabaseDetail.supabaseCaseRefs.requestedProductLabel : resolvedCase.requestedProductLabel ?? localSourceScan?.purposeLabel, requestedProductId: isSupabaseMode ? supabaseDetail.supabaseCaseRefs.requestedProductId : resolvedCase.requestedProductId ?? localSourceScan?.purposeProductId, productType: resolvedCase.productType ?? localSourceScan?.purposeProductType, productId: resolvedCase.productId ?? localSourceScan?.purposeProductId, alignerFallbackLabel: isAlignerCase ? 'Alinhadores' : undefined })), [isAlignerCase, isSupabaseMode, localSourceScan, resolvedCase, supabaseDetail.supabaseCaseRefs.requestedProductId, supabaseDetail.supabaseCaseRefs.requestedProductLabel])
  const displayCaseCode = resolvedCase ? formatReadableCaseCode(resolvedCase.treatmentCode ?? resolvedCase.id) : '-'
  const displayTreatmentOrigin = useMemo(() => (!resolvedCase ? 'externo' as const : ((clinicName ?? '').trim().toUpperCase() === 'ARRIMO' || (resolvedCase.clinicId ?? '').trim().toLowerCase() === 'clinic_arrimo' || (resolvedCase.clinicId ?? '').trim().toLowerCase() === 'cli-0001' ? 'interno' as const : resolvedCase.treatmentOrigin === 'interno' ? 'interno' as const : 'externo' as const)), [clinicName, resolvedCase])
  const headerProgressCards = useMemo(() => ([...(hasUpperArch ? [{ label: 'Progresso - Superior', delivered: patientProgressUpper.delivered, total: patientProgressUpper.total, percent: patientProgressUpper.percent, caption: 'Baseado na data real de troca do paciente.' }] : []), ...(hasLowerArch ? [{ label: 'Progresso - Inferior', delivered: patientProgressLower.delivered, total: patientProgressLower.total, percent: patientProgressLower.percent, caption: 'Baseado na data real de troca do paciente.' }] : [])]), [hasLowerArch, hasUpperArch, patientProgressLower, patientProgressUpper])
  const headerSummaryLines = useMemo(() => ([`Em produção/CQ: ${pipelineLabItems.filter((item) => item.status === 'em_producao' || item.status === 'controle_qualidade').length}`, `Prontas: ${readyLabItems.length}`, `Entregues: ${hasUpperArch && hasLowerArch ? `Sup ${progressUpper.delivered} | Inf ${progressLower.delivered}` : hasUpperArch ? `Sup ${progressUpper.delivered}` : `Inf ${progressLower.delivered}`}`]), [hasLowerArch, hasUpperArch, pipelineLabItems, progressLower.delivered, progressUpper.delivered, readyLabItems.length])
  const planningLine = resolvedCase ? `Planejamento: ${hasUpperArch && hasLowerArch ? `Superior ${totalUpper} | Inferior ${totalLower}` : hasUpperArch ? `Superior ${totalUpper}` : hasLowerArch ? `Inferior ${totalLower}` : '-'} | Troca ${resolvedCase.changeEveryDays} dias | Ataches: ${resolvedCase.attachmentBondingTray ? 'Sim' : 'Não'}` : ''
  const currentCaseAccessCodes = useMemo(() => {
    if (!resolvedCase) return new Set<string>()
    return new Set(
      [resolvedCase.treatmentCode, resolvedCase.shortId, resolvedCase.id]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim().toUpperCase()),
    )
  }, [resolvedCase])

  useEffect(() => {
    let cancelled = false
    const patientId = resolvedCase?.patientId
    const caseId = resolvedCase?.id

    if (!patientId) {
      setPatientPortalPhotosByTray(new Map())
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const documents = await listPatientDocs(patientId)
        const scoped = documents
          .filter((item) => {
            if (item.category !== 'foto') return false
            if (item.metadata?.source !== 'patient_portal') return false
            if (typeof item.metadata?.trayNumber !== 'number') return false
            if (!caseId) return true
            if (item.caseId === caseId) return true
            const metadataAccessCode = item.metadata?.accessCode?.trim().toUpperCase()
            if (!item.caseId && metadataAccessCode && currentCaseAccessCodes.has(metadataAccessCode)) return true
            return false
          })
          .sort((left, right) =>
            (right.metadata?.capturedAt ?? right.createdAt).localeCompare(left.metadata?.capturedAt ?? left.createdAt),
          )

        const resolved = await Promise.all(
          scoped.map(async (item) => {
            const trayNumber = item.metadata?.trayNumber
            if (typeof trayNumber !== 'number') return null
            const url = await resolvePatientDocUrl(item)
            return {
              trayNumber,
                photo: {
                  documentId: item.id,
                  title: item.title,
                  capturedAt: item.metadata?.capturedAt ?? item.createdAt.slice(0, 10),
                  sentAt: item.metadata?.sentAt ?? item.createdAt,
                  deviceLabel: item.metadata?.deviceLabel,
                  previewUrl: url.ok ? url.url : item.url,
                  note: item.note,
                  fileName: item.fileName,
                  filePath: item.filePath,
                } satisfies PatientPortalTrayPhoto,
              }
          }),
        )

        if (cancelled) return

        const nextMap = new Map<number, PatientPortalTrayPhoto>()
        resolved.forEach((entry) => {
          if (!entry || nextMap.has(entry.trayNumber)) return
          nextMap.set(entry.trayNumber, entry.photo)
        })
        setPatientPortalPhotosByTray(nextMap)
      } catch {
        if (!cancelled) setPatientPortalPhotosByTray(new Map())
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentCaseAccessCodes, db.patientDocuments.length, resolvedCase?.id, resolvedCase?.patientId, supabaseSyncTick])

  useEffect(() => {
    if (!resolvedCase?.installation) return
    if (resolvedCase.status === 'finalizado') return
    const nextStatus = CaseLifecycleService.deriveTreatmentStatus({
      installedAt: resolvedCase.installation.installedAt,
      changeEveryDays: resolvedCase.changeEveryDays,
      totalUpper,
      totalLower,
      deliveredUpper: resolvedCase.installation.deliveredUpper ?? 0,
      deliveredLower: resolvedCase.installation.deliveredLower ?? 0,
      completedUpper: patientProgressUpper.delivered,
      completedLower: patientProgressLower.delivered,
      todayIso,
      nextDueDate: nextReplacementDueDate,
    })
    if (nextStatus === resolvedCase.status) return
    void (async () => {
      const result = await Promise.resolve(updateCaseStatus.execute({
        caseId: resolvedCase.id,
        nextStatus,
        nextPhase: 'em_producao',
        reason: 'Status recalculado pelo ciclo de tratamento.',
      }))
      if (result.ok && isSupabaseMode) refreshSupabase()
    })()
  }, [isSupabaseMode, nextReplacementDueDate, patientProgressLower.delivered, patientProgressUpper.delivered, refreshSupabase, resolvedCase, todayIso, totalLower, totalUpper, updateCaseStatus])

  useEffect(() => {
    if (!resolvedCase) {
      initializedCaseIdRef.current = null
      setOptimisticTrays(null)
      return
    }
    if (initializedCaseIdRef.current === resolvedCase.id) return
    initializedCaseIdRef.current = resolvedCase.id
    setBudgetValue(resolvedCase.budget?.value ? resolvedCase.budget.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '')
    setBudgetNotes(resolvedCase.budget?.notes ?? '')
    setContractNotes(resolvedCase.contract?.notes ?? '')
    setInstallationDate((resolvedCase.installation?.installedAt?.slice(0, 10) ?? nowIsoDate()) as `${number}-${number}-${number}`)
    setInstallationNote(resolvedCase.installation?.note ?? '')
    setInstallationDeliveredUpper('0')
    setInstallationDeliveredLower('0')
    setChangeEveryDaysInput(String(Math.max(1, Math.trunc(resolvedCase.changeEveryDays || 7))))
    setPlanningVersionNote('')
  }, [resolvedCase])

  useEffect(() => {
    setOptimisticTrays(null)
    setOptimisticActualChangeDates(null)
  }, [resolvedCase?.id, resolvedCase?.updatedAt])

  const pageState: PageState = !resolvedCase ? 'not_found' : (!isSupabaseMode && !scopedCases.some((item) => item.id === resolvedCase.id) ? 'forbidden' : 'ready')
  const openTrayModal = (tray: CaseTray) => {
    if (!canManageTray || !resolvedCase) return
    setSelectedTray(tray)
    setSelectedTrayState(tray.state)
    setReworkArch(resolvedCase.arch ?? 'ambos')
    setTrayNote(tray.notes ?? '')
  }

  const canApprovePlanning = currentUser?.role === 'dentist_admin' || currentUser?.role === 'dentist_client' || currentUser?.role === 'clinic_client'

  const handlePublishPlanningVersion = async () => {
    if (!resolvedCase) return
    const result = await publishPlanningVersion.execute({
      caseId: resolvedCase.id,
      note: planningVersionNote,
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'Planejamento', message: result.error })
      return
    }
    setPlanningVersionNote('')
    addToast({ type: 'success', title: 'Nova versão publicada' })
    if (isSupabaseMode) refreshSupabase()
  }

  const handleApprovePlanningVersion = async (versionId: string) => {
    if (!resolvedCase) return
    const result = await approvePlanningVersion.execute({
      caseId: resolvedCase.id,
      versionId,
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'Planejamento', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Versao aprovada' })
    if (isSupabaseMode) refreshSupabase()
  }

  const actions = useCaseDetailActions({
    currentCase: resolvedCase,
    currentUser,
    isSupabaseMode,
    canWrite,
    canWriteLocalOnly,
    canManageTray,
    canDeleteCase,
    hasProductionOrder,
    hasDentistDelivery,
    hasUpperArch,
    hasLowerArch,
    totalUpper,
    totalLower,
    todayIso,
    budgetValue,
    budgetNotes,
    contractNotes,
    attachmentType,
    attachmentDate,
    attachmentNote,
    attachmentFile,
    installationDate,
    installationNote,
    installationDeliveredUpper,
    installationDeliveredLower,
    changeEveryDaysInput,
    trayState,
    trayNote,
    reworkArch,
    selectedTray,
    linkedLabItems,
    readyToDeliverPatient,
    deliveredToDentist,
    changeSchedule,
    nextReplacementDueDate,
    canConcludeTreatmentManually,
    displayCaseCode,
    clinicName,
    dentistLabel,
    requesterLabel,
    displayProductLabel,
    patientBirthDate: isSupabaseMode ? supabaseDetail.supabaseCaseRefs.patientBirthDate : (resolvedCase?.patientId ? db.patients.find((item) => item.id === resolvedCase.patientId)?.birthDate : undefined),
    patientDisplayName,
    patientWhatsapp,
    currentContractApprovedAt: resolvedCase?.contract?.approvedAt,
    registerTrayRework,
    updateCaseStatus,
    addCaseNote,
    addToast,
    navigate: (to, options) => navigate(to, options),
    refreshSupabase,
    setOptimisticTrays,
    setOptimisticActualChangeDates,
    setSelectedTray,
    setAttachmentFile,
    setAttachmentNote,
    setAttachmentModalOpen,
  })

  return {
    pageState,
    breadcrumb: ['Início', 'Alinhadores', patientDisplayName || 'Caso'],
    currentCase: resolvedCase,
    displayTrays: displayedTrays,
    patientDisplayName,
    displayCaseCode,
    displayProductLabel,
    displayTreatmentOrigin,
    planningLine,
    clinicName,
    dentistLabel,
    requesterLabel,
    canWrite,
    canWriteLocalOnly,
    canManageTray,
    canReadLab,
    canDeleteCase,
    isAlignerCase,
    hasUpperArch,
    hasLowerArch,
    totalUpper,
    totalLower,
    progressUpper,
    progressLower,
    patientProgressUpper,
    patientProgressLower,
    headerProgressCards,
    headerSummaryLines,
    updatedAtLabel: resolvedCase ? formatPtBrDateTime(resolvedCase.updatedAt) : '-',
    statusLabel: resolvedCase ? caseStatusLabelMap[resolvedCase.status] : '-',
    statusTone: resolvedCase ? caseStatusToneMap[resolvedCase.status] : 'neutral',
    patientPortalAccessCode,
    canSharePatientPortalAccess: Boolean(patientPortalWhatsappHref),
    sharePatientPortalAccess: () => {
      if (!patientPortalWhatsappHref) {
        addToast({ type: 'error', title: 'Acesso do paciente', message: 'Cadastre um WhatsApp válido e um código de tratamento para compartilhar.' })
        return
      }
      window.open(patientPortalWhatsappHref, '_blank', 'noopener,noreferrer')
    },
    canConcludeTreatmentManually,
    groupedScanFiles,
    timelineEntries: timelineEntries ?? [],
    linkedLabItems,
    patientPortalPhotosByTray,
    downloadPatientPortalPhoto: async (input: { trayNumber: number; previewUrl?: string; filePath?: string; fileName?: string }) => {
      const fallbackName = input.fileName?.trim() || `foto-alinhador-${input.trayNumber}.jpg`
      const triggerDownload = (url: string) => {
        const link = document.createElement('a')
        link.href = url
        link.download = fallbackName
        link.target = '_blank'
        document.body.appendChild(link)
        link.click()
        link.remove()
      }

      if (input.filePath) {
        const downloaded = await downloadBlob(input.filePath)
        if (downloaded.ok) {
          const blobUrl = URL.createObjectURL(downloaded.blob)
          triggerDownload(blobUrl)
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2_000)
          return
        }
      }

      if (input.previewUrl) {
        triggerDownload(input.previewUrl)
        return
      }

      addToast({ type: 'error', title: 'Foto do paciente', message: 'Não foi possível baixar a foto deste alinhador.' })
    },
    actualChangeDateUpperByTray,
    actualChangeDateLowerByTray,
    readyToDeliverPatient,
    replacementSummary,
    installationDate,
    installationNote,
    installationDeliveredUpper,
    installationDeliveredLower,
    setInstallationDate,
    setInstallationNote,
    setInstallationDeliveredUpper,
    setInstallationDeliveredLower,
    replenishmentAlerts,
    nextTrayRequired,
    maxPlannedTrays,
    nextReplacementDueDate,
    changeEveryDaysInput,
    setChangeEveryDaysInput,
    budgetValue,
    budgetNotes,
    contractNotes,
    setBudgetValue: (value: string) => setBudgetValue(formatBrlCurrencyInput(value)),
    setBudgetNotes,
    setContractNotes,
    hasProductionOrder,
    hasDentistDelivery,
    currentContractStatus: resolvedCase?.contract?.status,
    currentContractApprovedAtLabel: resolvedCase?.contract?.approvedAt ? formatPtBrDateTime(resolvedCase.contract.approvedAt) : undefined,
    planningVersions: resolvedCase?.planningVersions ?? [],
    financial: resolvedCase?.financial,
    planningVersionNote,
    setPlanningVersionNote,
    canApprovePlanning,
    publishPlanningVersion: handlePublishPlanningVersion,
    approvePlanningVersion: handleApprovePlanningVersion,
    labSummary,
    todayIso,
    changeSchedule,
    patientWhatsapp,
    dentistDeliveryDateUpperByTray: dentistDeliveryDateByArchTray.upper,
    dentistDeliveryDateLowerByTray: dentistDeliveryDateByArchTray.lower,
    manualChangeCompletionUpperByTray,
    manualChangeCompletionLowerByTray,
    selectedTray,
    trayState,
    reworkArch,
    trayNote,
    setSelectedTray: (value: CaseTray | null) => setSelectedTray(value),
    setSelectedTrayState,
    setReworkArch,
    setTrayNote,
    openTrayModal,
    selectedTrayHasLinkedLabItem: Boolean(selectedTray && linkedLabItems.some((item) => item.trayNumber === selectedTray.trayNumber)),
    attachmentModalOpen,
    attachmentType,
    attachmentNote,
    attachmentDate,
    attachmentFile,
    setAttachmentModalOpen,
    setAttachmentType,
    setAttachmentNote,
    setAttachmentDate,
    setAttachmentFile,
    goBack: () => navigate('/app/cases'),
    navigateToLabBank: () => navigate(`/app/lab?tab=banco_restante&caseId=${resolvedCase?.id ?? ''}`),
    ...actions,
  }
}
