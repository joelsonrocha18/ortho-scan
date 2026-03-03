import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../app/ToastProvider'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import ImageCaptureInput from '../components/files/ImageCaptureInput'
import Input from '../components/Input'
import { addAttachment, clearCaseScanFileError, deleteCase, getCase, handleRework as handleCaseRework, markCaseScanFileError, registerCaseInstallation, setTrayState, updateCase } from '../data/caseRepo'
import { addLabItem, generateLabOrder } from '../data/labRepo'
import { DATA_MODE } from '../data/dataMode'
import { ensureReplacementBankForCase } from '../data/replacementBankRepo'
import { getCaseSupplySummary, getReplenishmentAlerts } from '../domain/replenishment'
import AppShell from '../layouts/AppShell'
import { slotLabel as getPhotoSlotLabel } from '../lib/photoSlots'
import type { Case, CasePhase, CaseTray, TrayState } from '../types/Case'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { listCasesForUser } from '../auth/scope'
import { supabase } from '../lib/supabaseClient'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { deleteCaseSupabase, generateCaseLabOrderSupabase, listCaseLabItemsSupabase, patchCaseDataSupabase } from '../repo/profileRepo'
import type { LabItem } from '../types/Lab'
import { isAlignerProductType, normalizeProductType, PRODUCT_TYPE_LABEL } from '../types/Product'

const phaseLabelMap: Record<CasePhase, string> = {
  planejamento: 'Planejamento',
  orcamento: 'Orcamento',
  contrato_pendente: 'Contrato pendente',
  contrato_aprovado: 'Contrato aprovado',
  em_producao: 'Em producao',
  finalizado: 'Finalizado',
}

const phaseToneMap: Record<CasePhase, 'neutral' | 'info' | 'success'> = {
  planejamento: 'neutral',
  orcamento: 'neutral',
  contrato_pendente: 'neutral',
  contrato_aprovado: 'info',
  em_producao: 'info',
  finalizado: 'success',
}

const trayStateClasses: Record<TrayState, string> = {
  pendente: 'bg-slate-100 text-slate-700',
  em_producao: 'bg-blue-100 text-blue-700',
  pronta: 'bg-brand-500 text-white',
  entregue: 'bg-emerald-100 text-emerald-700',
  rework: 'bg-red-100 text-red-700',
}

const archLabelMap: Record<'superior' | 'inferior' | 'ambos', string> = {
  superior: 'Superior',
  inferior: 'Inferior',
  ambos: 'Ambos',
}

const scanArchLabelMap: Record<'superior' | 'inferior' | 'mordida', string> = {
  superior: 'Superior',
  inferior: 'Inferior',
  mordida: 'Mordida',
}

function caseProgress(total: number, delivered: number) {
  const safeDelivered = Math.max(0, Math.min(delivered, total))
  const safeTotal = Math.max(0, total)
  return { delivered: safeDelivered, total: safeTotal, percent: safeTotal > 0 ? Math.round((safeDelivered / safeTotal) * 100) : 0 }
}

function addDays(baseIsoDate: string, days: number) {
  const base = new Date(`${baseIsoDate}T00:00:00`)
  base.setDate(base.getDate() + days)
  return base.toISOString().slice(0, 10)
}

function deliveredToDentistByArch(caseItem: Case | null) {
  if (!caseItem) return { upper: 0, lower: 0 }
  return (caseItem.deliveryLots ?? []).reduce(
    (acc, lot) => {
      const qty = Math.max(0, Math.trunc(lot.quantity ?? 0))
      if (lot.arch === 'superior') acc.upper += qty
      if (lot.arch === 'inferior') acc.lower += qty
      if (lot.arch === 'ambos') {
        acc.upper += qty
        acc.lower += qty
      }
      return acc
    },
    { upper: 0, lower: 0 },
  )
}

function scheduleStateForTray(
  trayNumber: number,
  maxForArch: number,
  deliveredCount: number,
  trays: CaseTray[],
): TrayState | 'nao_aplica' {
  if (trayNumber > maxForArch) return 'nao_aplica'
  const tray = trays.find((item) => item.trayNumber === trayNumber)
  // Rework sempre prevalece na visao da esteira/tabela.
  if (tray?.state === 'rework') return 'rework'
  if (trayNumber <= deliveredCount) return 'entregue'
  if (!tray) return 'pendente'
  // "entregue" no tray representa entrega ao profissional/LAB.
  // No contexto do paciente, so conta "entregue" pelo deliveredCount.
  if (tray.state === 'entregue') return 'pendente'
  return tray.state
}

function scheduleStateLabel(state: TrayState | 'nao_aplica') {
  if (state === 'nao_aplica') return '-'
  if (state === 'em_producao') return 'Em producao'
  if (state === 'pronta') return 'Pronta'
  if (state === 'entregue') return 'Entregue'
  if (state === 'rework') return 'Rework'
  return 'Pendente'
}

function scheduleStateClass(state: TrayState | 'nao_aplica') {
  if (state === 'nao_aplica') return 'text-slate-400'
  if (state === 'em_producao') return 'text-blue-700'
  if (state === 'pronta') return 'text-emerald-700'
  if (state === 'entregue') return 'text-emerald-700'
  if (state === 'rework') return 'text-red-700'
  return 'text-slate-700'
}

function timelineStateForTray(
  tray: CaseTray,
  deliveredUpper: number,
  deliveredLower: number,
): TrayState {
  if (tray.state === 'rework') return 'rework'
  const deliveredCount =
    deliveredUpper > 0 && deliveredLower > 0
      ? Math.max(0, Math.min(deliveredUpper, deliveredLower))
      : Math.max(deliveredUpper, deliveredLower, 0)
  if (tray.trayNumber <= deliveredCount) return 'entregue'
  if (tray.state === 'entregue') return 'pendente'
  return tray.state
}

function hasRevisionSuffix(code?: string) {
  return /\/\d+$/.test(code ?? '')
}

function isReworkProductionLabItem(item: { requestKind?: string; notes?: string }) {
  return (item.requestKind ?? 'producao') === 'producao' && (item.notes ?? '').toLowerCase().includes('rework')
}

function buildChangeSchedule(
  installedAt: string | undefined,
  changeEveryDays: number,
  totalUpper: number,
  totalLower: number,
  deliveredUpper: number,
  deliveredLower: number,
  trays: CaseTray[],
  actualChangeDateByTray: Map<number, string>,
): Array<{ trayNumber: number; changeDate: string; actualChangeDate?: string; superiorState: TrayState | 'nao_aplica'; inferiorState: TrayState | 'nao_aplica' }> {
  if (!installedAt) return []
  const max = Math.max(totalUpper, totalLower)
  const schedule: Array<{ trayNumber: number; changeDate: string; actualChangeDate?: string; superiorState: TrayState | 'nao_aplica'; inferiorState: TrayState | 'nao_aplica' }> = []
  let nextPlannedDate = installedAt
  for (let index = 0; index < max; index += 1) {
    const trayNumber = index + 1
    if (trayNumber > 1) {
      nextPlannedDate = addDays(nextPlannedDate, changeEveryDays)
    }
    const actualChangeDate = actualChangeDateByTray.get(trayNumber)
    if (actualChangeDate) {
      nextPlannedDate = actualChangeDate
    }
    schedule.push({
      trayNumber,
      changeDate: nextPlannedDate,
      actualChangeDate,
      superiorState: scheduleStateForTray(trayNumber, totalUpper, deliveredUpper, trays),
      inferiorState: scheduleStateForTray(trayNumber, totalLower, deliveredLower, trays),
    })
  }
  return schedule
}

function fileAvailability(item: NonNullable<Case['scanFiles']>[number]) {
  if (item.isLocal && item.url) return { label: 'Abrir', url: item.url }
  if (item.isLocal && !item.url) return { label: 'arquivo local (reenvie para abrir)' }
  if (item.url) return { label: 'Abrir', url: item.url }
  return { label: 'arquivo local (reenvie para abrir)' }
}

function slotLabel(slotId?: string) {
  return getPhotoSlotLabel(slotId)
}

function formatBrlCurrencyInput(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  const value = Number(digits) / 100
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function parseBrlCurrencyInput(raw: string) {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return 0
  return Number(digits) / 100
}

function mapSupabaseCaseRowToCase(row: { id: string; product_type?: string; product_id?: string; data?: Record<string, unknown> }): Case {
  const data = row.data ?? {}
  const now = new Date().toISOString()
  const status = (data.status as Case['status'] | undefined) ?? 'planejamento'
  const phase = (data.phase as CasePhase | undefined) ?? 'planejamento'
  return {
    id: row.id,
    productType: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
    productId: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
    treatmentCode: data.treatmentCode as string | undefined,
    treatmentOrigin: data.treatmentOrigin as Case['treatmentOrigin'] | undefined,
    patientName: (data.patientName as string | undefined) ?? '-',
    patientId: data.patientId as string | undefined,
    dentistId: data.dentistId as string | undefined,
    requestedByDentistId: data.requestedByDentistId as string | undefined,
    clinicId: data.clinicId as string | undefined,
    scanDate: (data.scanDate as string | undefined) ?? now.slice(0, 10),
    totalTrays: (data.totalTrays as number | undefined) ?? 0,
    changeEveryDays: (data.changeEveryDays as number | undefined) ?? 7,
    totalTraysUpper: data.totalTraysUpper as number | undefined,
    totalTraysLower: data.totalTraysLower as number | undefined,
    attachmentBondingTray: data.attachmentBondingTray as boolean | undefined,
    status,
    phase,
    budget: data.budget as Case['budget'] | undefined,
    contract: data.contract as Case['contract'] | undefined,
    deliveryLots: (data.deliveryLots as Case['deliveryLots']) ?? [],
    installation: data.installation as Case['installation'] | undefined,
    trays: (data.trays as CaseTray[] | undefined) ?? [],
    attachments: (data.attachments as Case['attachments']) ?? [],
    sourceScanId: data.sourceScanId as string | undefined,
    arch: data.arch as Case['arch'] | undefined,
    complaint: data.complaint as string | undefined,
    dentistGuidance: data.dentistGuidance as string | undefined,
    scanFiles: data.scanFiles as Case['scanFiles'] | undefined,
    createdAt: (data.createdAt as string | undefined) ?? now,
    updatedAt: (data.updatedAt as string | undefined) ?? now,
  }
}

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
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
  const [installationDate, setInstallationDate] = useState(new Date().toISOString().slice(0, 10))
  const [installationNote, setInstallationNote] = useState('')
  const [installationDeliveredUpper, setInstallationDeliveredUpper] = useState('0')
  const [installationDeliveredLower, setInstallationDeliveredLower] = useState('0')
  const [changeEveryDaysInput, setChangeEveryDaysInput] = useState('7')
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false)
  const [attachmentType, setAttachmentType] = useState<'imagem' | 'documento' | 'outro'>('imagem')
  const [attachmentNote, setAttachmentNote] = useState('')
  const [attachmentDate, setAttachmentDate] = useState(new Date().toISOString().slice(0, 10))
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const initializedCaseIdRef = useRef<string | null>(null)
  const [supabaseCase, setSupabaseCase] = useState<Case | null>(null)
  const [supabaseLabItems, setSupabaseLabItems] = useState<LabItem[]>([])
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()

  useEffect(() => {
    if (!isSupabaseMode || !supabase || !params.id) {
      setSupabaseCase(null)
      return
    }
    let active = true
    void (async () => {
      const { data } = await supabase
        .from('cases')
        .select('id, product_type, product_id, data, deleted_at')
        .eq('id', params.id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!active) return
      if (!data) {
        setSupabaseCase(null)
        return
      }
      setSupabaseCase(mapSupabaseCaseRowToCase(data as { id: string; product_type?: string; product_id?: string; data?: Record<string, unknown> }))
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, params.id, supabaseRefreshKey, supabaseSyncTick])

  useEffect(() => {
    if (!isSupabaseMode || !params.id) {
      setSupabaseLabItems([])
      return
    }
    let active = true
    void listCaseLabItemsSupabase(params.id).then((items) => {
      if (!active) return
      setSupabaseLabItems(items)
    })
    return () => {
      active = false
    }
  }, [isSupabaseMode, params.id, supabaseRefreshKey, supabaseSyncTick])

  const currentCase = useMemo(
    () => (isSupabaseMode ? supabaseCase : params.id ? db.cases.find((item) => item.id === params.id) ?? null : null),
    [isSupabaseMode, supabaseCase, params.id, db.cases],
  )
  const isAlignerCase = useMemo(
    () => (currentCase ? isAlignerProductType(normalizeProductType(currentCase.productId ?? currentCase.productType)) : false),
    [currentCase],
  )
  const scopedCases = useMemo(() => listCasesForUser(db, currentUser), [db, currentUser])

  const totalUpper = useMemo(() => {
    if (!currentCase) return 0
    if (currentCase.arch === 'inferior') return 0
    if (typeof currentCase.totalTraysUpper === 'number') return Math.max(0, currentCase.totalTraysUpper)
    if (typeof currentCase.totalTraysLower === 'number') return 0
    return Math.max(0, currentCase.totalTrays)
  }, [currentCase])
  const totalLower = useMemo(() => {
    if (!currentCase) return 0
    if (currentCase.arch === 'superior') return 0
    if (typeof currentCase.totalTraysLower === 'number') return Math.max(0, currentCase.totalTraysLower)
    if (typeof currentCase.totalTraysUpper === 'number') return 0
    return Math.max(0, currentCase.totalTrays)
  }, [currentCase])
  const hasUpperArch = totalUpper > 0
  const hasLowerArch = totalLower > 0
  const deliveredUpper = currentCase?.installation?.deliveredUpper ?? 0
  const deliveredLower = currentCase?.installation?.deliveredLower ?? 0
  const deliveredToDentist = useMemo(() => deliveredToDentistByArch(currentCase), [currentCase])
  const readyToDeliverPatient = useMemo(
    () => ({
      upper: Math.max(
        0,
        deliveredToDentist.upper - deliveredUpper,
      ),
      lower: Math.max(
        0,
        deliveredToDentist.lower - deliveredLower,
      ),
    }),
    [deliveredLower, deliveredToDentist.lower, deliveredToDentist.upper, deliveredUpper],
  )
  const actualChangeDateByTray = useMemo(() => {
    const map = new Map<number, string>()
    ;(currentCase?.installation?.actualChangeDates ?? []).forEach((entry) => {
      if (entry.trayNumber > 0 && entry.changedAt) {
        map.set(entry.trayNumber, entry.changedAt)
      }
    })
    return map
  }, [currentCase])
  const dentistDeliveryDateByTray = useMemo(() => {
    const map = new Map<number, string>()
    const lots = [...(currentCase?.deliveryLots ?? [])].sort((a, b) => {
      const aDate = (a.deliveredToDoctorAt ?? '').trim()
      const bDate = (b.deliveredToDoctorAt ?? '').trim()
      return aDate.localeCompare(bDate)
    })
    lots.forEach((lot) => {
      const appliesUpper = lot.arch === 'superior' || lot.arch === 'ambos'
      const appliesLower = lot.arch === 'inferior' || lot.arch === 'ambos'
      if ((hasUpperArch && !appliesUpper) && (hasLowerArch && !appliesLower)) return
      for (let tray = lot.fromTray; tray <= lot.toTray; tray += 1) {
        if (!map.has(tray)) {
          map.set(tray, lot.deliveredToDoctorAt)
        }
      }
    })
    return map
  }, [currentCase, hasLowerArch, hasUpperArch])
  const manualChangeCompletionByTray = useMemo(() => {
    const map = new Map<number, boolean>()
    ;(currentCase?.installation?.manualChangeCompletion ?? []).forEach((entry) => {
      if (entry.trayNumber > 0) map.set(entry.trayNumber, Boolean(entry.completed))
    })
    return map
  }, [currentCase])
  const progressUpper = useMemo(() => caseProgress(totalUpper, deliveredUpper), [deliveredUpper, totalUpper])
  const progressLower = useMemo(() => caseProgress(totalLower, deliveredLower), [deliveredLower, totalLower])
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const changeSchedule = useMemo(
    () =>
      currentCase
        ? buildChangeSchedule(
            currentCase.installation?.installedAt,
            currentCase.changeEveryDays,
            totalUpper,
            totalLower,
            progressUpper.delivered,
            progressLower.delivered,
            currentCase.trays,
            actualChangeDateByTray,
          )
        : [],
    [actualChangeDateByTray, currentCase, progressLower.delivered, progressUpper.delivered, totalLower, totalUpper],
  )
  const patientProgressUpper = useMemo(() => {
    const eligibleByDate = changeSchedule.filter((row) => row.trayNumber <= totalUpper && row.changeDate <= todayIso).length
    const progressed = Math.min(eligibleByDate, Math.max(0, Math.trunc(deliveredUpper)))
    return caseProgress(totalUpper, progressed)
  }, [changeSchedule, deliveredUpper, todayIso, totalUpper])
  const patientProgressLower = useMemo(() => {
    const eligibleByDate = changeSchedule.filter((row) => row.trayNumber <= totalLower && row.changeDate <= todayIso).length
    const progressed = Math.min(eligibleByDate, Math.max(0, Math.trunc(deliveredLower)))
    return caseProgress(totalLower, progressed)
  }, [changeSchedule, deliveredLower, todayIso, totalLower])
  const linkedLabItems = useMemo(
    () => (currentCase ? (isSupabaseMode ? supabaseLabItems : db.labItems.filter((item) => item.caseId === currentCase.id)) : []),
    [currentCase, isSupabaseMode, supabaseLabItems, db.labItems],
  )
  const deliveredToProfessionalByTray = useMemo(() => {
    const map = new Map<number, number>()
    ;(currentCase?.deliveryLots ?? []).forEach((lot) => {
      for (let tray = lot.fromTray; tray <= lot.toTray; tray += 1) {
        map.set(tray, (map.get(tray) ?? 0) + 1)
      }
    })
    return map
  }, [currentCase])
  const readyLabItems = useMemo(
    () =>
      linkedLabItems.filter((item) => {
        if (item.status !== 'prontas') return false
        const tray = currentCase?.trays.find((row) => row.trayNumber === item.trayNumber)
        const isRework = item.requestKind === 'reconfeccao' || isReworkProductionLabItem(item)
        if (isRework) {
          return tray?.state === 'rework' || tray?.state === 'pronta' || tray?.state === 'entregue'
        }
        return tray?.state === 'pronta'
      }),
    [currentCase, linkedLabItems],
  )
  const deliveredLabItemIds = useMemo(
    () =>
      new Set(
        linkedLabItems
          .filter((item) => {
            if (item.status !== 'prontas') return false
            if (readyLabItems.some((row) => row.id === item.id)) return false
            const hasAnyDelivery = (currentCase?.deliveryLots?.length ?? 0) > 0
            if ((item.requestKind ?? 'producao') === 'producao' && hasAnyDelivery && !hasRevisionSuffix(item.requestCode)) {
              return true
            }
            const tray = currentCase?.trays.find((row) => row.trayNumber === item.trayNumber)
            return tray?.state === 'entregue' || (deliveredToProfessionalByTray.get(item.trayNumber) ?? 0) > 0
          })
          .map((item) => item.id),
      ),
    [currentCase, deliveredToProfessionalByTray, linkedLabItems, readyLabItems],
  )
  const pipelineLabItems = useMemo(
    () =>
      linkedLabItems.filter((item) => !deliveredLabItemIds.has(item.id) && item.requestKind !== 'reconfeccao'),
    [deliveredLabItemIds, linkedLabItems],
  )
  const inProductionCount = useMemo(
    () => pipelineLabItems.filter((item) => item.status === 'em_producao' || item.status === 'controle_qualidade').length,
    [pipelineLabItems],
  )
  const readyCount = useMemo(
    () => readyLabItems.length,
    [readyLabItems],
  )
  const hasProductionOrder = useMemo(
    () => linkedLabItems.some((item) => (item.requestKind ?? 'producao') === 'producao'),
    [linkedLabItems],
  )
  const hasDentistDelivery = useMemo(
    () => (currentCase?.deliveryLots?.length ?? 0) > 0,
    [currentCase],
  )
  const labSummary = useMemo(
    () => ({
      aguardando_iniciar: pipelineLabItems.filter((item) => item.status === 'aguardando_iniciar').length,
      em_producao: pipelineLabItems.filter((item) => item.status === 'em_producao').length,
      controle_qualidade: pipelineLabItems.filter((item) => item.status === 'controle_qualidade').length,
      prontas: readyLabItems.length,
      entregues: deliveredLabItemIds.size,
      osItens: linkedLabItems.length,
    }),
    [deliveredLabItemIds.size, linkedLabItems.length, pipelineLabItems, readyLabItems.length],
  )
  const replacementSummary = useMemo(() => {
    if (!currentCase) {
      return { totalContratado: 0, entreguePaciente: 0, saldoRestante: 0, rework: 0, defeituosa: 0 }
    }
    const totalContratado = Math.max(0, totalUpper + totalLower)
    const entreguePaciente = Math.max(0, Math.trunc(deliveredUpper)) + Math.max(0, Math.trunc(deliveredLower))
    const saldoRestante = Math.max(0, totalContratado - entreguePaciente)
    return { totalContratado, entreguePaciente, saldoRestante, rework: 0, defeituosa: 0 }
  }, [currentCase, deliveredLower, deliveredUpper, totalLower, totalUpper])
  const groupedScanFiles = useMemo(() => {
    const scanFiles = currentCase?.scanFiles ?? []
    const scan3d = {
      superior: scanFiles.filter((item) => item.kind === 'scan3d' && item.arch === 'superior'),
      inferior: scanFiles.filter((item) => item.kind === 'scan3d' && item.arch === 'inferior'),
      mordida: scanFiles.filter((item) => item.kind === 'scan3d' && item.arch === 'mordida'),
    }
    const fotosIntra = scanFiles
      .filter((item) => item.kind === 'foto_intra')
      .sort((a, b) => slotLabel(a.slotId).localeCompare(slotLabel(b.slotId)))
    const fotosExtra = scanFiles
      .filter((item) => item.kind === 'foto_extra')
      .sort((a, b) => slotLabel(a.slotId).localeCompare(slotLabel(b.slotId)))
    const radiografias = {
      panoramica: scanFiles.filter((item) => item.rxType === 'panoramica'),
      teleradiografia: scanFiles.filter((item) => item.rxType === 'teleradiografia'),
      tomografia: scanFiles.filter((item) => item.rxType === 'tomografia' || item.kind === 'dicom'),
    }
    const planejamento = scanFiles.filter((item) => item.kind === 'projeto')
    return { scan3d, fotosIntra, fotosExtra, radiografias, planejamento }
  }, [currentCase])
  const supplySummary = useMemo(() => (currentCase ? getCaseSupplySummary(currentCase) : null), [currentCase])
  const replenishmentAlerts = useMemo(() => (currentCase ? getReplenishmentAlerts(currentCase) : []), [currentCase])
  const patientDisplayName = useMemo(() => {
    if (!currentCase) return ''
    if (!currentCase.patientId) return currentCase.patientName
    return db.patients.find((item) => item.id === currentCase.patientId)?.name ?? currentCase.patientName
  }, [currentCase, db.patients])
  const dentistsById = useMemo(() => new Map(db.dentists.map((item) => [item.id, item])), [db.dentists])
  const clinicsById = useMemo(() => new Map(db.clinics.map((item) => [item.id, item])), [db.clinics])
  const clinicName = currentCase?.clinicId ? clinicsById.get(currentCase.clinicId)?.tradeName : undefined
  const dentist = currentCase?.dentistId ? dentistsById.get(currentCase.dentistId) : undefined
  const requester = currentCase?.requestedByDentistId ? dentistsById.get(currentCase.requestedByDentistId) : undefined
  const dentistPrefix = dentist?.gender === 'feminino' ? 'Dra.' : dentist ? 'Dr.' : ''
  const requesterPrefix = requester?.gender === 'feminino' ? 'Dra.' : requester ? 'Dr.' : ''

  const removeTrayFromDeliveryLots = (
    lots: NonNullable<Case['deliveryLots']>,
    trayNumber: number,
    reworkArc: 'superior' | 'inferior' | 'ambos',
  ) => {
    const shouldAffect = (arch: 'superior' | 'inferior' | 'ambos') => {
      if (reworkArc === 'ambos') return true
      if (arch === 'ambos') return false
      return arch === reworkArc
    }
    const next: NonNullable<Case['deliveryLots']> = []
    lots.forEach((lot) => {
      if (!shouldAffect(lot.arch) || trayNumber < lot.fromTray || trayNumber > lot.toTray) {
        next.push(lot)
        return
      }
      const leftQty = Math.max(0, trayNumber - lot.fromTray)
      const rightQty = Math.max(0, lot.toTray - trayNumber)
      if (leftQty > 0) {
        next.push({
          ...lot,
          id: `${lot.id}_l_${trayNumber}`,
          fromTray: lot.fromTray,
          toTray: trayNumber - 1,
          quantity: leftQty,
        })
      }
      if (rightQty > 0) {
        next.push({
          ...lot,
          id: `${lot.id}_r_${trayNumber}`,
          fromTray: trayNumber + 1,
          toTray: lot.toTray,
          quantity: rightQty,
        })
      }
    })
    return next
  }

  useEffect(() => {
    if (!currentCase) {
      initializedCaseIdRef.current = null
      return
    }
    if (initializedCaseIdRef.current === currentCase.id) return
    initializedCaseIdRef.current = currentCase.id
    setBudgetValue(
      currentCase.budget?.value
        ? currentCase.budget.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '',
    )
    setBudgetNotes(currentCase.budget?.notes ?? '')
    setContractNotes(currentCase.contract?.notes ?? '')
    setInstallationDate(currentCase.installation?.installedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
    setInstallationNote(currentCase.installation?.note ?? '')
    setInstallationDeliveredUpper('0')
    setInstallationDeliveredLower('0')
    setChangeEveryDaysInput(String(Math.max(1, Math.trunc(currentCase.changeEveryDays || 7))))
  }, [currentCase])

  if (!currentCase) {
    return (
      <AppShell breadcrumb={['Inicio', 'Alinhadores']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Pedido nao encontrado</h1>
          <p className="mt-2 text-sm text-slate-500">O pedido solicitado nao existe ou foi removido.</p>
          <Button className="mt-4" onClick={() => navigate('/app/cases')}>
            Voltar
          </Button>
        </Card>
      </AppShell>
    )
  }

  if (!isSupabaseMode && !scopedCases.some((item) => item.id === currentCase.id)) {
    return (
      <AppShell breadcrumb={['Inicio', 'Alinhadores']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Sem acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Seu perfil nao permite visualizar este pedido.</p>
          <Button className="mt-4" onClick={() => navigate('/app/cases')}>
            Voltar
          </Button>
        </Card>
      </AppShell>
    )
  }

  const openTrayModal = (tray: CaseTray) => {
    if (!canManageTray) return
    setSelectedTray(tray)
    setSelectedTrayState(tray.state)
    setReworkArch(currentCase.arch ?? 'ambos')
    setTrayNote(tray.notes ?? '')
  }

  const saveTrayChanges = async () => {
    if (!canManageTray) return
    if (!selectedTray) {
      return
    }

    const trayInCase = currentCase.trays.find((item) => item.trayNumber === selectedTray.trayNumber)
    if (!trayInCase) {
      return
    }

    if (isSupabaseMode) {
      const nextTrays = currentCase.trays.map((item) =>
        item.trayNumber === selectedTray.trayNumber
          ? { ...item, state: trayState, notes: trayNote.trim() || undefined }
          : item,
      )
      const nextPatch: Record<string, unknown> = { trays: nextTrays }

      if (trayState === 'rework' && trayInCase.state !== 'rework' && supabase) {
        const hasOpenRework = linkedLabItems.some(
          (item) => item.trayNumber === selectedTray.trayNumber && item.requestKind === 'reconfeccao' && item.status !== 'prontas',
        )
        const hasOpenReworkProduction = linkedLabItems.some(
          (item) =>
            item.trayNumber === selectedTray.trayNumber &&
            (item.requestKind ?? 'producao') === 'producao' &&
            (item.notes ?? '').toLowerCase().includes('rework') &&
            item.status !== 'prontas',
        )
        const today = new Date().toISOString().slice(0, 10)
        const reworkReason = trayNote.trim().length > 0
          ? trayNote.trim()
          : `Rework solicitado via timeline da placa #${selectedTray.trayNumber}.`
        const productType = currentCase.productId ?? currentCase.productType ?? 'alinhador_12m'

        if (!hasOpenRework) {
          const { error } = await supabase.from('lab_items').insert({
            case_id: currentCase.id,
            tray_number: selectedTray.trayNumber,
            status: 'aguardando_iniciar',
            priority: 'Urgente',
            notes: reworkReason,
            product_type: productType,
            product_id: productType,
            data: {
              requestKind: 'reconfeccao',
              arch: reworkArch,
              plannedUpperQty: 0,
              plannedLowerQty: 0,
              patientName: currentCase.patientName,
              trayNumber: selectedTray.trayNumber,
              plannedDate: today,
              dueDate: trayInCase.dueDate ?? today,
              status: 'aguardando_iniciar',
            },
          })
          if (error) {
            addToast({ type: 'error', title: 'Rework', message: error.message })
            return
          }
        }
        if (!hasOpenReworkProduction) {
          const { error } = await supabase.from('lab_items').insert({
            case_id: currentCase.id,
            tray_number: selectedTray.trayNumber,
            status: 'aguardando_iniciar',
            priority: 'Urgente',
            notes: `OS de producao para rework da placa #${selectedTray.trayNumber}. Motivo: ${reworkReason}`,
            product_type: productType,
            product_id: productType,
            data: {
              requestKind: 'producao',
              arch: reworkArch,
              plannedUpperQty: 0,
              plannedLowerQty: 0,
              patientName: currentCase.patientName,
              trayNumber: selectedTray.trayNumber,
              plannedDate: today,
              dueDate: trayInCase.dueDate ?? today,
              status: 'aguardando_iniciar',
            },
          })
          if (error) {
            addToast({ type: 'error', title: 'Rework', message: error.message })
            return
          }
        }

        const nextLots = removeTrayFromDeliveryLots(currentCase.deliveryLots ?? [], selectedTray.trayNumber, reworkArch)
        let nextInstallation = currentCase.installation
        if (currentCase.installation) {
          const currentUpper = currentCase.installation.deliveredUpper ?? 0
          const currentLower = currentCase.installation.deliveredLower ?? 0
          const affectUpper = (reworkArch === 'superior' || reworkArch === 'ambos') && selectedTray.trayNumber <= currentUpper
          const affectLower = (reworkArch === 'inferior' || reworkArch === 'ambos') && selectedTray.trayNumber <= currentLower
          nextInstallation = {
            ...currentCase.installation,
            deliveredUpper: Math.max(0, currentUpper - (affectUpper ? 1 : 0)),
            deliveredLower: Math.max(0, currentLower - (affectLower ? 1 : 0)),
          }
        }
        nextPatch.deliveryLots = nextLots
        nextPatch.installation = nextInstallation
      }

      const result = await patchCaseDataSupabase(currentCase.id, nextPatch)
      if (!result.ok) {
        addToast({ type: 'error', title: 'Placa', message: result.error })
        return
      }
      setSupabaseRefreshKey((current) => current + 1)
      addToast({ type: 'success', title: 'Placa atualizada' })
      setSelectedTray(null)
      return
    }

    if (trayState !== trayInCase.state) {
      const stateResult = setTrayState(currentCase.id, selectedTray.trayNumber, trayState)
      if (!stateResult.ok) {
        addToast({ type: 'error', title: 'Erro ao atualizar placa', message: stateResult.error })
        return
      }

      if (trayState === 'rework' && trayInCase.state !== 'rework') {
        const hasOpenRework = linkedLabItems.some(
          (item) => item.trayNumber === selectedTray.trayNumber && item.requestKind === 'reconfeccao' && item.status !== 'prontas',
        )
        const hasOpenReworkProduction = linkedLabItems.some(
          (item) =>
            item.trayNumber === selectedTray.trayNumber &&
            (item.requestKind ?? 'producao') === 'producao' &&
            (item.notes ?? '').toLowerCase().includes('rework') &&
            item.status !== 'prontas',
        )
        const today = new Date().toISOString().slice(0, 10)
        const reasonText = trayNote.trim()
        const reworkReason = reasonText.length > 0
          ? reasonText
          : `Rework solicitado via timeline da placa #${selectedTray.trayNumber}.`

        if (!hasOpenRework) {
          const created = addLabItem({
            caseId: currentCase.id,
            productType: currentCase.productType ?? 'alinhador_12m',
            requestKind: 'reconfeccao',
            arch: reworkArch,
            plannedUpperQty: 0,
            plannedLowerQty: 0,
            patientName: currentCase.patientName,
            trayNumber: selectedTray.trayNumber,
            plannedDate: today,
            dueDate: trayInCase.dueDate ?? today,
            status: 'aguardando_iniciar',
            priority: 'Urgente',
            notes: reworkReason,
          })
          if (!created.ok) {
            addToast({ type: 'error', title: 'Reconfeccao', message: created.error })
            return
          }
          if (!created.sync.ok) {
            addToast({ type: 'error', title: 'Reconfeccao', message: created.sync.message })
            return
          }
        }

        if (!hasOpenReworkProduction) {
          const production = addLabItem({
            caseId: currentCase.id,
            productType: currentCase.productType ?? 'alinhador_12m',
            requestKind: 'producao',
            arch: reworkArch,
            plannedUpperQty: 0,
            plannedLowerQty: 0,
            patientName: currentCase.patientName,
            trayNumber: selectedTray.trayNumber,
            plannedDate: today,
            dueDate: trayInCase.dueDate ?? today,
            status: 'aguardando_iniciar',
            priority: 'Urgente',
            notes: `OS de produção para rework da placa #${selectedTray.trayNumber}. Motivo: ${reworkReason}`,
          })
          if (!production.ok) {
            addToast({ type: 'error', title: 'Rework', message: production.error })
            return
          }
          if (!production.sync.ok) {
            addToast({ type: 'error', title: 'Rework', message: production.sync.message })
            return
          }
        }

        if (!hasOpenRework || !hasOpenReworkProduction) {
          addToast({ type: 'success', title: 'OS de rework geradas', message: 'Reconfeccao e confecção adicionadas na esteira.' })
        }

        const reworkResult = handleCaseRework(currentCase.id, {
          trayNumber: selectedTray.trayNumber,
          arch: reworkArch,
        })
        if (!reworkResult.ok) {
          addToast({ type: 'error', title: 'Rework', message: 'Nao foi possivel devolver a placa ao banco.' })
          return
        }
      }
    }

    const latestCase = getCase(currentCase.id) ?? currentCase
    const nextTrays = latestCase.trays.map((item) =>
      item.trayNumber === selectedTray.trayNumber ? { ...item, notes: trayNote.trim() || undefined } : item,
    )
    updateCase(currentCase.id, { trays: nextTrays })
    addToast({ type: 'success', title: 'Placa atualizada' })
    setSelectedTray(null)
  }

  const handleAttachmentSave = () => {
    if (!canWriteLocalOnly) return
    if (!attachmentFile) {
      addToast({ type: 'error', title: 'Anexos', message: 'Selecione um arquivo.' })
      return
    }

    const objectUrl = URL.createObjectURL(attachmentFile)
    const result = addAttachment(currentCase.id, {
      name: attachmentFile.name,
      type: attachmentType === 'imagem' ? 'foto' : attachmentType === 'documento' ? 'scan' : 'outro',
      url: objectUrl,
      mime: attachmentFile.type,
      size: attachmentFile.size,
      isLocal: true,
      status: 'ok',
      attachedAt: attachmentDate,
      note: attachmentNote.trim() || undefined,
    })

    if (!result.ok) {
      addToast({ type: 'error', title: 'Anexos', message: result.error })
      return
    }

    setAttachmentFile(null)
    setAttachmentNote('')
    setAttachmentModalOpen(false)
    addToast({ type: 'success', title: 'Anexo adicionado' })
  }

  const concludePlanning = () => {
    if (!canWrite) return
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(currentCase.id, { phase: 'orcamento', status: 'planejamento' }, { status: 'planejamento', phase: 'orcamento' })
        if (!result.ok) {
          addToast({ type: 'error', title: 'Planejamento', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Planejamento concluido' })
      })()
      return
    }
    updateCase(currentCase.id, { phase: 'orcamento', status: 'planejamento' })
    addToast({ type: 'success', title: 'Planejamento concluido' })
  }

  const closeBudget = () => {
    if (!canWrite) return
    const parsed = parseBrlCurrencyInput(budgetValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      addToast({ type: 'error', title: 'Orcamento', message: 'Informe um valor valido para o orcamento.' })
      return
    }
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(
          currentCase.id,
          {
            phase: 'contrato_pendente',
            status: 'planejamento',
            budget: { value: parsed, notes: budgetNotes.trim() || undefined, createdAt: new Date().toISOString() },
            contract: { ...(currentCase.contract ?? { status: 'pendente' }), status: 'pendente', notes: contractNotes.trim() || undefined },
          },
          { status: 'planejamento', phase: 'contrato_pendente' },
        )
        if (!result.ok) {
          addToast({ type: 'error', title: 'Orcamento', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Orcamento fechado' })
      })()
      return
    }
    updateCase(currentCase.id, {
      phase: 'contrato_pendente',
      status: 'planejamento',
      budget: { value: parsed, notes: budgetNotes.trim() || undefined, createdAt: new Date().toISOString() },
      contract: { ...(currentCase.contract ?? { status: 'pendente' }), status: 'pendente', notes: contractNotes.trim() || undefined },
    })
    addToast({ type: 'success', title: 'Orcamento fechado' })
  }

  const approveContract = () => {
    if (!canWrite) return
    const approvedAt = new Date().toISOString()
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(
          currentCase.id,
          {
            phase: 'contrato_aprovado',
            status: 'planejamento',
            contract: { status: 'aprovado', approvedAt, notes: contractNotes.trim() || undefined },
          },
          { status: 'planejamento', phase: 'contrato_aprovado' },
        )
        if (!result.ok) {
          addToast({ type: 'error', title: 'Contrato', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Contrato aprovado', message: `Aprovado em ${new Date(approvedAt).toLocaleString('pt-BR')}` })
      })()
      return
    }
    updateCase(currentCase.id, {
      phase: 'contrato_aprovado',
      status: 'planejamento',
      contract: { status: 'aprovado', approvedAt, notes: contractNotes.trim() || undefined },
    })
    ensureReplacementBankForCase(currentCase.id)
    addToast({ type: 'success', title: 'Contrato aprovado', message: `Aprovado em ${new Date(approvedAt).toLocaleString('pt-BR')}` })
  }

  const handleDeleteCase = () => {
    if (!canDeleteCase) return
    const confirmed = window.confirm('Confirma excluir este pedido? Esta acao remove itens LAB vinculados e registra no historico do paciente.')
    if (!confirmed) return
    if (isSupabaseMode) {
      void (async () => {
        const result = await deleteCaseSupabase(currentCase.id)
        if (!result.ok) {
          addToast({ type: 'error', title: 'Erro ao excluir pedido', message: result.error })
          return
        }
        addToast({ type: 'success', title: 'Pedido excluido' })
        navigate('/app/cases', { replace: true })
      })()
      return
    }
    const result = deleteCase(currentCase.id)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Erro ao excluir pedido', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Pedido excluido' })
    navigate('/app/cases', { replace: true })
  }

  const createLabOrder = () => {
    if (!canWrite) return
    if (isSupabaseMode) {
      void (async () => {
        const result = await generateCaseLabOrderSupabase(currentCase.id)
        if (!result.ok) {
          addToast({ type: 'error', title: 'Gerar OS', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({
          type: 'success',
          title: 'OS do laboratorio',
          message: result.alreadyExists ? 'OS ja existia para este pedido.' : 'OS gerada com sucesso.',
        })
      })()
      return
    }
    const result = generateLabOrder(currentCase.id)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Gerar OS', message: result.error })
      return
    }
    addToast({
      type: 'success',
      title: 'OS do laboratorio',
      message: result.alreadyExists ? 'OS ja existia para este pedido.' : 'OS gerada com sucesso.',
    })
  }

  const printLabOrder = () => {
    if (!hasProductionOrder) {
      addToast({ type: 'error', title: 'Imprimir OS', message: 'Gere a OS do LAB antes de imprimir.' })
      return
    }

    const escapeHtml = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')

    const caseLabel = currentCase.treatmentCode ?? currentCase.id
    const planLabel = hasUpperArch && hasLowerArch
      ? `Superior ${totalUpper} | Inferior ${totalLower}`
      : hasUpperArch
        ? `Superior ${totalUpper}`
        : hasLowerArch
          ? `Inferior ${totalLower}`
          : '-'

    const scheduleRows = changeSchedule.length
      ? changeSchedule
          .map((row) => {
            const trocaPrevista = new Date(`${row.changeDate}T00:00:00`).toLocaleDateString('pt-BR')
            const trocaReal = new Date(`${(row.actualChangeDate ?? row.changeDate)}T00:00:00`).toLocaleDateString('pt-BR')
            const superior = hasUpperArch ? scheduleStateLabel(row.superiorState) : '-'
            const inferior = hasLowerArch ? scheduleStateLabel(row.inferiorState) : '-'
            return `
              <tr>
                <td>#${row.trayNumber}</td>
                <td>${escapeHtml(trocaPrevista)}</td>
                <td>${escapeHtml(trocaReal)}</td>
                <td>${escapeHtml(superior)}</td>
                <td>${escapeHtml(inferior)}</td>
              </tr>
            `
          })
          .join('')
      : `
        <tr>
          <td colspan="5">Sem agenda de placas registrada.</td>
        </tr>
      `

    const html = `
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Ordem de Servico LAB - ${escapeHtml(caseLabel)}</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
            .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; }
            .title { font-size: 20px; font-weight: 700; margin: 0; color: #0b1220; }
            .subtitle { margin-top: 4px; color: #334155; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
            .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; }
            .label { font-size: 11px; color: #475569; margin-bottom: 2px; }
            .value { font-weight: 600; color: #0f172a; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
            th { background: #e2e8f0; color: #0f172a; }
            .footer { margin-top: 16px; font-size: 10px; color: #475569; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">ORDEM DE SERVICO - LAB</h1>
            <div class="subtitle">Emitido em ${new Date().toLocaleString('pt-BR')}</div>
          </div>
          <div class="grid">
            <div class="card"><div class="label">Paciente</div><div class="value">${escapeHtml(currentCase.patientName)}</div></div>
            <div class="card"><div class="label">Caso / OS</div><div class="value">${escapeHtml(caseLabel)}</div></div>
            <div class="card"><div class="label">Produto</div><div class="value">${escapeHtml(PRODUCT_TYPE_LABEL[currentCase.productType ?? 'alinhador_12m'])}</div></div>
            <div class="card"><div class="label">Planejamento</div><div class="value">${escapeHtml(planLabel)}</div></div>
            <div class="card"><div class="label">Troca</div><div class="value">${escapeHtml(String(currentCase.changeEveryDays))} dias</div></div>
            <div class="card"><div class="label">Attachments</div><div class="value">${currentCase.attachmentBondingTray ? 'Sim' : 'Nao'}</div></div>
          </div>
          <div class="grid">
            <div class="card"><div class="label">Resumo LAB</div><div class="value">Em producao/CQ: ${inProductionCount} | Prontas: ${readyCount}</div></div>
            <div class="card"><div class="label">Entregue ao dentista</div><div class="value">Sup ${progressUpper.delivered} | Inf ${progressLower.delivered}</div></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Placa</th>
                <th>Troca prevista</th>
                <th>Data real</th>
                <th>Superior</th>
                <th>Inferior</th>
              </tr>
            </thead>
            <tbody>${scheduleRows}</tbody>
          </table>
          <div class="footer">Documento gerado pelo OrthoScan. Uso interno do laboratorio.</div>
        </body>
      </html>
    `

    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) {
      addToast({ type: 'error', title: 'Imprimir OS', message: 'Nao foi possivel abrir a janela de impressao.' })
      return
    }

    popup.document.open()
    popup.document.write(html)
    popup.document.close()
    popup.focus()
    popup.print()
  }

  const markCaseFileError = (fileId: string) => {
    if (!canWriteLocalOnly) return
    const reason = window.prompt('Motivo do erro no anexo:')
    if (!reason || !reason.trim()) return
    const result = markCaseScanFileError(currentCase.id, fileId, reason)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Anexos', message: result.error })
      return
    }
    addToast({ type: 'info', title: 'Anexo marcado como erro' })
  }

  const clearCaseFileError = (fileId: string) => {
    if (!canWriteLocalOnly) return
    const result = clearCaseScanFileError(currentCase.id, fileId)
    if (!result.ok) {
      addToast({ type: 'error', title: 'Anexos', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Erro removido do anexo' })
  }

  const saveInstallation = () => {
    if (!canWrite) return
    const upperCount = hasUpperArch ? Number(installationDeliveredUpper) : 0
    const lowerCount = hasLowerArch ? Number(installationDeliveredLower) : 0
    if (!Number.isFinite(upperCount) || !Number.isFinite(lowerCount) || upperCount < 0 || lowerCount < 0) {
      addToast({ type: 'error', title: 'Instalacao', message: 'Informe quantidades validas por arcada.' })
      return
    }
    if (hasUpperArch && Math.trunc(upperCount) > readyToDeliverPatient.upper) {
      addToast({
        type: 'error',
        title: 'Instalacao',
        message: `Superior disponivel para paciente: ${readyToDeliverPatient.upper} (entregue pelo LAB ao profissional e ainda nao consumido).`,
      })
      return
    }
    if (hasLowerArch && Math.trunc(lowerCount) > readyToDeliverPatient.lower) {
      addToast({
        type: 'error',
        title: 'Instalacao',
        message: `Inferior disponivel para paciente: ${readyToDeliverPatient.lower} (entregue pelo LAB ao profissional e ainda nao consumido).`,
      })
      return
    }
    if (!currentCase.installation && Math.trunc(upperCount + lowerCount) <= 0) {
      addToast({
        type: 'error',
        title: 'Instalacao',
        message: 'Na primeira instalacao, informe ao menos 1 alinhador entregue ao paciente.',
      })
      return
    }
    if (isSupabaseMode) {
      if (!hasProductionOrder) {
        addToast({ type: 'error', title: 'Instalacao', message: 'Ordem de servico do LAB ainda nao foi gerada para este pedido.' })
        return
      }
      const currentInstallation = currentCase.installation
      const currentDeliveredUpper = currentInstallation?.deliveredUpper ?? 0
      const currentDeliveredLower = currentInstallation?.deliveredLower ?? 0
      const deliveredUpper = Math.trunc(currentDeliveredUpper + upperCount)
      const deliveredLower = Math.trunc(currentDeliveredLower + lowerCount)
      const upperTotal = totalUpper
      const lowerTotal = totalLower
      const currentPairDelivered = Math.max(0, Math.min(currentDeliveredUpper, currentDeliveredLower))
      const nextPairDelivered = Math.max(0, Math.min(deliveredUpper, deliveredLower))
      const newPairQty = Math.max(0, nextPairDelivered - currentPairDelivered)
      const patientDeliveryLots = [...(currentInstallation?.patientDeliveryLots ?? [])]
      if (newPairQty > 0) {
        const fromTray = currentPairDelivered + 1
        const toTray = fromTray + newPairQty - 1
        patientDeliveryLots.push({
          id: `patient_lot_${Date.now()}`,
          fromTray,
          toTray,
          quantity: newPairQty,
          deliveredAt: installationDate,
          note: installationNote.trim() || undefined,
          createdAt: new Date().toISOString(),
        })
      }
      const finished = deliveredUpper >= upperTotal && deliveredLower >= lowerTotal
      void (async () => {
        const result = await patchCaseDataSupabase(
          currentCase.id,
          {
            installation: {
              installedAt: currentInstallation?.installedAt ?? installationDate,
              note: installationNote.trim() || currentInstallation?.note,
              deliveredUpper,
              deliveredLower,
              patientDeliveryLots,
              actualChangeDates: currentInstallation?.actualChangeDates,
            },
            status: finished ? 'finalizado' : 'em_entrega',
            phase: finished ? 'finalizado' : 'em_producao',
          },
          { status: finished ? 'finalizado' : 'em_entrega', phase: finished ? 'finalizado' : 'em_producao' },
        )
        if (!result.ok) {
          addToast({ type: 'error', title: 'Instalacao', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Instalacao registrada' })
      })()
      return
    }
    const result = registerCaseInstallation(currentCase.id, {
      installedAt: installationDate,
      note: installationNote.trim() || undefined,
      deliveredUpper: Math.trunc(upperCount),
      deliveredLower: Math.trunc(lowerCount),
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'Instalacao', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Instalacao registrada' })
  }

  const saveActualChangeDate = (trayNumber: number, changedAt: string) => {
    if (!canWrite) return
    if (!currentCase.installation) return
    const nextActualDates = (currentCase.installation.actualChangeDates ?? []).filter(
      (entry) => entry.trayNumber !== trayNumber,
    )
    if (changedAt) {
      nextActualDates.push({ trayNumber, changedAt })
    }
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(currentCase.id, {
          installation: {
            ...currentCase.installation,
            actualChangeDates: nextActualDates.length > 0 ? nextActualDates : undefined,
          },
        })
        if (!result.ok) {
          addToast({ type: 'error', title: 'Troca real', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Troca real atualizada' })
      })()
      return
    }
    const updated = updateCase(currentCase.id, {
      installation: {
        ...currentCase.installation,
        actualChangeDates: nextActualDates.length > 0 ? nextActualDates : undefined,
      },
    })
    if (!updated) {
      addToast({ type: 'error', title: 'Troca real', message: 'Nao foi possivel atualizar a data real de troca.' })
      return
    }
    addToast({ type: 'success', title: 'Troca real atualizada' })
  }

  const saveManualChangeCompletion = (trayNumber: number, completed: boolean) => {
    if (!canWrite) return
    if (!currentCase.installation) return
    const nextCompletion = (currentCase.installation.manualChangeCompletion ?? []).filter(
      (entry) => entry.trayNumber !== trayNumber,
    )
    nextCompletion.push({ trayNumber, completed })
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(currentCase.id, {
          installation: {
            ...currentCase.installation,
            manualChangeCompletion: nextCompletion,
          },
        })
        if (!result.ok) {
          addToast({ type: 'error', title: 'Troca concluida', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
      })()
      return
    }
    const updated = updateCase(currentCase.id, {
      installation: {
        ...currentCase.installation,
        manualChangeCompletion: nextCompletion,
      },
    })
    if (!updated) {
      addToast({ type: 'error', title: 'Troca concluida', message: 'Nao foi possivel atualizar status manual.' })
    }
  }

  const saveChangeEveryDays = async () => {
    if (!canWrite) return
    const parsed = Math.trunc(Number(changeEveryDaysInput))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      addToast({ type: 'error', title: 'Troca', message: 'Informe um numero de dias valido.' })
      return
    }
    if (parsed === currentCase.changeEveryDays) {
      addToast({ type: 'info', title: 'Troca', message: 'Sem alteracoes para salvar.' })
      return
    }

    if (isSupabaseMode) {
      const result = await patchCaseDataSupabase(currentCase.id, { changeEveryDays: parsed })
      if (!result.ok) {
        addToast({ type: 'error', title: 'Troca', message: result.error })
        return
      }
      setSupabaseRefreshKey((current) => current + 1)
      addToast({ type: 'success', title: 'Troca', message: 'Dias de troca atualizados.' })
      return
    }

    updateCase(currentCase.id, { changeEveryDays: parsed })
    addToast({ type: 'success', title: 'Troca', message: 'Dias de troca atualizados.' })
  }

  const renderScanFile = (item: NonNullable<Case['scanFiles']>[number], labelOverride?: string) => {
    const availability = fileAvailability(item)
    const status = item.status ?? 'ok'
    const attachedDate = item.attachedAt ?? item.createdAt
    return (
      <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-900">{item.name}</p>
          <p className="text-xs text-slate-500">
            {labelOverride ?? (item.arch ? scanArchLabelMap[item.arch] : 'Arquivo')} -{' '}
            {new Date(attachedDate).toLocaleDateString('pt-BR')}
          </p>
          <p className="text-xs text-slate-500">Obs: {item.note || '-'}</p>
          {status === 'erro' ? (
            <p className="text-xs text-red-700">
              Motivo: {item.flaggedReason || '-'} | Em: {item.flaggedAt ? new Date(item.flaggedAt).toLocaleString('pt-BR') : '-'}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === 'erro' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {status === 'erro' ? 'ERRO' : 'OK'}
          </span>
        {availability.url ? (
          <a href={availability.url} target="_blank" rel="noreferrer" className="text-xs text-brand-700">
            {availability.label}
          </a>
        ) : (
          <span className="text-xs text-slate-500">{availability.label}</span>
        )}
        </div>
        </div>
        {canWriteLocalOnly ? (
          <div className="mt-2">
            {status === 'erro' ? (
              <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => clearCaseFileError(item.id)}>
                Desmarcar erro
              </button>
            ) : (
              <button type="button" className="text-xs font-semibold text-red-700" onClick={() => markCaseFileError(item.id)}>
                Marcar como erro
              </button>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  const renderScanFileGroup = (title: string, files: NonNullable<Case['scanFiles']>) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</p>
      <div className="mt-2 space-y-2">
        {files.length === 0 ? <p className="text-sm text-slate-500">Nenhum arquivo.</p> : files.map((item) => renderScanFile(item))}
      </div>
    </div>
  )

  return (
    <AppShell breadcrumb={['Inicio', 'Alinhadores', patientDisplayName]}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Paciente: {patientDisplayName}</h1>
          {currentCase.treatmentCode ? (
            <p className="mt-1 text-sm font-semibold text-slate-700">
              Identificacao: {currentCase.treatmentCode} ({currentCase.treatmentOrigin === 'interno' ? 'Interno ARRIMO' : 'Externo'})
            </p>
          ) : null}
          <p className="mt-1 text-sm font-medium text-slate-600">
            Produto: {PRODUCT_TYPE_LABEL[currentCase.productType ?? 'alinhador_12m']} | Nº Caso: {currentCase.treatmentCode ?? currentCase.id}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-600">
            Planejamento:{' '}
            {hasUpperArch && hasLowerArch
              ? `Superior ${totalUpper} | Inferior ${totalLower}`
              : hasUpperArch
                ? `Superior ${totalUpper}`
                : hasLowerArch
                  ? `Inferior ${totalLower}`
                  : '-'}{' '}
            | Troca {currentCase.changeEveryDays} dias | Attachments: {currentCase.attachmentBondingTray ? 'Sim' : 'Nao'}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Badge tone={phaseToneMap[currentCase.phase]}>{phaseLabelMap[currentCase.phase]}</Badge>
            <span className="text-xs text-slate-500">
              Ultima atualizacao: {new Date(currentCase.updatedAt).toLocaleString('pt-BR')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={printLabOrder}
            disabled={!isAlignerCase || !hasProductionOrder}
            title={!hasProductionOrder ? 'Gere a OS do LAB antes de imprimir.' : ''}
          >
            Imprimir OS
          </Button>
          <Link
            to="/app/cases"
            className="inline-flex h-10 items-center rounded-lg bg-slate-200 px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-300"
          >
            Voltar
          </Link>
        </div>
      </section>

      <section className={`mt-6 grid grid-cols-1 gap-4 ${hasUpperArch && hasLowerArch ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {hasUpperArch ? (
          <Card>
            <p className="text-sm text-slate-500">Progresso - Superior</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {patientProgressUpper.delivered}/{patientProgressUpper.total}
            </p>
            <div className="mt-3 h-2 rounded-full bg-slate-200">
              <div className="h-2 rounded-full bg-brand-500" style={{ width: `${patientProgressUpper.percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Baseado na data real de troca do paciente.</p>
          </Card>
        ) : null}

        {hasLowerArch ? (
          <Card>
            <p className="text-sm text-slate-500">Progresso - Inferior</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {patientProgressLower.delivered}/{patientProgressLower.total}
            </p>
            <div className="mt-3 h-2 rounded-full bg-slate-200">
              <div className="h-2 rounded-full bg-brand-500" style={{ width: `${patientProgressLower.percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Baseado na data real de troca do paciente.</p>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm text-slate-500">Resumo</p>
          <p className="mt-2 text-sm text-slate-700">Em producao/CQ: {inProductionCount}</p>
          <p className="mt-1 text-sm text-slate-700">Prontas: {readyCount}</p>
          <p className="mt-1 text-sm text-slate-700">
            Entregues:{' '}
            {hasUpperArch && hasLowerArch
              ? `Sup ${progressUpper.delivered} | Inf ${progressLower.delivered}`
              : hasUpperArch
                ? `Sup ${progressUpper.delivered}`
                : `Inf ${progressLower.delivered}`}
          </p>
        </Card>
      </section>

      {!hasProductionOrder ? (
        <section className="mt-6">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Fluxo do Pedido</h2>
            <p className="mt-1 text-sm text-slate-500">Fase atual: {phaseLabelMap[currentCase.phase]}</p>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 1 - Planejamento</p>
                <Button className="mt-2" size="sm" onClick={concludePlanning} disabled={currentCase.phase !== 'planejamento' || !canWrite}>
                  Concluir planejamento
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 2 - Orcamento</p>
                <div className="mt-2 grid gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="R$ 0,00"
                    value={budgetValue}
                    onChange={(event) => setBudgetValue(formatBrlCurrencyInput(event.target.value))}
                  />
                  <textarea
                    rows={2}
                    placeholder="ObservacÃµes do orcamento"
                    value={budgetNotes}
                    onChange={(event) => setBudgetNotes(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={closeBudget} disabled={currentCase.phase !== 'orcamento' || !canWrite}>
                    Fechar orcamento
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 3 - Contrato</p>
                <p className="mt-1 text-xs text-slate-500">
                  Status: {currentCase.contract?.status ?? 'pendente'}
                  {currentCase.contract?.approvedAt ? ` | Aprovado em ${new Date(currentCase.contract.approvedAt).toLocaleString('pt-BR')}` : ''}
                </p>
                <textarea
                  rows={2}
                  placeholder="ObservacÃµes do contrato"
                  value={contractNotes}
                  onChange={(event) => setContractNotes(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <Button className="mt-2" size="sm" onClick={approveContract} disabled={currentCase.phase !== 'contrato_pendente' || !canWrite}>
                  Aprovar contrato
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 4 - Ordem de Servico (LAB)</p>
                <Button
                  className="mt-2"
                  size="sm"
                  onClick={createLabOrder}
                  disabled={!canWrite}
                >
                  Gerar OS para o LAB
                </Button>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Pedido e reposicao paciente</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Total contratado: <span className="font-semibold">{replacementSummary.totalContratado}</span>
            </div>
            <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">
              Entregue ao paciente: <span className="font-semibold">{replacementSummary.entreguePaciente}</span>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Saldo no banco: <span className="font-semibold">{replacementSummary.saldoRestante}</span>
            </div>
          </div>
          <div className="mt-3 grid gap-3">
            {currentCase.installation ? (
              <p className="text-sm text-slate-700">
                Registro atual: {new Date(`${currentCase.installation.installedAt.slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')} |{' '}
                {hasUpperArch && hasLowerArch
                  ? `Sup ${currentCase.installation.deliveredUpper ?? 0} | Inf ${currentCase.installation.deliveredLower ?? 0}`
                  : hasUpperArch
                    ? `Sup ${currentCase.installation.deliveredUpper ?? 0}`
                    : `Inf ${currentCase.installation.deliveredLower ?? 0}`}
              </p>
            ) : null}
            {(readyToDeliverPatient.upper > 0 || readyToDeliverPatient.lower > 0) ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Prontas para entrega ao paciente (saldo do profissional):{' '}
                {hasUpperArch && hasLowerArch
                  ? `Sup ${readyToDeliverPatient.upper} | Inf ${readyToDeliverPatient.lower}`
                  : hasUpperArch
                    ? `Sup ${readyToDeliverPatient.upper}`
                    : `Inf ${readyToDeliverPatient.lower}`}
              </p>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Sem saldo pronto para entrega ao paciente no momento.
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {currentCase.installation ? 'Data da entrega ao paciente' : 'Data da instalacao inicial'}
              </label>
              <Input
                type="date"
                value={installationDate}
                onChange={(event) => setInstallationDate(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Observacao</label>
              <textarea
                rows={3}
                value={installationNote}
                onChange={(event) => setInstallationNote(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className={`grid grid-cols-1 gap-3 ${hasUpperArch && hasLowerArch ? 'sm:grid-cols-2' : ''}`}>
              {hasUpperArch ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Entrega paciente - Superior</label>
                  <Input
                    type="number"
                    min={0}
                    max={totalUpper}
                    value={installationDeliveredUpper}
                    onChange={(event) => setInstallationDeliveredUpper(event.target.value)}
                  />
                </div>
              ) : null}
              {hasLowerArch ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Entrega paciente - Inferior</label>
                  <Input
                    type="number"
                    min={0}
                    max={totalLower}
                    value={installationDeliveredLower}
                    onChange={(event) => setInstallationDeliveredLower(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
            <div>
              <Button
                size="sm"
                onClick={saveInstallation}
                disabled={!canWrite || !hasProductionOrder || !hasDentistDelivery}
                title={
                  !hasProductionOrder
                    ? 'Gere a OS do LAB antes.'
                    : !hasDentistDelivery
                      ? 'Registre a entrega ao dentista antes.'
                      : ''
                }
              >
                {currentCase.installation ? 'Registrar reposicao paciente' : 'Registrar instalacao inicial'}
              </Button>
              {!hasProductionOrder ? <p className="mt-2 text-xs text-amber-700">Ordem de servico do LAB ainda nao gerada.</p> : null}
              {!hasDentistDelivery ? <p className="mt-1 text-xs text-amber-700">Registre antes a entrega ao dentista.</p> : null}
            </div>
          </div>
        </Card>

      </section>

      {isAlignerCase ? (
      <section className="mt-6">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Reposicao prevista</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>
              Entregue ao paciente:{' '}
              {hasUpperArch && hasLowerArch
                ? `Superior ${progressUpper.delivered}/${progressUpper.total} | Inferior ${progressLower.delivered}/${progressLower.total}`
                : hasUpperArch
                  ? `Superior ${progressUpper.delivered}/${progressUpper.total}`
                  : `Inferior ${progressLower.delivered}/${progressLower.total}`}
            </p>
            <p>Total geral planejado: {Math.max(progressUpper.total, progressLower.total)}</p>
            <p>Proxima placa necessaria: {supplySummary?.nextTray ? `#${supplySummary.nextTray}` : 'Nenhuma (pedido completo)'}</p>
            <p>
              Proxima reposicao prevista para:{' '}
              {supplySummary?.nextDueDate ? new Date(`${supplySummary.nextDueDate}T00:00:00`).toLocaleDateString('pt-BR') : '-'}
            </p>
            {!currentCase.installation?.installedAt ? (
              <p className="text-sm text-slate-500">Registre a instalacao para calcular reposicÃµes.</p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {replenishmentAlerts.length === 0 ? (
              <span className="text-xs text-slate-500">Sem alertas ativos.</span>
            ) : (
              replenishmentAlerts.map((alert) => (
                <span
                  key={alert.id}
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    alert.severity === 'urgent'
                      ? 'bg-red-100 text-red-700'
                      : alert.severity === 'high'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {alert.type === 'warning_15d' ? '15d' : alert.type === 'warning_10d' ? '10d' : 'atrasado'}
                </span>
              ))
            )}
          </div>
        </Card>
      </section>
      ) : null}

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">InformacÃµes clinicas</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>
              <span className="font-medium">Arcada:</span> {currentCase.arch ? archLabelMap[currentCase.arch] : '-'}
            </p>
            <p>
              <span className="font-medium">Queixa do paciente:</span> {currentCase.complaint || '-'}
            </p>
            <p>
              <span className="font-medium">Orientacao do dentista:</span> {currentCase.dentistGuidance || '-'}
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profissional / Clinica</p>
              <p className="mt-1">
                <span className="font-medium">Clinica:</span> {clinicName || '-'}
              </p>
              <p>
                <span className="font-medium">Dentista responsavel:</span>{' '}
                {dentist ? `${dentistPrefix} ${dentist.name}` : '-'}
              </p>
              <p>
                <span className="font-medium">Solicitante:</span>{' '}
                {requester ? `${requesterPrefix} ${requester.name}` : '-'}
              </p>
            </div>
            {isAlignerCase ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm">
                    <span className="font-medium">Troca a cada (dias):</span> {currentCase.changeEveryDays}
                  </p>
                  {canWrite ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        type="number"
                        min={1}
                        value={changeEveryDaysInput}
                        onChange={(event) => setChangeEveryDaysInput(event.target.value)}
                        className="sm:w-40"
                      />
                      <Button size="sm" variant="secondary" onClick={() => void saveChangeEveryDays()}>
                        Salvar dias de troca
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p>
                  <span className="font-medium">Placas:</span>{' '}
                  {hasUpperArch && hasLowerArch
                    ? `Superior: ${totalUpper} | Inferior: ${totalLower}`
                    : hasUpperArch
                      ? `Superior: ${totalUpper}`
                      : `Inferior: ${totalLower}`}
                </p>
                <p>
                  <span className="font-medium">Placa de attachments:</span> {currentCase.attachmentBondingTray ? 'Sim' : 'Nao'}
                </p>
              </>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Produto sem fluxo de placas de alinhadores. Fluxo focado em registro de instalacao.
              </p>
            )}
            <p>
              <span className="font-medium">Fonte:</span> {currentCase.sourceScanId ? `Scan ${currentCase.sourceScanId}` : 'Nao vinculado'}
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Arquivos do scan</h2>
          <div className="mt-3 space-y-4">
            {hasUpperArch ? renderScanFileGroup('Scan 3D - Superior', groupedScanFiles.scan3d.superior) : null}
            {hasLowerArch ? renderScanFileGroup('Scan 3D - Inferior', groupedScanFiles.scan3d.inferior) : null}
            {renderScanFileGroup('Scan 3D - Mordida', groupedScanFiles.scan3d.mordida)}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Fotos intraorais</p>
              <div className="mt-2 space-y-2">
                {groupedScanFiles.fotosIntra.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum arquivo.</p>
                ) : (
                  groupedScanFiles.fotosIntra.map((item) => renderScanFile(item, slotLabel(item.slotId)))
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Fotos extraorais</p>
              <div className="mt-2 space-y-2">
                {groupedScanFiles.fotosExtra.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum arquivo.</p>
                ) : (
                  groupedScanFiles.fotosExtra.map((item) => renderScanFile(item, slotLabel(item.slotId)))
                )}
              </div>
            </div>
            {renderScanFileGroup('Radiografias - Panoramica', groupedScanFiles.radiografias.panoramica)}
            {renderScanFileGroup('Radiografias - Teleradiografia', groupedScanFiles.radiografias.teleradiografia)}
            {renderScanFileGroup('Radiografias - Tomografia', groupedScanFiles.radiografias.tomografia)}
            {renderScanFileGroup('Planejamento', groupedScanFiles.planejamento)}
          </div>
        </Card>
      </section>

      {isAlignerCase ? (
      <section className="mt-6">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Producao (LAB)</h2>
            {canReadLab ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/app/lab?tab=banco_restante&caseId=${currentCase.id}`)}
              >
                Banco de reposicoes
              </Button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">Aguardando: {labSummary.aguardando_iniciar}</div>
            <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700">Em producao: {labSummary.em_producao}</div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">CQ: {labSummary.controle_qualidade}</div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Prontas: {labSummary.prontas}</div>
            <div className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">Entregues: {labSummary.entregues}</div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Itens da OS no LAB: {labSummary.osItens}</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Placa</th>
                  <th className="px-3 py-2 font-semibold">Troca prevista</th>
                  <th className="px-3 py-2 font-semibold">Data real de troca</th>
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Superior</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Inferior</th> : null}
                  <th className="px-3 py-2 font-semibold">Troca concluida</th>
                  <th className="px-3 py-2 font-semibold">Data de entrega</th>
                </tr>
              </thead>
              <tbody>
                {changeSchedule.length === 0 ? (
                  <tr>
                    <td colSpan={hasUpperArch && hasLowerArch ? 7 : 6} className="px-3 py-4 text-slate-500">
                      Registre a instalacao para gerar agenda de trocas.
                    </td>
                  </tr>
                ) : (
                  changeSchedule.map((row) => {
                    const dueReached = row.changeDate <= todayIso
                    const manualCompleted = manualChangeCompletionByTray.get(row.trayNumber)
                    const trocaConcluida = typeof manualCompleted === 'boolean' ? manualCompleted : dueReached

                    return (
                      <tr key={row.trayNumber} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-semibold text-slate-800">#{row.trayNumber}</td>
                        <td className="px-3 py-2 text-slate-700">{new Date(`${row.changeDate}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <Input
                            type="date"
                            value={row.actualChangeDate ?? row.changeDate}
                            onChange={(event) => saveActualChangeDate(row.trayNumber, event.target.value)}
                            disabled={!canWrite}
                          />
                        </td>
                        {hasUpperArch ? <td className={`px-3 py-2 font-medium ${scheduleStateClass(row.superiorState)}`}>{scheduleStateLabel(row.superiorState)}</td> : null}
                        {hasLowerArch ? <td className={`px-3 py-2 font-medium ${scheduleStateClass(row.inferiorState)}`}>{scheduleStateLabel(row.inferiorState)}</td> : null}
                        <td className="px-3 py-2 text-slate-700">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                trocaConcluida ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                              }`}
                              onClick={() => saveManualChangeCompletion(row.trayNumber, true)}
                              disabled={!canWrite}
                            >
                              Sim
                            </button>
                            <button
                              type="button"
                              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                !trocaConcluida ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'
                              }`}
                              onClick={() => saveManualChangeCompletion(row.trayNumber, false)}
                              disabled={!canWrite}
                            >
                              Nao
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {(() => {
                            const deliveredAt = dentistDeliveryDateByTray.get(row.trayNumber)
                            return deliveredAt ? new Date(`${deliveredAt}T00:00:00`).toLocaleDateString('pt-BR') : '-'
                          })()}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
      ) : null}

      <section className="mt-6">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Timeline de placas</h2>
          <p className="mt-1 text-sm text-slate-500">Clique em uma placa para ver detalhes e alterar estado.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded px-2 py-1 bg-slate-100 text-slate-700">Pendente</span>
            <span className="rounded px-2 py-1 bg-blue-100 text-blue-700">Em producao</span>
            <span className="rounded px-2 py-1 bg-brand-500 text-white">Pronta</span>
            <span className="rounded px-2 py-1 bg-emerald-100 text-emerald-700">Entregue</span>
            <span className="rounded px-2 py-1 bg-red-100 text-red-700">Rework</span>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
            {currentCase.trays.map((tray) => (
              <button
                key={tray.trayNumber}
                type="button"
                onClick={canManageTray ? () => openTrayModal(tray) : undefined}
                disabled={!canManageTray}
                className={`h-10 rounded-lg text-xs font-semibold transition ${trayStateClasses[timelineStateForTray(tray, hasUpperArch ? progressUpper.delivered : 0, hasLowerArch ? progressLower.delivered : 0)]}`}
              >
                {tray.trayNumber}
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Anexos</h2>
              <p className="mt-1 text-sm text-slate-500">Arquivos do scan e materiais de apoio.</p>
            </div>
            <Button onClick={() => setAttachmentModalOpen(true)} disabled={!canWriteLocalOnly}>Adicionar anexo</Button>
          </div>

          <div className="mt-4 space-y-3">
            {currentCase.attachments.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.type} - {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                  <p className="text-xs text-slate-500">
                    Data anexo: {item.attachedAt ? new Date(`${item.attachedAt}T00:00:00`).toLocaleDateString('pt-BR') : '-'} | Obs: {item.note || '-'}
                  </p>
                </div>
                {item.url.startsWith('blob:') ? (
                  <span className="text-xs text-slate-500">(arquivo local)</span>
                ) : item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:text-brand-500">
                    Abrir
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">(arquivo local)</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </section>

      {canDeleteCase ? (
        <section className="mt-6">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Exclusao administrativa: remove pedido e registros vinculados do fluxo.
              </p>
              <Button variant="secondary" className="text-red-600 hover:text-red-700" onClick={handleDeleteCase}>
                Excluir pedido
              </Button>
            </div>
          </Card>
        </section>
      ) : null}

      {attachmentModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">Adicionar anexo</h3>
              <Button variant="ghost" size="sm" onClick={() => setAttachmentModalOpen(false)}>
                Fechar
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
                <select
                  value={attachmentType}
                  onChange={(event) => setAttachmentType(event.target.value as 'imagem' | 'documento' | 'outro')}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="imagem">Imagem</option>
                  <option value="documento">Documento (pdf)</option>
                  <option value="outro">Outro</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Data</label>
                <Input type="date" value={attachmentDate} onChange={(event) => setAttachmentDate(event.target.value)} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Observacao</label>
                <textarea
                  rows={3}
                  value={attachmentNote}
                  onChange={(event) => setAttachmentNote(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Arquivo</label>
                {attachmentType === 'imagem' ? (
                  <ImageCaptureInput accept="image/*" onFileSelected={setAttachmentFile} />
                ) : (
                  <input
                    type="file"
                    accept={attachmentType === 'documento' ? 'application/pdf,image/*' : undefined}
                    onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
                  />
                )}
                {attachmentFile ? <p className="mt-1 text-xs text-slate-500">Arquivo: {attachmentFile.name}</p> : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAttachmentModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAttachmentSave} disabled={!canWriteLocalOnly}>Salvar anexo</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {selectedTray ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">Placa #{selectedTray.trayNumber}</h3>
              <Button variant="ghost" size="sm" onClick={() => setSelectedTray(null)}>
                Fechar
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Estado</label>
                <select
                  value={trayState}
                  onChange={(event) => setSelectedTrayState(event.target.value as TrayState)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="pendente">Pendente</option>
                  <option value="em_producao">Em producao</option>
                  <option value="pronta">Pronta</option>
                  <option value="entregue">Entregue</option>
                  <option value="rework">Rework</option>
                </select>
              </div>
              {trayState === 'rework' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Arcada do rework</label>
                  <select
                    value={reworkArch}
                    onChange={(event) => setReworkArch(event.target.value as 'superior' | 'inferior' | 'ambos')}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="inferior">Inferior</option>
                    <option value="superior">Superior</option>
                    <option value="ambos">Ambas</option>
                  </select>
                </div>
              ) : null}

              {linkedLabItems.some((item) => item.trayNumber === selectedTray.trayNumber) ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Esta placa esta vinculada ao laboratorio.
                </p>
              ) : null}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nota</label>
                <textarea
                  rows={4}
                  value={trayNote}
                  onChange={(event) => setTrayNote(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedTray(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void saveTrayChanges()} disabled={!canManageTray}>Salvar</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </AppShell>
  )
}





