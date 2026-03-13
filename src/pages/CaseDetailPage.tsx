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
import { resolveRequestedProductLabel } from '../lib/productLabel'
import type { LabItem } from '../types/Lab'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import { buildWhatsappUrl, isValidWhatsapp } from '../lib/whatsapp'

const caseStatusLabelMap: Record<Case['status'], string> = {
  planejamento: 'Planejamento',
  em_producao: 'Em producao',
  em_entrega: 'Em entrega',
  em_tratamento: 'Em tratamento',
  aguardando_reposicao: 'Aguardando reposição',
  finalizado: 'Finalizado',
}

const caseStatusToneMap: Record<Case['status'], 'neutral' | 'info' | 'success' | 'danger'> = {
  planejamento: 'neutral',
  em_producao: 'info',
  em_entrega: 'info',
  em_tratamento: 'info',
  aguardando_reposicao: 'danger',
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

function diffDaysBetweenIso(targetIsoDate: string, baseIsoDate: string) {
  const target = new Date(`${targetIsoDate}T00:00:00`)
  const base = new Date(`${baseIsoDate}T00:00:00`)
  const ms = target.getTime() - base.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function deriveTreatmentStatus(payload: {
  installedAt?: string
  changeEveryDays: number
  totalUpper: number
  totalLower: number
  deliveredUpper: number
  deliveredLower: number
  completedUpper?: number
  completedLower?: number
  todayIso: string
  nextDueDate?: string
}) {
  const totalUpper = Math.max(0, Math.trunc(payload.totalUpper))
  const totalLower = Math.max(0, Math.trunc(payload.totalLower))
  const deliveredUpper = Math.max(0, Math.trunc(payload.deliveredUpper))
  const deliveredLower = Math.max(0, Math.trunc(payload.deliveredLower))
  const completedUpper = Math.max(0, Math.trunc(payload.completedUpper ?? deliveredUpper))
  const completedLower = Math.max(0, Math.trunc(payload.completedLower ?? deliveredLower))
  const deliveredAny = deliveredUpper > 0 || deliveredLower > 0
  const finished = completedUpper >= totalUpper && completedLower >= totalLower
  // Não finaliza automaticamente o tratamento.
  // A finalizacao deve ser confirmada manualmente pelo usuário.
  if (finished) return 'em_tratamento' as const
  if (!payload.installedAt || !deliveredAny) return 'em_entrega' as const

  const nextDueDates: string[] = payload.nextDueDate ? [payload.nextDueDate] : []
  if (nextDueDates.length === 0) {
    if (totalUpper > 0 && deliveredUpper < totalUpper) {
      nextDueDates.push(addDays(payload.installedAt, (deliveredUpper + 1 - 1) * payload.changeEveryDays))
    }
    if (totalLower > 0 && deliveredLower < totalLower) {
      nextDueDates.push(addDays(payload.installedAt, (deliveredLower + 1 - 1) * payload.changeEveryDays))
    }
  }
  if (nextDueDates.length === 0) return 'em_tratamento' as const
  const nextDue = nextDueDates.sort()[0]
  return nextDue <= payload.todayIso ? ('aguardando_reposicao' as const) : ('em_tratamento' as const)
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

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((value ?? '').trim())
}

function toReadableCaseCode(value?: string) {
  const raw = (value ?? '').trim()
  if (!raw) return '-'
  if (isUuidLike(raw)) return `CASO-${raw.slice(0, 8).toUpperCase()}`
  if (raw.length > 24 && /^[0-9a-f-]+$/i.test(raw)) return `CASO-${raw.slice(0, 8).toUpperCase()}`
  return raw
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
  actualUpperByTray: Map<number, string>,
  actualLowerByTray: Map<number, string>,
): Array<{
  trayNumber: number
  upperPlannedDate?: string
  lowerPlannedDate?: string
  upperChangeDate?: string
  lowerChangeDate?: string
  changeDate: string
  superiorState: TrayState | 'nao_aplica'
  inferiorState: TrayState | 'nao_aplica'
}> {
  if (!installedAt) return []
  const max = Math.max(totalUpper, totalLower)
  const schedule: Array<{
    trayNumber: number
    upperPlannedDate?: string
    lowerPlannedDate?: string
    upperChangeDate?: string
    lowerChangeDate?: string
    changeDate: string
    superiorState: TrayState | 'nao_aplica'
    inferiorState: TrayState | 'nao_aplica'
  }> = []
  let nextUpperDate = installedAt
  let nextLowerDate = installedAt
  for (let index = 0; index < max; index += 1) {
    const trayNumber = index + 1
    if (trayNumber > 1 && trayNumber <= totalUpper) {
      nextUpperDate = addDays(nextUpperDate, changeEveryDays)
    }
    if (trayNumber > 1 && trayNumber <= totalLower) {
      nextLowerDate = addDays(nextLowerDate, changeEveryDays)
    }
    const upperPlannedDate = trayNumber <= totalUpper ? nextUpperDate : undefined
    const lowerPlannedDate = trayNumber <= totalLower ? nextLowerDate : undefined
    const upperChangeDate = trayNumber <= totalUpper ? (actualUpperByTray.get(trayNumber) ?? upperPlannedDate) : undefined
    const lowerChangeDate = trayNumber <= totalLower ? (actualLowerByTray.get(trayNumber) ?? lowerPlannedDate) : undefined
    if (trayNumber <= totalUpper && upperChangeDate) {
      nextUpperDate = upperChangeDate
    }
    if (trayNumber <= totalLower && lowerChangeDate) {
      nextLowerDate = lowerChangeDate
    }
    const changeDate = [upperChangeDate, lowerChangeDate].filter((value): value is string => Boolean(value)).sort()[0] ?? installedAt
    schedule.push({
      trayNumber,
      upperPlannedDate,
      lowerPlannedDate,
      upperChangeDate,
      lowerChangeDate,
      changeDate,
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

function buildAlignerWhatsappMessage(patientName: string, trayNumber: number) {
  return [
    `Olá, ${patientName}!`,
    '',
    `Passando para lembrar que hoje é o dia de realizar a troca do seu alinhador para o alinhador nº ${trayNumber}.`,
    '',
    'Seguir corretamente o período de troca é essencial para que seu tratamento evolua conforme o planejamento.',
    '',
    'Após realizar a troca, se possível, nos confirme por aqui com um “OK”.',
    'Caso tenha qualquer dúvida ou desconforto, nossa equipe está à disposição para te ajudar!',
  ].join('\n')
}

function buildAlignerWhatsappHref(patientWhatsapp: string | undefined, patientName: string, trayNumber: number) {
  if (!patientWhatsapp || !isValidWhatsapp(patientWhatsapp)) return ''
  const baseUrl = buildWhatsappUrl(patientWhatsapp)
  if (!baseUrl) return ''
  return `${baseUrl}?text=${encodeURIComponent(buildAlignerWhatsappMessage(patientName, trayNumber))}`
}

function mapSupabaseCaseRowToCase(
  row: {
    id: string
    product_type?: string
    product_id?: string
    scan_id?: string | null
    clinic_id?: string | null
    patient_id?: string | null
    dentist_id?: string | null
    requested_by_dentist_id?: string | null
    data?: Record<string, unknown>
  },
): Case {
  const data = row.data ?? {}
  const now = new Date().toISOString()
  const status = (data.status as Case['status'] | undefined) ?? 'planejamento'
  const phase = (data.phase as CasePhase | undefined) ?? 'planejamento'
  return {
    id: row.id,
    productType: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
    productId: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
    requestedProductId: data.requestedProductId as string | undefined,
    requestedProductLabel: data.requestedProductLabel as string | undefined,
    treatmentCode: data.treatmentCode as string | undefined,
    treatmentOrigin: data.treatmentOrigin as Case['treatmentOrigin'] | undefined,
    patientName: (data.patientName as string | undefined) ?? '-',
    patientId: (data.patientId as string | undefined) ?? row.patient_id ?? undefined,
    dentistId: (data.dentistId as string | undefined) ?? row.dentist_id ?? undefined,
    requestedByDentistId: (data.requestedByDentistId as string | undefined) ?? row.requested_by_dentist_id ?? undefined,
    clinicId: (data.clinicId as string | undefined) ?? row.clinic_id ?? undefined,
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
    sourceScanId: (data.sourceScanId as string | undefined) ?? row.scan_id ?? undefined,
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
  const [supabaseCaseRefs, setSupabaseCaseRefs] = useState<{
    clinicName?: string
    dentistName?: string
    dentistGender?: string
    requesterName?: string
    requesterGender?: string
    patientBirthDate?: string
    patientWhatsapp?: string
    requestedProductId?: string
    requestedProductLabel?: string
  }>({})
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
        .select('id, product_type, product_id, scan_id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, data, deleted_at')
        .eq('id', params.id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!active) return
      if (!data) {
        setSupabaseCase(null)
        return
      }
      setSupabaseCase(
        mapSupabaseCaseRowToCase(
          data as {
            id: string
            product_type?: string
            product_id?: string
            scan_id?: string | null
            clinic_id?: string | null
            patient_id?: string | null
            dentist_id?: string | null
            requested_by_dentist_id?: string | null
            data?: Record<string, unknown>
          },
        ),
      )
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
  const localSourceScan = useMemo(
    () => (!isSupabaseMode && currentCase?.sourceScanId ? db.scans.find((item) => item.id === currentCase.sourceScanId) : undefined),
    [currentCase?.sourceScanId, db.scans, isSupabaseMode],
  )
  const isAlignerCase = useMemo(
    () => (currentCase ? isAlignerProductType(normalizeProductType(currentCase.productId ?? currentCase.productType)) : false),
    [currentCase],
  )
  const scopedCases = useMemo(() => listCasesForUser(db, currentUser), [db, currentUser])

  useEffect(() => {
    if (!isSupabaseMode || !supabase || !currentCase) {
      setSupabaseCaseRefs({})
      return
    }
    let active = true
    void (async () => {
      const [clinicRes, dentistRes, requesterRes, patientRes, scanRes] = await Promise.all([
        currentCase.clinicId
          ? supabase.from('clinics').select('id, trade_name').eq('id', currentCase.clinicId).maybeSingle()
          : Promise.resolve({ data: null }),
        currentCase.dentistId
          ? supabase.from('dentists').select('id, name, gender').eq('id', currentCase.dentistId).maybeSingle()
          : Promise.resolve({ data: null }),
        currentCase.requestedByDentistId
          ? supabase.from('dentists').select('id, name, gender').eq('id', currentCase.requestedByDentistId).maybeSingle()
          : Promise.resolve({ data: null }),
        currentCase.patientId
          ? supabase.from('patients').select('id, birth_date, whatsapp, phone').eq('id', currentCase.patientId).maybeSingle()
          : Promise.resolve({ data: null }),
        currentCase.sourceScanId
          ? supabase.from('scans').select('id, data').eq('id', currentCase.sourceScanId).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!active) return
      const scanData = ((scanRes.data as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
      setSupabaseCaseRefs({
        clinicName: (clinicRes.data as { trade_name?: string } | null)?.trade_name,
        dentistName: (dentistRes.data as { name?: string } | null)?.name,
        dentistGender: (dentistRes.data as { gender?: string } | null)?.gender,
        requesterName: (requesterRes.data as { name?: string } | null)?.name,
        requesterGender: (requesterRes.data as { gender?: string } | null)?.gender,
        patientBirthDate: (patientRes.data as { birth_date?: string } | null)?.birth_date,
        patientWhatsapp: (patientRes.data as { whatsapp?: string; phone?: string } | null)?.whatsapp
          ?? (patientRes.data as { whatsapp?: string; phone?: string } | null)?.phone,
        requestedProductId: currentCase.requestedProductId ?? (scanData.purposeProductId as string | undefined),
        requestedProductLabel: currentCase.requestedProductLabel ?? (scanData.purposeLabel as string | undefined),
      })
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, currentCase, supabaseRefreshKey, supabaseSyncTick])

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
  const actualChangeDateUpperByTray = useMemo(() => {
    const map = new Map<number, string>()
    ;(currentCase?.installation?.actualChangeDates ?? []).forEach((entry) => {
      if (!(entry.trayNumber > 0) || !entry.changedAt) return
      if (!entry.arch || entry.arch === 'superior' || entry.arch === 'ambos') {
        map.set(entry.trayNumber, entry.changedAt)
      }
    })
    return map
  }, [currentCase])
  const actualChangeDateLowerByTray = useMemo(() => {
    const map = new Map<number, string>()
    ;(currentCase?.installation?.actualChangeDates ?? []).forEach((entry) => {
      if (!(entry.trayNumber > 0) || !entry.changedAt) return
      if (!entry.arch || entry.arch === 'inferior' || entry.arch === 'ambos') {
        map.set(entry.trayNumber, entry.changedAt)
      }
    })
    return map
  }, [currentCase])
  const dentistDeliveryDateByArchTray = useMemo(() => {
    const upper = new Map<number, string>()
    const lower = new Map<number, string>()
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
        if (appliesUpper && !upper.has(tray)) upper.set(tray, lot.deliveredToDoctorAt)
        if (appliesLower && !lower.has(tray)) lower.set(tray, lot.deliveredToDoctorAt)
      }
    })
    return { upper, lower }
  }, [currentCase, hasLowerArch, hasUpperArch])
  const manualChangeCompletionUpperByTray = useMemo(() => {
    const map = new Map<number, boolean>()
    ;(currentCase?.installation?.manualChangeCompletion ?? []).forEach((entry) => {
      if (!(entry.trayNumber > 0)) return
      if (!entry.arch || entry.arch === 'superior' || entry.arch === 'ambos') {
        map.set(entry.trayNumber, Boolean(entry.completed))
      }
    })
    return map
  }, [currentCase])
  const manualChangeCompletionLowerByTray = useMemo(() => {
    const map = new Map<number, boolean>()
    ;(currentCase?.installation?.manualChangeCompletion ?? []).forEach((entry) => {
      if (!(entry.trayNumber > 0)) return
      if (!entry.arch || entry.arch === 'inferior' || entry.arch === 'ambos') {
        map.set(entry.trayNumber, Boolean(entry.completed))
      }
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
            actualChangeDateUpperByTray,
            actualChangeDateLowerByTray,
          )
        : [],
    [
      actualChangeDateLowerByTray,
      actualChangeDateUpperByTray,
      currentCase,
      progressLower.delivered,
      progressUpper.delivered,
      totalLower,
      totalUpper,
    ],
  )
  const patientProgressUpper = useMemo(() => {
    const eligibleByDate = changeSchedule.filter((row) => row.trayNumber <= totalUpper && (row.upperChangeDate ?? '') <= todayIso).length
    const progressed = Math.min(eligibleByDate, Math.max(0, Math.trunc(deliveredUpper)))
    return caseProgress(totalUpper, progressed)
  }, [changeSchedule, deliveredUpper, todayIso, totalUpper])
  const patientProgressLower = useMemo(() => {
    const eligibleByDate = changeSchedule.filter((row) => row.trayNumber <= totalLower && (row.lowerChangeDate ?? '') <= todayIso).length
    const progressed = Math.min(eligibleByDate, Math.max(0, Math.trunc(deliveredLower)))
    return caseProgress(totalLower, progressed)
  }, [changeSchedule, deliveredLower, todayIso, totalLower])
  const nextTrayRequired = useMemo(() => {
    if (hasUpperArch && hasLowerArch) return Math.max(0, Math.min(deliveredUpper, deliveredLower)) + 1
    if (hasUpperArch) return Math.max(0, Math.trunc(deliveredUpper)) + 1
    if (hasLowerArch) return Math.max(0, Math.trunc(deliveredLower)) + 1
    return 0
  }, [deliveredLower, deliveredUpper, hasLowerArch, hasUpperArch])
  const maxPlannedTrays = Math.max(totalUpper, totalLower)
  const nextReplacementDueDate = useMemo(() => {
    if (nextTrayRequired <= 0 || nextTrayRequired > maxPlannedTrays) return undefined
    return changeSchedule.find((row) => row.trayNumber === nextTrayRequired)?.changeDate
  }, [changeSchedule, maxPlannedTrays, nextTrayRequired])
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
  const deliveredToProfessionalCount = useMemo(() => {
    if (hasUpperArch && hasLowerArch) return Math.max(0, Math.min(deliveredToDentist.upper, deliveredToDentist.lower))
    if (hasUpperArch) return Math.max(0, deliveredToDentist.upper)
    if (hasLowerArch) return Math.max(0, deliveredToDentist.lower)
    return 0
  }, [deliveredToDentist.lower, deliveredToDentist.upper, hasLowerArch, hasUpperArch])
  const labSummary = useMemo(
    () => {
      const emProducao = pipelineLabItems.filter((item) => item.status === 'em_producao').length
      const controleQualidade = pipelineLabItems.filter((item) => item.status === 'controle_qualidade').length
      const prontas = readyLabItems.length
      if (isAlignerCase && maxPlannedTrays > 0) {
        const aguardando = Math.max(0, maxPlannedTrays - deliveredToProfessionalCount - emProducao - controleQualidade - prontas)
        return {
          aguardando_iniciar: aguardando,
          em_producao: emProducao,
          controle_qualidade: controleQualidade,
          prontas,
          entregues: Math.min(deliveredToProfessionalCount, maxPlannedTrays),
          osItens: linkedLabItems.length,
        }
      }
      return {
        aguardando_iniciar: pipelineLabItems.filter((item) => item.status === 'aguardando_iniciar').length,
        em_producao: emProducao,
        controle_qualidade: controleQualidade,
        prontas,
        entregues: deliveredLabItemIds.size,
        osItens: linkedLabItems.length,
      }
    },
    [deliveredLabItemIds.size, deliveredToProfessionalCount, isAlignerCase, linkedLabItems.length, maxPlannedTrays, pipelineLabItems, readyLabItems.length],
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
  const canConcludeTreatmentManually = useMemo(() => {
    if (!currentCase || currentCase.status === 'finalizado') return false
    const deliveredUpperCount = Math.max(0, Math.trunc(currentCase.installation?.deliveredUpper ?? 0))
    const deliveredLowerCount = Math.max(0, Math.trunc(currentCase.installation?.deliveredLower ?? 0))
    const upperDone = totalUpper <= 0 || deliveredUpperCount >= totalUpper
    const lowerDone = totalLower <= 0 || deliveredLowerCount >= totalLower
    return upperDone && lowerDone && (deliveredUpperCount > 0 || deliveredLowerCount > 0)
  }, [currentCase, totalLower, totalUpper])

  useEffect(() => {
    if (!currentCase?.installation) return
    if (currentCase.status === 'finalizado') return
    const nextStatus = deriveTreatmentStatus({
      installedAt: currentCase.installation.installedAt,
      changeEveryDays: currentCase.changeEveryDays,
      totalUpper,
      totalLower,
      deliveredUpper: currentCase.installation.deliveredUpper ?? 0,
      deliveredLower: currentCase.installation.deliveredLower ?? 0,
      completedUpper: patientProgressUpper.delivered,
      completedLower: patientProgressLower.delivered,
      todayIso: new Date().toISOString().slice(0, 10),
      nextDueDate: nextReplacementDueDate,
    })
    if (nextStatus === currentCase.status) return
    const nextPhase = 'em_producao'
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(
          currentCase.id,
          { status: nextStatus, phase: nextPhase },
          { status: nextStatus, phase: nextPhase },
        )
        if (result.ok) setSupabaseRefreshKey((current) => current + 1)
      })()
      return
    }
    updateCase(currentCase.id, { status: nextStatus, phase: nextPhase })
  }, [currentCase, isSupabaseMode, nextReplacementDueDate, patientProgressLower.delivered, patientProgressUpper.delivered, totalLower, totalUpper])

  const concludeTreatmentManually = () => {
    if (!canWrite || !currentCase) return
    if (!canConcludeTreatmentManually) {
      addToast({ type: 'error', title: 'Concluir tratamento', message: 'Ainda existem placas pendentes para entrega ao paciente.' })
      return
    }
    if (isSupabaseMode) {
      void (async () => {
        const result = await patchCaseDataSupabase(
          currentCase.id,
          { status: 'finalizado', phase: 'finalizado' },
          { status: 'finalizado', phase: 'finalizado' },
        )
        if (!result.ok) {
          addToast({ type: 'error', title: 'Concluir tratamento', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Tratamento concluido manualmente' })
      })()
      return
    }
    const updated = updateCase(currentCase.id, { status: 'finalizado', phase: 'finalizado' })
    if (!updated) {
      addToast({ type: 'error', title: 'Concluir tratamento', message: 'Não foi possível concluir o tratamento.' })
      return
    }
    addToast({ type: 'success', title: 'Tratamento concluido manualmente' })
  }
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
  const replenishmentAlerts = useMemo(() => {
    if (!currentCase?.installation?.installedAt || !nextReplacementDueDate) return []
    const daysLeft = diffDaysBetweenIso(nextReplacementDueDate, todayIso)
    if (daysLeft <= 15 && daysLeft > 10) {
      return [
        {
          id: `${currentCase.id}_15d_${nextReplacementDueDate}`,
          type: 'warning_15d' as const,
          severity: 'medium' as const,
        },
      ]
    }
    if (daysLeft <= 10 && daysLeft >= 0) {
      return [
        {
          id: `${currentCase.id}_10d_${nextReplacementDueDate}`,
          type: 'warning_10d' as const,
          severity: 'high' as const,
        },
      ]
    }
    if (daysLeft < 0) {
      return [
        {
          id: `${currentCase.id}_late_${nextReplacementDueDate}`,
          type: 'overdue' as const,
          severity: 'urgent' as const,
        },
      ]
    }
    return []
  }, [currentCase, nextReplacementDueDate, todayIso])
  const patientDisplayName = useMemo(() => {
    if (!currentCase) return ''
    if (!currentCase.patientId) return currentCase.patientName
    return db.patients.find((item) => item.id === currentCase.patientId)?.name ?? currentCase.patientName
  }, [currentCase, db.patients])
  const patientRecord = useMemo(
    () => (currentCase?.patientId ? db.patients.find((item) => item.id === currentCase.patientId) : undefined),
    [currentCase?.patientId, db.patients],
  )
  const patientWhatsapp = useMemo(() => {
    if (isSupabaseMode) return supabaseCaseRefs.patientWhatsapp ?? patientRecord?.whatsapp ?? patientRecord?.phone
    return patientRecord?.whatsapp ?? patientRecord?.phone
  }, [isSupabaseMode, patientRecord?.phone, patientRecord?.whatsapp, supabaseCaseRefs.patientWhatsapp])
  const dentistsById = useMemo(() => new Map(db.dentists.map((item) => [item.id, item])), [db.dentists])
  const clinicsById = useMemo(() => new Map(db.clinics.map((item) => [item.id, item])), [db.clinics])
  const clinicName = isSupabaseMode
    ? (supabaseCaseRefs.clinicName ?? (currentCase?.clinicId ? clinicsById.get(currentCase.clinicId)?.tradeName : undefined))
    : (currentCase?.clinicId ? clinicsById.get(currentCase.clinicId)?.tradeName : undefined)
  const dentist = currentCase?.dentistId ? dentistsById.get(currentCase.dentistId) : undefined
  const requester = currentCase?.requestedByDentistId ? dentistsById.get(currentCase.requestedByDentistId) : undefined
  const dentistNameResolved = isSupabaseMode ? (supabaseCaseRefs.dentistName ?? dentist?.name) : dentist?.name
  const requesterNameResolved = isSupabaseMode ? (supabaseCaseRefs.requesterName ?? requester?.name) : requester?.name
  const dentistGenderResolved = isSupabaseMode ? (supabaseCaseRefs.dentistGender ?? dentist?.gender) : dentist?.gender
  const requesterGenderResolved = isSupabaseMode ? (supabaseCaseRefs.requesterGender ?? requester?.gender) : requester?.gender
  const dentistPrefix = dentistNameResolved ? (dentistGenderResolved === 'feminino' ? 'Dra.' : 'Dr.') : ''
  const requesterPrefix = requesterNameResolved ? (requesterGenderResolved === 'feminino' ? 'Dra.' : 'Dr.') : ''
  const displayProductLabel = useMemo(() => {
    if (!currentCase) return '-'
    return resolveRequestedProductLabel({
      requestedProductLabel: isSupabaseMode ? supabaseCaseRefs.requestedProductLabel : currentCase.requestedProductLabel ?? localSourceScan?.purposeLabel,
      requestedProductId: isSupabaseMode ? supabaseCaseRefs.requestedProductId : currentCase.requestedProductId ?? localSourceScan?.purposeProductId,
      productType: currentCase.productType ?? localSourceScan?.purposeProductType,
      productId: currentCase.productId ?? localSourceScan?.purposeProductId,
      alignerFallbackLabel: isAlignerCase ? 'Alinhadores' : undefined,
    })
  }, [currentCase, isAlignerCase, isSupabaseMode, localSourceScan, supabaseCaseRefs.requestedProductId, supabaseCaseRefs.requestedProductLabel])
  const displayCaseCode = currentCase ? toReadableCaseCode(currentCase.treatmentCode ?? currentCase.id) : '-'
  const displayTreatmentOrigin = useMemo(() => {
    if (!currentCase) return 'externo' as const
    const normalizedClinicName = (clinicName ?? '').trim().toUpperCase()
    const normalizedClinicId = (currentCase.clinicId ?? '').trim().toLowerCase()
    if (normalizedClinicName === 'ARRIMO' || normalizedClinicId === 'clinic_arrimo' || normalizedClinicId === 'cli-0001') {
      return 'interno' as const
    }
    return currentCase.treatmentOrigin === 'interno' ? ('interno' as const) : ('externo' as const)
  }, [clinicName, currentCase])

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
      <AppShell breadcrumb={['Início', 'Alinhadores']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Pedido não encontrado</h1>
          <p className="mt-2 text-sm text-slate-500">O pedido solicitado não existe ou foi removido.</p>
          <Button className="mt-4" onClick={() => navigate('/app/cases')}>
            Voltar
          </Button>
        </Card>
      </AppShell>
    )
  }

  if (!isSupabaseMode && !scopedCases.some((item) => item.id === currentCase.id)) {
    return (
      <AppShell breadcrumb={['Início', 'Alinhadores']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Sem acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Seu perfil não permite visualizar este pedido.</p>
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
          addToast({ type: 'error', title: 'Rework', message: 'Não foi possível devolver a placa ao banco.' })
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
        const result = await patchCaseDataSupabase(currentCase.id, { phase: 'orçamento', status: 'planejamento' }, { status: 'planejamento', phase: 'orçamento' })
        if (!result.ok) {
          addToast({ type: 'error', title: 'Planejamento', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Planejamento concluido' })
      })()
      return
    }
    updateCase(currentCase.id, { phase: 'orçamento', status: 'planejamento' })
    addToast({ type: 'success', title: 'Planejamento concluido' })
  }

  const closeBudget = () => {
    if (!canWrite) return
    const parsed = parseBrlCurrencyInput(budgetValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      addToast({ type: 'error', title: 'Orçamento', message: 'Informe um valor valido para o orçamento.' })
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
          addToast({ type: 'error', title: 'Orçamento', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Orçamento fechado' })
      })()
      return
    }
    updateCase(currentCase.id, {
      phase: 'contrato_pendente',
      status: 'planejamento',
      budget: { value: parsed, notes: budgetNotes.trim() || undefined, createdAt: new Date().toISOString() },
      contract: { ...(currentCase.contract ?? { status: 'pendente' }), status: 'pendente', notes: contractNotes.trim() || undefined },
    })
    addToast({ type: 'success', title: 'Orçamento fechado' })
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
    const confirmed = window.confirm('Confirma excluir este pedido? Esta ação remove itens LAB vinculados e registra no historico do paciente.')
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
        printLabOrder(true)
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
    printLabOrder(true)
  }

  const printLabOrder = (skipProductionCheck = false) => {
    if (!skipProductionCheck && !hasProductionOrder) {
      addToast({ type: 'error', title: 'Imprimir OS', message: 'Gere a OS do LAB antes de imprimir.' })
      return
    }

    const escapeHtml = (value: unknown) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')

    const caseLabel = displayCaseCode
    const planLabel = hasUpperArch && hasLowerArch
      ? `Superior ${totalUpper} | Inferior ${totalLower}`
      : hasUpperArch
        ? `Superior ${totalUpper}`
        : hasLowerArch
          ? `Inferior ${totalLower}`
          : '-'

    const issueDate = new Date()
    const issueDateLabel = issueDate.toLocaleString('pt-BR')
    const productLabel = displayProductLabel
    const dentistLabel = dentistNameResolved ? `Dr. ${dentistNameResolved}` : '-'
    const requesterLabel = requesterNameResolved ? `Dr. ${requesterNameResolved}` : dentistLabel
    const patientBirthDate = currentCase.patientId
      ? (isSupabaseMode
          ? supabaseCaseRefs.patientBirthDate
          : db.patients.find((item) => item.id === currentCase.patientId)?.birthDate)
      : undefined
    const patientBirthDateLabel = patientBirthDate ? new Date(`${patientBirthDate}T00:00:00`).toLocaleDateString('pt-BR') : '-'
    const expectedDeliveryDate = new Date(issueDate)
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 10)
    const expectedDeliveryLabel = expectedDeliveryDate.toLocaleDateString('pt-BR')
    const emittedByRaw = currentUser?.name || currentUser?.email || 'Sistema'
    const emittedBy = emittedByRaw.includes('@') ? emittedByRaw.split('@')[0] : emittedByRaw
    const emitOrigin = window.location.origin

    const html = `
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Ordem de Serviço Inicial</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
            .header { display: grid; grid-template-columns: 250px 1fr; gap: 12px; border: 1px solid #1e293b; padding: 10px; margin-bottom: 10px; }
            .brand { border-right: 1px solid #cbd5e1; padding-right: 10px; }
            .brand img { max-width: 225px; max-height: 72px; object-fit: contain; display: block; margin-bottom: 6px; }
            .brand p { margin: 2px 0; font-size: 11px; color: #475569; }
            .doc h1 { margin: 0; font-size: 18px; letter-spacing: 0.3px; }
            .doc p { margin: 3px 0; color: #334155; font-size: 11px; }
            .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
            .meta-box { border: 1px solid #94a3b8; border-radius: 4px; padding: 7px; }
            .meta-label { font-size: 10px; text-transform: uppercase; color: #475569; margin-bottom: 2px; letter-spacing: .3px; }
            .meta-value { font-weight: 700; color: #0f172a; }
            .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
            .sign-box { border: 1px solid #94a3b8; border-radius: 4px; padding: 8px; min-height: 92px; }
            .sign-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; }
            .line { margin-top: 26px; border-top: 1px solid #64748b; font-size: 11px; padding-top: 4px; color: #334155; }
            .emit { margin-top: 14px; font-size: 10px; color: #475569; text-align: left; border-top: 1px solid #cbd5e1; padding-top: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="brand">
              <img src="${window.location.origin}/brand/orthoscan.png" alt="Orthoscan" />
              <p>Odontologia Digital</p>
            </div>
            <div class="doc">
              <h1>ORDEM DE SERVICO INICIAL (O.S)</h1>
              <p><strong>Data/Hora:</strong> ${escapeHtml(issueDateLabel)}</p>
              <p><strong>Nº Caso:</strong> ${escapeHtml(caseLabel)}</p>
            </div>
          </div>

          <div class="meta">
            <div class="meta-box"><div class="meta-label">Paciente</div><div class="meta-value">${escapeHtml(currentCase.patientName)}</div></div>
            <div class="meta-box"><div class="meta-label">Data de nascimento</div><div class="meta-value">${escapeHtml(patientBirthDateLabel)}</div></div>
            <div class="meta-box"><div class="meta-label">Clínica</div><div class="meta-value">${escapeHtml(clinicName ?? '-')}</div></div>
            <div class="meta-box"><div class="meta-label">Dentista responsável</div><div class="meta-value">${escapeHtml(dentistLabel)}</div></div>
            <div class="meta-box"><div class="meta-label">Solicitante</div><div class="meta-value">${escapeHtml(requesterLabel)}</div></div>
            <div class="meta-box"><div class="meta-label">Produto</div><div class="meta-value">${escapeHtml(productLabel)}</div></div>
            <div class="meta-box"><div class="meta-label">Planejamento</div><div class="meta-value">${escapeHtml(planLabel)}</div></div>
            <div class="meta-box"><div class="meta-label">Troca</div><div class="meta-value">${escapeHtml(String(currentCase.changeEveryDays))} dias</div></div>
            <div class="meta-box"><div class="meta-label">Data prevista entrega ao profissional</div><div class="meta-value">${escapeHtml(expectedDeliveryLabel)}</div></div>
          </div>

          <div class="sign-grid">
            <div class="sign-box">
              <p class="sign-title">Entrega ao laboratorio</p>
              <div class="line">Assinatura: ____________________________________</div>
              <div class="line">Data: ____/____/________</div>
            </div>
            <div class="sign-box">
              <p class="sign-title">Entrega ao dentista</p>
              <div class="line">Assinatura: ____________________________________</div>
              <div class="line">Data: ____/____/________</div>
            </div>
          </div>

          <div class="emit">Emitido por ${escapeHtml(emittedBy)} Através da plataforma Orthoscan Laboratório Em ${escapeHtml(issueDateLabel)} - ${escapeHtml(emitOrigin)}</div>
        </body>
      </html>
    `

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const printUrl = URL.createObjectURL(blob)
    const popup = window.open(printUrl, '_blank')
    if (!popup) {
      addToast({ type: 'error', title: 'Imprimir OS', message: 'Não foi possível abrir a janela de impressão.' })
      return
    }

    const releaseUrl = () => {
      try {
        URL.revokeObjectURL(printUrl)
      } catch {
        // noop
      }
    }
    const onLoaded = () => {
      popup.focus()
      popup.print()
      setTimeout(releaseUrl, 10_000)
    }
    if (popup.document.readyState === 'complete') {
      onLoaded()
    } else {
      popup.addEventListener('load', onLoaded, { once: true })
    }
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
      addToast({ type: 'error', title: 'Instalação', message: 'Informe quantidades validas por arcada.' })
      return
    }
    if (hasUpperArch && Math.trunc(upperCount) > readyToDeliverPatient.upper) {
      addToast({
        type: 'error',
        title: 'Instalação',
        message: `Superior disponivel para paciente: ${readyToDeliverPatient.upper} (entregue pelo LAB ao profissional e ainda não consumido).`,
      })
      return
    }
    if (hasLowerArch && Math.trunc(lowerCount) > readyToDeliverPatient.lower) {
      addToast({
        type: 'error',
        title: 'Instalação',
        message: `Inferior disponivel para paciente: ${readyToDeliverPatient.lower} (entregue pelo LAB ao profissional e ainda não consumido).`,
      })
      return
    }
    if (!currentCase.installation && Math.trunc(upperCount + lowerCount) <= 0) {
      addToast({
        type: 'error',
        title: 'Instalação',
        message: 'Na primeira instalação, informe ao menos 1 alinhador entregue ao paciente.',
      })
      return
    }
    if (isSupabaseMode) {
      if (!hasProductionOrder) {
        addToast({ type: 'error', title: 'Instalação', message: 'Ordem de serviço do LAB ainda não foi gerada para este pedido.' })
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
      const nextTrayAfterDelivery =
        hasUpperArch && hasLowerArch
          ? Math.max(0, Math.min(deliveredUpper, deliveredLower)) + 1
          : hasUpperArch
            ? Math.max(0, Math.trunc(deliveredUpper)) + 1
            : Math.max(0, Math.trunc(deliveredLower)) + 1
      const nextDueAfterDelivery =
        nextTrayAfterDelivery > 0
          ? changeSchedule.find((row) => row.trayNumber === nextTrayAfterDelivery)?.changeDate
          : undefined
      const nextStatus = deriveTreatmentStatus({
        installedAt: currentInstallation?.installedAt ?? installationDate,
        changeEveryDays: currentCase.changeEveryDays,
        totalUpper: upperTotal,
        totalLower: lowerTotal,
        deliveredUpper,
        deliveredLower,
        todayIso: new Date().toISOString().slice(0, 10),
        nextDueDate: nextDueAfterDelivery,
      })
      const nextPhase = 'em_producao'
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
            status: nextStatus,
            phase: nextPhase,
          },
          { status: nextStatus, phase: nextPhase },
        )
        if (!result.ok) {
          addToast({ type: 'error', title: 'Instalação', message: result.error })
          return
        }
        setSupabaseRefreshKey((current) => current + 1)
        addToast({ type: 'success', title: 'Instalação registrada' })
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
      addToast({ type: 'error', title: 'Instalação', message: result.error })
      return
    }
    const nextDeliveredUpper = (currentCase.installation?.deliveredUpper ?? 0) + Math.trunc(upperCount)
    const nextDeliveredLower = (currentCase.installation?.deliveredLower ?? 0) + Math.trunc(lowerCount)
    const nextTrayAfterDelivery =
      hasUpperArch && hasLowerArch
        ? Math.max(0, Math.min(nextDeliveredUpper, nextDeliveredLower)) + 1
        : hasUpperArch
          ? Math.max(0, Math.trunc(nextDeliveredUpper)) + 1
          : Math.max(0, Math.trunc(nextDeliveredLower)) + 1
    const nextDueAfterDelivery =
      nextTrayAfterDelivery > 0
        ? changeSchedule.find((row) => row.trayNumber === nextTrayAfterDelivery)?.changeDate
        : undefined
    const nextStatus = deriveTreatmentStatus({
      installedAt: currentCase.installation?.installedAt ?? installationDate,
      changeEveryDays: currentCase.changeEveryDays,
      totalUpper,
      totalLower,
      deliveredUpper: nextDeliveredUpper,
      deliveredLower: nextDeliveredLower,
      todayIso: new Date().toISOString().slice(0, 10),
      nextDueDate: nextDueAfterDelivery,
    })
    updateCase(currentCase.id, {
      status: nextStatus,
      phase: 'em_producao',
    })
    addToast({ type: 'success', title: 'Instalação registrada' })
  }

  const saveActualChangeDate = (arch: 'superior' | 'inferior', trayNumber: number, changedAt: string) => {
    if (!canWrite) return
    if (!currentCase.installation) return
    const nextActualDates = (currentCase.installation.actualChangeDates ?? []).filter(
      (entry) => !(entry.trayNumber === trayNumber && (!entry.arch || entry.arch === arch || entry.arch === 'ambos')),
    )
    if (changedAt) {
      nextActualDates.push({ trayNumber, changedAt, arch })
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
      addToast({ type: 'error', title: 'Troca real', message: 'Não foi possível atualizar a data real de troca.' })
      return
    }
    addToast({ type: 'success', title: 'Troca real atualizada' })
  }

  const saveManualChangeCompletion = (arch: 'superior' | 'inferior', trayNumber: number, completed: boolean) => {
    if (!canWrite) return
    if (!currentCase.installation) return
    const nextCompletion = (currentCase.installation.manualChangeCompletion ?? []).filter(
      (entry) => !(entry.trayNumber === trayNumber && (!entry.arch || entry.arch === arch || entry.arch === 'ambos')),
    )
    nextCompletion.push({ trayNumber, completed, arch })
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
      addToast({ type: 'error', title: 'Troca concluida', message: 'Não foi possível atualizar status manual.' })
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
    <AppShell breadcrumb={['Início', 'Alinhadores', patientDisplayName]}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Paciente: {patientDisplayName}</h1>
          {currentCase.treatmentCode ? (
            <p className="mt-1 text-sm font-semibold text-slate-700">
              Identificacao: {displayCaseCode} ({displayTreatmentOrigin === 'interno' ? 'Interno ARRIMO' : 'Externo'})
            </p>
          ) : null}
          <p className="mt-1 text-sm font-medium text-slate-600">
            Produto: {displayProductLabel} | Nº Caso: {displayCaseCode}
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
            | Troca {currentCase.changeEveryDays} dias | Attachments: {currentCase.attachmentBondingTray ? 'Sim' : 'Não'}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Badge tone={caseStatusToneMap[currentCase.status]}>{caseStatusLabelMap[currentCase.status]}</Badge>
            <span className="text-xs text-slate-500">
              Ultima atualizacao: {new Date(currentCase.updatedAt).toLocaleString('pt-BR')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canConcludeTreatmentManually ? (
            <Button type="button" onClick={concludeTreatmentManually}>
              Concluir tratamento
            </Button>
          ) : null}
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
            <p className="mt-1 text-sm text-slate-500">Status atual: {caseStatusLabelMap[currentCase.status]}</p>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 1 - Planejamento</p>
                <Button className="mt-2" size="sm" onClick={concludePlanning} disabled={currentCase.phase !== 'planejamento' || !canWrite}>
                  Concluir planejamento
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 2 - Orçamento</p>
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
                    placeholder="Observacões do orçamento"
                    value={budgetNotes}
                    onChange={(event) => setBudgetNotes(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <Button size="sm" onClick={closeBudget} disabled={currentCase.phase !== 'orçamento' || !canWrite}>
                    Fechar orçamento
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
                  placeholder="Observacões do contrato"
                  value={contractNotes}
                  onChange={(event) => setContractNotes(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <Button className="mt-2" size="sm" onClick={approveContract} disabled={currentCase.phase !== 'contrato_pendente' || !canWrite}>
                  Aprovar contrato
                </Button>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-800">Etapa 4 - Ordem de Serviço (LAB)</p>
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
          <h2 className="text-lg font-semibold text-slate-900">Pedido e reposição paciente</h2>
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
                {currentCase.installation ? 'Data da entrega ao paciente' : 'Data da instalação inicial'}
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
                {currentCase.installation ? 'Registrar reposição paciente' : 'Registrar instalação inicial'}
              </Button>
              {!hasProductionOrder ? <p className="mt-2 text-xs text-amber-700">Ordem de serviço do LAB ainda não gerada.</p> : null}
              {!hasDentistDelivery ? <p className="mt-1 text-xs text-amber-700">Registre antes a entrega ao dentista.</p> : null}
            </div>
          </div>
        </Card>

      </section>

      {isAlignerCase ? (
      <section className="mt-6">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Reposição prevista</h2>
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
            <p>Proxima placa necessaria: {nextTrayRequired > 0 && nextTrayRequired <= maxPlannedTrays ? `#${nextTrayRequired}` : 'Nenhuma (pedido completo)'}</p>
            <p>
              Proxima reposição prevista para:{' '}
              {nextReplacementDueDate ? new Date(`${nextReplacementDueDate}T00:00:00`).toLocaleDateString('pt-BR') : '-'}
            </p>
            {!currentCase.installation?.installedAt ? (
              <p className="text-sm text-slate-500">Registre a instalação para calcular reposicões.</p>
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
          <h2 className="text-lg font-semibold text-slate-900">Informacões clinicas</h2>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profissional / Clínica</p>
              <p className="mt-1">
                <span className="font-medium">Clínica:</span> {clinicName || '-'}
              </p>
              <p>
                <span className="font-medium">Dentista responsável:</span>{' '}
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
                  <span className="font-medium">Placa de attachments:</span> {currentCase.attachmentBondingTray ? 'Sim' : 'Não'}
                </p>
              </>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Produto sem fluxo de placas de alinhadores. Fluxo focado em registro de instalação.
              </p>
            )}
            <p>
              <span className="font-medium">Fonte:</span> {currentCase.sourceScanId ? `Scan ${currentCase.sourceScanId}` : 'Não vinculado'}
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
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Placa superior</th> : null}
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Data entrega (sup)</th> : null}
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Data troca (sup)</th> : null}
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Status entrega (sup)</th> : null}
                  {hasUpperArch ? <th className="px-3 py-2 font-semibold">Concluído (sup)</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Placa inferior</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Data entrega (inf)</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Data troca (inf)</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Status entrega (inf)</th> : null}
                  {hasLowerArch ? <th className="px-3 py-2 font-semibold">Concluído (inf)</th> : null}
                  <th className="px-3 py-2 font-semibold">WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {changeSchedule.length === 0 ? (
                  <tr>
                    <td colSpan={(hasUpperArch ? 5 : 0) + (hasLowerArch ? 5 : 0) + 1} className="px-3 py-4 text-slate-500">
                      Registre a instalação para gerar agenda de trocas.
                    </td>
                  </tr>
                ) : (
                  changeSchedule.map((row) => {
                    const dueReachedUpper = (row.upperChangeDate ?? '') <= todayIso
                    const dueReachedLower = (row.lowerChangeDate ?? '') <= todayIso
                    const manualCompletedUpper = manualChangeCompletionUpperByTray.get(row.trayNumber)
                    const manualCompletedLower = manualChangeCompletionLowerByTray.get(row.trayNumber)
                    const trocaConcluidaUpper = typeof manualCompletedUpper === 'boolean' ? manualCompletedUpper : dueReachedUpper
                    const trocaConcluidaLower = typeof manualCompletedLower === 'boolean' ? manualCompletedLower : dueReachedLower
                    const deliveredUpperAt = dentistDeliveryDateByArchTray.upper.get(row.trayNumber)
                    const deliveredLowerAt = dentistDeliveryDateByArchTray.lower.get(row.trayNumber)
                    const whatsappHref = buildAlignerWhatsappHref(patientWhatsapp, patientDisplayName || currentCase.patientName, row.trayNumber)

                    return (
                      <tr key={row.trayNumber} className="border-t border-slate-100">
                        {hasUpperArch ? <td className="px-3 py-2 font-semibold text-slate-800">#{row.trayNumber <= totalUpper ? row.trayNumber : '-'}</td> : null}
                        {hasUpperArch ? <td className="px-3 py-2 text-slate-700">{deliveredUpperAt ? new Date(`${deliveredUpperAt}T00:00:00`).toLocaleDateString('pt-BR') : '-'}</td> : null}
                        {hasUpperArch ? (
                          <td className="px-3 py-2 text-slate-700">
                            {row.trayNumber <= totalUpper ? (
                              <Input
                                type="date"
                                value={row.upperChangeDate ?? row.upperPlannedDate ?? ''}
                                onChange={(event) => saveActualChangeDate('superior', row.trayNumber, event.target.value)}
                                disabled={!canWrite}
                              />
                            ) : (
                              '-'
                            )}
                          </td>
                        ) : null}
                        {hasUpperArch ? <td className={`px-3 py-2 font-medium ${scheduleStateClass(row.superiorState)}`}>{scheduleStateLabel(row.superiorState)}</td> : null}
                        {hasUpperArch ? (
                          <td className="px-3 py-2 text-slate-700">
                            {row.trayNumber <= totalUpper ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                    trocaConcluidaUpper ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                  }`}
                                  onClick={() => saveManualChangeCompletion('superior', row.trayNumber, true)}
                                  disabled={!canWrite}
                                >
                                  Sim
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                    !trocaConcluidaUpper ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'
                                  }`}
                                  onClick={() => saveManualChangeCompletion('superior', row.trayNumber, false)}
                                  disabled={!canWrite}
                                >
                                  Não
                                </button>
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                        ) : null}
                        {hasLowerArch ? <td className="px-3 py-2 font-semibold text-slate-800">#{row.trayNumber <= totalLower ? row.trayNumber : '-'}</td> : null}
                        {hasLowerArch ? <td className="px-3 py-2 text-slate-700">{deliveredLowerAt ? new Date(`${deliveredLowerAt}T00:00:00`).toLocaleDateString('pt-BR') : '-'}</td> : null}
                        {hasLowerArch ? (
                          <td className="px-3 py-2 text-slate-700">
                            {row.trayNumber <= totalLower ? (
                              <Input
                                type="date"
                                value={row.lowerChangeDate ?? row.lowerPlannedDate ?? ''}
                                onChange={(event) => saveActualChangeDate('inferior', row.trayNumber, event.target.value)}
                                disabled={!canWrite}
                              />
                            ) : (
                              '-'
                            )}
                          </td>
                        ) : null}
                        {hasLowerArch ? <td className={`px-3 py-2 font-medium ${scheduleStateClass(row.inferiorState)}`}>{scheduleStateLabel(row.inferiorState)}</td> : null}
                        {hasLowerArch ? (
                          <td className="px-3 py-2 text-slate-700">
                            {row.trayNumber <= totalLower ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                    trocaConcluidaLower ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                  }`}
                                  onClick={() => saveManualChangeCompletion('inferior', row.trayNumber, true)}
                                  disabled={!canWrite}
                                >
                                  Sim
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                    !trocaConcluidaLower ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'
                                  }`}
                                  onClick={() => saveManualChangeCompletion('inferior', row.trayNumber, false)}
                                  disabled={!canWrite}
                                >
                                  Não
                                </button>
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-slate-700">
                          {whatsappHref ? (
                            <button
                              type="button"
                              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700"
                              onClick={() => window.open(whatsappHref, '_blank', 'noopener,noreferrer')}
                            >
                              WhatsApp
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Sem WhatsApp</span>
                          )}
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
                Exclusão administrativa: remove pedido e registros vinculados do fluxo.
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






