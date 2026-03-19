import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../app/ToastProvider'
import RegisterDeliveryLotModal from '../components/cases/RegisterDeliveryLotModal'
import LabBoard from '../components/lab/LabBoard'
import LabFilters from '../components/lab/LabFilters'
import LabItemModal from '../components/lab/LabItemModal'
import LabKpiRow from '../components/lab/LabKpiRow'
import AiEditableModal from '../components/ai/AiEditableModal'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { DATA_MODE } from '../data/dataMode'
import { registerCaseDeliveryLot, updateCase } from '../data/caseRepo'
import { addLabItem, createAdvanceLabOrder, deleteLabItem, listLabItems, moveLabItem, updateLabItem } from '../data/labRepo'
import { getPipelineItems } from '../domain/labPipeline'
import { getNextDeliveryDueDate, getReplenishmentAlerts } from '../domain/replenishment'
import AppShell from '../layouts/AppShell'
import type { LabItem, LabStatus } from '../types/Lab'
import type { ProductType } from '../types/Product'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { listCasesForUser, listLabItemsForUser } from '../auth/scope'
import { supabase } from '../lib/supabaseClient'
import { loadSystemSettings } from '../lib/systemSettings'
import { resolveRequestedProductLabel } from '../lib/productLabel'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { useAiModuleEnabled } from '../lib/useAiModuleEnabled'
import { deleteLabItemSupabase } from '../repo/profileRepo'
import { runAiEndpoint as runAiRequest } from '../repo/aiRepo'
import { normalizeOrthTreatmentCode } from '../lib/treatmentCode'
import { resolveTreatmentOrigin } from '../lib/treatmentOrigin'

type ModalState =
  | { open: false; mode: 'create' | 'edit'; item: null }
  | { open: true; mode: 'create'; item: null }
  | { open: true; mode: 'edit'; item: LabItem }

type ProductionConfirmState = {
  open: boolean
  productLabel: string
  archLabel: string
  resolver: ((confirmed: boolean) => void) | null
}

type PatientOption = {
  id: string
  shortId?: string
  name: string
  birthDate?: string
  dentistId?: string
  clinicId?: string
  dentistName?: string
  clinicName?: string
}
type CasePrintFallback = {
  clinicName?: string
  dentistName?: string
  requesterName?: string
  patientBirthDate?: string
}

type GuideMetaBox = {
  label: string
  value: string
  full?: boolean
}

type GuidePrintContext = {
  caseLabel: string
  issueDateLabel: string
  patientName: string
  patientBirthDateLabel: string
  clinicName: string
  dentistName: string
  requesterName: string
  productLabel: string
  planLabel: string
  changeDaysLabel: string
  deliveryExpectedLabel: string
  emittedBy: string
  emitOrigin: string
  hasUpperArch: boolean
  hasLowerArch: boolean
}

type GuidePrintOptions =
  | { kind: 'initial' }
  | {
      kind: 'delivery_receipt'
      deliveredToDoctorAt: string
      deliveredUpperQty: number
      deliveredLowerQty: number
      note?: string
    }

const BROTHER_PRINTER_STORAGE_KEY = 'orthoscan.lab.brother_printer_name'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripProfessionalTitle(value: string) {
  return normalizeSpaces(value).replace(/^(dr|dra)\.?\s+/i, '').trim()
}

function firstWord(value: string) {
  return normalizeSpaces(value).split(' ')[0] ?? ''
}

function toDentistShortLabelByGender(value: string, gender?: 'masculino' | 'feminino') {
  const clean = stripProfessionalTitle(value)
  const firstName = firstWord(clean)
  const prefix = gender === 'feminino' ? 'Dra.' : 'Dr.'
  return firstName ? `${prefix} ${firstName}` : prefix
}

function toPatientStickerName(value: string) {
  const parts = normalizeSpaces(value).split(' ').filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? '-'
  if (parts.length >= 3) return `${parts[0]} ${parts[1]}`
  return `${parts[0]} ${parts[parts.length - 1]}`
}

function isOverdue(item: LabItem) {
  if (item.status === 'prontas') {
    return false
  }
  const due = new Date(`${item.dueDate}T00:00:00`)
  const today = new Date()
  return due < new Date(today.toISOString().slice(0, 10))
}

function formatDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('pt-BR')
}

function toNonNegativeInt(value?: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value ?? 0))
}

function getCaseTotalsByArch(caseItem?: { totalTrays: number; totalTraysUpper?: number; totalTraysLower?: number }) {
  if (!caseItem) return { upper: 0, lower: 0 }
  return {
    upper: toNonNegativeInt(caseItem.totalTraysUpper ?? caseItem.totalTrays),
    lower: toNonNegativeInt(caseItem.totalTraysLower ?? caseItem.totalTrays),
  }
}

function normalizeByTreatmentArch(
  counts: { upper: number; lower: number },
  arch: 'superior' | 'inferior' | 'ambos' | '',
) {
  if (arch === 'superior') return { upper: counts.upper, lower: 0 }
  if (arch === 'inferior') return { upper: 0, lower: counts.lower }
  return counts
}

function formatInfSupByArch(
  counts: { upper: number; lower: number },
  arch: 'superior' | 'inferior' | 'ambos' | '',
) {
  const lower = arch === 'superior' ? '-' : String(counts.lower)
  const upper = arch === 'inferior' ? '-' : String(counts.upper)
  return `${lower}/${upper}`
}

function formatFriendlyRequestCode(code?: string) {
  if (!code) return '-'
  return code.trim()
}

function revisionSuffix(code?: string) {
  if (!code) return ''
  const match = code.trim().match(/(\/\d+)$/)
  return match ? match[1] : ''
}

function getDeliveredByArch(caseItem?: {
  installation?: { deliveredUpper?: number; deliveredLower?: number }
}) {
  if (!caseItem) return { upper: 0, lower: 0 }
  return {
    upper: toNonNegativeInt(caseItem.installation?.deliveredUpper),
    lower: toNonNegativeInt(caseItem.installation?.deliveredLower),
  }
}

function minusDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function caseCode(caseItem: { treatmentCode?: string; id: string }) {
  return caseItem.treatmentCode ?? caseItem.id
}

function nextRequestRevisionFromCodes(baseCode: string, codes: string[]) {
  const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escapedBase}/(\\d+)$`)
  const max = codes.reduce((acc, code) => {
    const match = code.match(regex)
    if (!match) return acc
    return Math.max(acc, Number(match[1]))
  }, 0)
  return max + 1
}

function isReworkItem(item: LabItem) {
  return item.requestKind === 'reconfeccao'
}

function isReworkProductionItem(item: LabItem) {
  return (item.requestKind ?? 'producao') === 'producao' && (item.notes ?? '').toLowerCase().includes('rework')
}

function hasRevisionSuffix(code?: string) {
  if (!code) return false
  return /\/\d+$/.test(code)
}

function isDeliveredToProfessionalItem(
  item: LabItem,
  caseById: Map<string, {
    deliveryLots?: Array<{ arch: 'superior' | 'inferior' | 'ambos'; quantity: number }>
    trays?: Array<{ trayNumber: number; state: string }>
  }>,
) {
  if (item.deliveredToProfessionalAt) return true
  if (!item.caseId) return false
  if (item.status !== 'prontas') return false
  const caseItem = caseById.get(item.caseId)
  const hasAnyDeliveryLot = (caseItem?.deliveryLots?.length ?? 0) > 0
  if ((item.requestKind ?? 'producao') === 'producao' && hasAnyDeliveryLot && !hasRevisionSuffix(item.requestCode)) {
    return true
  }
  const tray = caseItem?.trays?.find((current) => current.trayNumber === item.trayNumber)
  return tray?.state === 'entregue'
}

function hasRemainingByArch(caseItem?: {
  totalTrays: number
  totalTraysUpper?: number
  totalTraysLower?: number
  arch?: 'superior' | 'inferior' | 'ambos'
  installation?: { deliveredUpper?: number; deliveredLower?: number }
  deliveryLots?: Array<{ arch: 'superior' | 'inferior' | 'ambos'; quantity: number }>
}) {
  if (!caseItem) return false
  const treatmentArch = caseItem.arch ?? 'ambos'
  const totals = normalizeByTreatmentArch(getCaseTotalsByArch(caseItem), treatmentArch)
  const delivered = normalizeByTreatmentArch(getDeliveredByArch(caseItem), treatmentArch)
  return Math.max(0, totals.upper - delivered.upper) > 0 || Math.max(0, totals.lower - delivered.lower) > 0
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function archLabel(arch: 'superior' | 'inferior' | 'ambos' | '') {
  if (arch === 'superior') return 'Superior'
  if (arch === 'inferior') return 'Inferior'
  if (arch === 'ambos') return 'Ambas'
  return ''
}

function withProfessionalPrefix(name: string) {
  return name && name !== '-' ? (name.toLowerCase().startsWith('dr.') ? name : `Dr. ${name}`) : '-'
}

function formatGuideDate(dateIso?: string) {
  if (!dateIso) return '-'
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('pt-BR')
}

function buildLabGuideHtml(context: GuidePrintContext, options: GuidePrintOptions) {
  const isDeliveryReceipt = options.kind === 'delivery_receipt'
  const documentTitle = isDeliveryReceipt ? 'Comprovante de Entrega ao Dentista' : 'Ordem de Servico Inicial'
  const documentHeading = isDeliveryReceipt ? 'COMPROVANTE DE ENTREGA AO DENTISTA' : 'ORDEM DE SERVICO INICIAL (O.S)'
  const signatureLeftTitle = isDeliveryReceipt ? 'Conferencia do laboratorio' : 'Entrega ao laboratorio'
  const signatureRightTitle = isDeliveryReceipt ? 'Recebido pelo dentista' : 'Entrega ao dentista'
  const deliveryControlRowsHtml = isDeliveryReceipt
    ? ''
    : Array.from({ length: 5 }, () => `
        <div class="delivery-record">
          <span class="delivery-label">Entregues alinhadores</span>
          <span class="delivery-qty">____ SUP - ____ INF</span>
          <span class="delivery-date">____/____/____</span>
        </div>
      `).join('')
  const metaBoxes: GuideMetaBox[] = [
    { label: 'Paciente', value: context.patientName },
    { label: 'Data de nascimento', value: context.patientBirthDateLabel },
    { label: 'Clinica', value: context.clinicName },
    { label: 'Dentista responsavel', value: context.dentistName },
    { label: 'Solicitante', value: context.requesterName },
    { label: 'Produto', value: context.productLabel },
    { label: 'Planejamento', value: context.planLabel },
    { label: 'Troca', value: `${context.changeDaysLabel} dias` },
    { label: 'Data prevista entrega ao profissional', value: context.deliveryExpectedLabel },
  ]

  if (isDeliveryReceipt) {
    const hasQuantityInfo = options.deliveredUpperQty > 0 || options.deliveredLowerQty > 0
    metaBoxes.push({
      label: 'Data da entrega ao dentista',
      value: formatGuideDate(options.deliveredToDoctorAt),
    })
    if (hasQuantityInfo) {
      metaBoxes.push(
        {
          label: 'Qtd entregue superior',
          value: context.hasUpperArch && options.deliveredUpperQty > 0 ? String(options.deliveredUpperQty) : '-',
        },
        {
          label: 'Qtd entregue inferior',
          value: context.hasLowerArch && options.deliveredLowerQty > 0 ? String(options.deliveredLowerQty) : '-',
        },
      )
    }
    if (options.note?.trim()) {
      metaBoxes.push({ label: 'Observacao', value: options.note.trim(), full: true })
    }
  }

  const metaBoxesHtml = metaBoxes
    .map(
      (box) => `
        <div class="meta-box${box.full ? ' full' : ''}">
          <div class="meta-label">${escapeHtml(box.label)}</div>
          <div class="meta-value">${escapeHtml(box.value)}</div>
        </div>
      `,
    )
    .join('')

  return `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(documentTitle)}</title>
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
        .meta-box.full { grid-column: 1 / -1; }
        .meta-label { font-size: 10px; text-transform: uppercase; color: #475569; margin-bottom: 2px; letter-spacing: .3px; }
        .meta-value { font-weight: 700; color: #0f172a; white-space: pre-wrap; word-break: break-word; }
        .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
        .sign-box { border: 1px solid #94a3b8; border-radius: 4px; padding: 8px; min-height: 92px; }
        .sign-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; }
        .line { margin-top: 26px; border-top: 1px solid #64748b; font-size: 11px; padding-top: 4px; color: #334155; }
        .delivery-records { margin-top: 12px; display: grid; gap: 6px; }
        .delivery-record { display: flex; align-items: flex-end; gap: 8px; font-size: 10px; color: #334155; white-space: nowrap; }
        .delivery-label { min-width: 118px; }
        .delivery-qty, .delivery-date { display: inline-block; border-bottom: 1px solid #64748b; padding-bottom: 2px; line-height: 1.2; }
        .delivery-qty { min-width: 122px; }
        .delivery-date { min-width: 92px; text-align: center; }
        .emit { margin-top: 14px; font-size: 10px; color: #475569; border-top: 1px solid #cbd5e1; padding-top: 8px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">
          <img src="${window.location.origin}/brand/orthoscan.png" alt="Orthoscan" />
          <p>Odontologia Digital</p>
        </div>
        <div class="doc">
          <h1>${escapeHtml(documentHeading)}</h1>
          <p><strong>Data/Hora:</strong> ${escapeHtml(context.issueDateLabel)}</p>
          <p><strong>Codigo do caso:</strong> ${escapeHtml(context.caseLabel)}</p>
        </div>
      </div>

      <div class="meta">
        ${metaBoxesHtml}
      </div>

      <div class="sign-grid">
        <div class="sign-box">
          <p class="sign-title">${escapeHtml(signatureLeftTitle)}</p>
          <div class="line">Assinatura: ____________________________________</div>
          <div class="line">Data: ____/____/________</div>
        </div>
        <div class="sign-box">
          <p class="sign-title">${escapeHtml(signatureRightTitle)}</p>
          <div class="line">Assinatura: ____________________________________</div>
          <div class="line">Data: ____/____/________</div>
          ${deliveryControlRowsHtml ? `<div class="delivery-records">${deliveryControlRowsHtml}</div>` : ''}
        </div>
      </div>

      <div class="emit">Emitido por ${escapeHtml(context.emittedBy)} Através da plataforma Orthoscan Laboratorio Em ${escapeHtml(context.issueDateLabel)} - ${escapeHtml(context.emitOrigin)}</div>
    </body>
    </html>
  `
}

export default function LabPage() {
  const [searchParams] = useSearchParams()
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'lab.write')
  const aiLabEnabled = useAiModuleEnabled('lab')
  const canAiLab = can(currentUser, 'ai.lab') && aiLabEnabled
  const canDeleteLab = currentUser?.role === 'master_admin'
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'todos' | 'urgente' | 'medio' | 'baixo'>('todos')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [status, setStatus] = useState<'todos' | LabStatus>('todos')
  const [originFilter, setOriginFilter] = useState<'todos' | 'interno' | 'externo'>('todos')
  const [boardTab, setBoardTab] = useState<'esteira' | 'reconfeccao' | 'banco_restante'>('esteira')
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create', item: null })
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [deliveryCaseId, setDeliveryCaseId] = useState('')
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false)
  const [advanceTarget, setAdvanceTarget] = useState<LabItem | null>(null)
  const [advanceUpperQty, setAdvanceUpperQty] = useState('1')
  const [advanceLowerQty, setAdvanceLowerQty] = useState('1')
  const [supabaseItems, setSupabaseItems] = useState<LabItem[]>([])
  const [supabaseCases, setSupabaseCases] = useState<typeof db.cases>([])
  const [supabasePatientOptions, setSupabasePatientOptions] = useState<PatientOption[]>([])
  const [supabaseDentists, setSupabaseDentists] = useState<Array<{ id: string; name: string; gender?: 'masculino' | 'feminino' }>>([])
  const [supabaseClinics, setSupabaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const [supabaseCasePrintFallbackByCaseId, setSupabaseCasePrintFallbackByCaseId] = useState<Record<string, CasePrintFallback>>({})
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()
  const [productionConfirm, setProductionConfirm] = useState<ProductionConfirmState>({
    open: false,
    productLabel: '',
    archLabel: '',
    resolver: null,
  })
  const [preferredBrotherPrinter, setPreferredBrotherPrinter] = useState('')
  const labSyncSignature = `${db.cases.map((item) => item.updatedAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}`
  const automationSettings = loadSystemSettings().guideAutomation
  const guideAutomationEnabled = automationSettings?.enabled !== false
  const guideAutomationLeadDays = Math.max(0, Math.trunc(automationSettings?.leadDays ?? 10))
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiModalTitle, setAiModalTitle] = useState('')
  const [aiDraft, setAiDraft] = useState('')
  const aiLoading = false
  const [aiAlerts, setAiAlerts] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(BROTHER_PRINTER_STORAGE_KEY) ?? ''
    setPreferredBrotherPrinter(saved)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const normalized = preferredBrotherPrinter.trim()
    if (!normalized) {
      window.localStorage.removeItem(BROTHER_PRINTER_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(BROTHER_PRINTER_STORAGE_KEY, normalized)
  }, [preferredBrotherPrinter])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'esteira' || tab === 'reconfeccao' || tab === 'banco_restante') {
      setBoardTab(tab)
    }
  }, [searchParams])

  const askProductionConfirmation = useCallback((productLabelText: string, archLabelText: string) => {
    return new Promise<boolean>((resolve) => {
      setProductionConfirm({
        open: true,
        productLabel: productLabelText,
        archLabel: archLabelText,
        resolver: resolve,
      })
    })
  }, [])

  const resolveProductionConfirmation = useCallback((confirmed: boolean) => {
    setProductionConfirm((current) => {
      current.resolver?.(confirmed)
      return {
        open: false,
        productLabel: '',
        archLabel: '',
        resolver: null,
      }
    })
  }, [])

  useEffect(() => {
    if (isSupabaseMode) return
    listLabItems()
  }, [isSupabaseMode, labSyncSignature])

  useEffect(() => {
    if (!isSupabaseMode || !supabase) {
      setSupabaseItems([])
      setSupabaseCases([])
      setSupabasePatientOptions([])
      setSupabaseDentists([])
      setSupabaseClinics([])
      setSupabaseCasePrintFallbackByCaseId({})
      return
    }
    let active = true
    void (async () => {
      const [casesRes, labRes, patientsRes, dentistsRes, clinicsRes, scansRes] = await Promise.all([
        supabase
          .from('cases')
          .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, scan_id, status, data, deleted_at')
          .is('deleted_at', null),
        supabase
          .from('lab_items')
          .select('id, clinic_id, case_id, tray_number, status, priority, notes, created_at, deleted_at, data')
          .is('deleted_at', null),
        supabase.from('patients').select('id, name, birth_date, clinic_id, primary_dentist_id, deleted_at').is('deleted_at', null),
        supabase.from('dentists').select('id, name, gender, deleted_at').is('deleted_at', null),
        supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null),
        supabase.from('scans').select('id, data').is('deleted_at', null),
      ])
      if (!active) return

      const dentistsById = new Map(
        ((dentistsRes.data ?? []) as Array<{ id: string; name?: string; gender?: 'masculino' | 'feminino' }>).map((row) => [row.id, row.name ?? '-']),
      )
      setSupabaseDentists(
        ((dentistsRes.data ?? []) as Array<{ id: string; name?: string; gender?: 'masculino' | 'feminino' }>).map((row) => ({
          id: row.id,
          name: row.name ?? '-',
          gender: row.gender ?? undefined,
        })),
      )
      const clinicsById = new Map(
        ((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => [row.id, row.trade_name ?? '-']),
      )
      setSupabaseClinics(
        ((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => ({
          id: row.id,
          tradeName: row.trade_name ?? '-',
        })),
      )
      const patientOptions = ((patientsRes.data ?? []) as Array<{ id: string; name?: string; birth_date?: string; clinic_id?: string; primary_dentist_id?: string }>).map((row) => ({
        id: row.id,
        shortId: undefined,
        name: row.name ?? '-',
        birthDate: row.birth_date ?? undefined,
        clinicId: row.clinic_id ?? undefined,
        dentistId: row.primary_dentist_id ?? undefined,
        clinicName: row.clinic_id ? clinicsById.get(row.clinic_id) : undefined,
        dentistName: row.primary_dentist_id ? dentistsById.get(row.primary_dentist_id) : undefined,
      }))
      setSupabasePatientOptions(patientOptions)

      const scanDataById = new Map(
        ((scansRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [asText(row.id), asObject(row.data)]),
      )
      const serviceCodeByScanId = new Map(
        Array.from(scanDataById.entries()).map(([scanId, data]) => [scanId, normalizeOrthTreatmentCode(asText(data.serviceOrderCode)) || '']),
      )
      const nextCasePrintFallbackByCaseId: Record<string, CasePrintFallback> = {}

      const mappedCases = ((casesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const data = asObject(row.data)
        const createdAt = new Date().toISOString()
        const sourceScanId = asText(data.sourceScanId, asText(row.scan_id))
        const treatmentCodeFromScan = sourceScanId ? (serviceCodeByScanId.get(sourceScanId) || '') : ''
        const sourceScanData = sourceScanId ? scanDataById.get(sourceScanId) ?? {} : {}
        const caseId = asText(row.id)
        nextCasePrintFallbackByCaseId[caseId] = {
          clinicName: asText(data.clinicName, asText(sourceScanData.clinicName)),
          dentistName: asText(data.dentistName, asText(sourceScanData.dentistName)),
          requesterName: asText(
            data.requestedByDentistName,
            asText(data.requesterName, asText(sourceScanData.requestedByDentistName, asText(sourceScanData.requesterName, asText(sourceScanData.dentistName)))),
          ),
          patientBirthDate: asText(
            data.patientBirthDate,
            asText(data.birthDate, asText(sourceScanData.patientBirthDate, asText(sourceScanData.birthDate))),
          ),
        }
        return {
          id: caseId,
          shortId: asText(data.shortId) || undefined,
          productType: normalizeProductType(data.productType ?? data.productId),
          productId: normalizeProductType(data.productId ?? data.productType),
          requestedProductId: asText(data.requestedProductId, asText(sourceScanData.purposeProductId)) || undefined,
          requestedProductLabel: asText(data.requestedProductLabel, asText(sourceScanData.purposeLabel)) || undefined,
          patientId: asText(data.patientId, asText(row.patient_id)) || undefined,
          dentistId: asText(data.dentistId, asText(row.dentist_id)) || undefined,
          clinicId: asText(data.clinicId, asText(row.clinic_id)) || undefined,
          treatmentCode: normalizeOrthTreatmentCode(asText(data.treatmentCode)) || treatmentCodeFromScan || undefined,
          treatmentOrigin: (asText(data.treatmentOrigin, 'externo') as 'interno' | 'externo'),
          patientName: asText(data.patientName, '-'),
          requestedByDentistId: asText(row.requested_by_dentist_id) || undefined,
          scanDate: asText(data.scanDate, createdAt.slice(0, 10)),
          totalTrays: asNumber(data.totalTrays, 0),
          changeEveryDays: asNumber(data.changeEveryDays, 7),
          totalTraysUpper: asNumber(data.totalTraysUpper, asNumber(data.totalTrays, 0)),
          totalTraysLower: asNumber(data.totalTraysLower, asNumber(data.totalTrays, 0)),
          attachmentBondingTray: Boolean(data.attachmentBondingTray),
          status: (asText(data.status, 'planejamento') as 'planejamento' | 'em_producao' | 'em_entrega' | 'em_tratamento' | 'aguardando_reposicao' | 'finalizado'),
          phase: (asText(data.phase, 'planejamento') as 'planejamento' | 'orçamento' | 'contrato_pendente' | 'contrato_aprovado' | 'em_producao' | 'finalizado'),
          budget: data.budget as typeof db.cases[number]['budget'],
          contract: data.contract as typeof db.cases[number]['contract'],
          deliveryLots: (data.deliveryLots as typeof db.cases[number]['deliveryLots']) ?? [],
          installation: data.installation as typeof db.cases[number]['installation'],
          trays: (data.trays as typeof db.cases[number]['trays']) ?? [],
          attachments: [],
          sourceScanId: sourceScanId || undefined,
          arch: (asText(data.arch, 'ambos') as 'superior' | 'inferior' | 'ambos'),
          complaint: asText(data.complaint) || undefined,
          dentistGuidance: asText(data.dentistGuidance) || undefined,
          scanFiles: data.scanFiles as typeof db.cases[number]['scanFiles'],
          createdAt: asText(data.createdAt, createdAt),
          updatedAt: asText(data.updatedAt, createdAt),
        }
      })

      const mappedItems = ((labRes.data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const data = asObject(row.data)
        const createdAt = asText(row.created_at, new Date().toISOString())
        const updatedAt = asText(row.updated_at, createdAt)
        return {
          id: asText(row.id),
          productType: normalizeProductType(data.productType ?? data.productId),
          productId: normalizeProductType(data.productId ?? data.productType),
          requestedProductId: asText(data.requestedProductId) || undefined,
          requestedProductLabel: asText(data.requestedProductLabel) || undefined,
          patientId: asText(data.patientId) || undefined,
          dentistId: asText(data.dentistId) || undefined,
          clinicId: asText(row.clinic_id, asText(data.clinicId)) || undefined,
          requestCode: asText(data.requestCode) || undefined,
          requestKind: (asText(data.requestKind, 'producao') as 'producao' | 'reconfeccao' | 'reposicao_programada'),
          expectedReplacementDate: asText(data.expectedReplacementDate) || undefined,
          deliveredToProfessionalAt: asText(data.deliveredToProfessionalAt) || undefined,
          caseId: asText(row.case_id) || undefined,
          arch: (asText(data.arch, 'ambos') as 'superior' | 'inferior' | 'ambos'),
          plannedUpperQty: asNumber(data.plannedUpperQty, 0),
          plannedLowerQty: asNumber(data.plannedLowerQty, 0),
          planningDefinedAt: asText(data.planningDefinedAt) || undefined,
          trayNumber: asNumber(row.tray_number, asNumber(data.trayNumber, 1)),
          patientName: asText(data.patientName, '-'),
          plannedDate: asText(data.plannedDate, createdAt.slice(0, 10)),
          dueDate: asText(data.dueDate, createdAt.slice(0, 10)),
          status: (asText(row.status, 'aguardando_iniciar') as LabStatus),
          priority: (asText(row.priority, 'Medio') as 'Baixo' | 'Medio' | 'Urgente'),
          notes: asText(row.notes, asText(data.notes)) || undefined,
          createdAt,
          updatedAt,
        } satisfies LabItem
      })

      setSupabaseCases(mappedCases)
      setSupabaseItems(mappedItems)
      setSupabaseCasePrintFallbackByCaseId(nextCasePrintFallbackByCaseId)
    })()
    return () => {
      active = false
    }
  }, [db, isSupabaseMode, supabaseRefreshKey, supabaseSyncTick])

  useEffect(() => {
    if (!isSupabaseMode || !supabase || !guideAutomationEnabled) return
    if (!supabaseCases.length) return

    const today = new Date().toISOString().slice(0, 10)
    const requestCodes = supabaseItems
      .map((item) => item.requestCode)
      .filter((code): code is string => Boolean(code))
    const inserts: Array<Record<string, unknown>> = []

    supabaseCases.forEach((caseItem) => {
      if (caseItem.contract?.status !== 'aprovado') return
      const trays = caseItem.trays ?? []
      const hasDelivered = trays.some((tray) => tray.state === 'entregue')
      const hasPending = trays.some((tray) => tray.state === 'pendente')
      if (!hasDelivered || !hasPending) return

      trays
        .filter((tray) => tray.state === 'pendente' && Boolean(tray.dueDate))
        .forEach((tray) => {
          const expected = tray.dueDate as string
          const plannedDate = minusDays(expected, guideAutomationLeadDays)
          if (plannedDate > today) return

          const exists = supabaseItems.some(
            (item) =>
              item.caseId === caseItem.id &&
              item.requestKind === 'reposicao_programada' &&
              item.trayNumber === tray.trayNumber &&
              (item.expectedReplacementDate === expected || item.dueDate === expected),
          )
          if (exists) return

          const baseCode = caseCode(caseItem)
          const revision = nextRequestRevisionFromCodes(baseCode, requestCodes)
          const requestCode = `${baseCode}/${revision}`
          requestCodes.push(requestCode)

          const nowIso = new Date().toISOString()
          const resolvedProductType = normalizeProductType(caseItem.productId ?? caseItem.productType)
          const notes = `Solicitacao automatica de reposição programada (${caseItem.id}_${tray.trayNumber}_${expected}).`
          const data = {
            requestCode,
            requestKind: 'reposicao_programada',
            expectedReplacementDate: expected,
            productType: resolvedProductType,
            productId: resolvedProductType,
            requestedProductId: caseItem.requestedProductId,
            requestedProductLabel: caseItem.requestedProductLabel,
            arch: caseItem.arch ?? 'ambos',
            plannedUpperQty: 0,
            plannedLowerQty: 0,
            planningDefinedAt: undefined,
            trayNumber: tray.trayNumber,
            patientName: caseItem.patientName,
            patientId: caseItem.patientId,
            dentistId: caseItem.dentistId,
            clinicId: caseItem.clinicId,
            plannedDate,
            dueDate: expected,
            priority: 'Medio',
            notes,
            status: 'aguardando_iniciar',
          }

          inserts.push({
            clinic_id: caseItem.clinicId ?? null,
            case_id: caseItem.id,
            tray_number: tray.trayNumber,
            status: 'aguardando_iniciar',
            priority: 'Medio',
            notes,
            product_type: resolvedProductType,
            product_id: resolvedProductType,
            data,
            updated_at: nowIso,
          })
        })
    })

    if (!inserts.length) return
    void (async () => {
      const { error } = await supabase.from('lab_items').insert(inserts)
      if (error) {
        addToast({ type: 'error', title: 'Automacao de guias', message: error.message })
        return
      }
      setSupabaseRefreshKey((current) => current + 1)
    })()
  }, [addToast, guideAutomationEnabled, guideAutomationLeadDays, isSupabaseMode, supabaseCases, supabaseItems])

  const items = useMemo(() => {
    const source = isSupabaseMode ? supabaseItems : listLabItemsForUser(db, currentUser)
    return [...source].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }, [isSupabaseMode, supabaseItems, db, currentUser])
  const caseSource = useMemo(
    () => (isSupabaseMode ? supabaseCases : listCasesForUser(db, currentUser)),
    [isSupabaseMode, supabaseCases, db, currentUser],
  )
  const caseById = useMemo(() => new Map(caseSource.map((item) => [item.id, item])), [caseSource])
  const resolveLabProductLabel = useCallback(
    (
      item: Pick<LabItem, 'caseId' | 'requestedProductId' | 'requestedProductLabel' | 'productType' | 'productId'>,
      caseItemOverride?: {
        requestedProductId?: string
        requestedProductLabel?: string
        productType?: ProductType
        productId?: ProductType
        sourceScanId?: string
      },
    ) => {
      const linkedCase = caseItemOverride ?? (item.caseId ? caseById.get(item.caseId) : undefined)
      const sourceScan =
        !isSupabaseMode && linkedCase?.sourceScanId
          ? db.scans.find((scan) => scan.id === linkedCase.sourceScanId)
          : undefined
      return resolveRequestedProductLabel({
        requestedProductLabel: item.requestedProductLabel ?? linkedCase?.requestedProductLabel ?? sourceScan?.purposeLabel,
        requestedProductId: item.requestedProductId ?? linkedCase?.requestedProductId ?? sourceScan?.purposeProductId,
        productType: item.productType ?? linkedCase?.productType ?? sourceScan?.purposeProductType,
        productId: item.productId ?? linkedCase?.productId ?? sourceScan?.purposeProductId,
      })
    },
    [caseById, db.scans, isSupabaseMode],
  )
  const patientOptions = useMemo<PatientOption[]>(
    () =>
      isSupabaseMode
        ? supabasePatientOptions
        : db.patients.map((patient) => {
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
          }),
    [isSupabaseMode, supabasePatientOptions, db.patients, db.dentists, db.clinics],
  )
  const visibleCases = caseSource
  const patientOptionById = useMemo(
    () => new Map(patientOptions.map((item) => [item.id, item])),
    [patientOptions],
  )
  const clinicLookupById = useMemo(
    () =>
      new Map(
        (isSupabaseMode ? supabaseClinics : db.clinics)
          .map((item) => [item.id, { tradeName: item.tradeName }]),
      ),
    [isSupabaseMode, supabaseClinics, db.clinics],
  )
  const readyDeliveryItems = useMemo(
    () =>
      items.filter(
        (item) => {
          if (item.status !== 'prontas') return false
          if (isReworkItem(item)) return false
          return !isDeliveredToProfessionalItem(item, caseById)
        },
      ),
    [caseById, items],
  )
  const casesReadyForDelivery = useMemo(
    () => new Set(readyDeliveryItems.map((item) => item.caseId as string)),
    [readyDeliveryItems],
  )
  const deliveryCaseOptions = useMemo(
    () =>
      readyDeliveryItems
        .filter((item) => !item.caseId || visibleCases.some((current) => current.id === item.caseId))
        .map((item) => ({
          id: item.id,
          label: `${item.patientName} (${item.requestCode ?? 'OS sem codigo'})${item.caseId ? '' : ' - Avulsa'}${isReworkItem(item) || isReworkProductionItem(item) ? ` - Rework placa #${item.trayNumber}` : ''}`,
        })),
    [readyDeliveryItems, visibleCases],
  )
  const selectedDeliveryItem = useMemo(
    () => readyDeliveryItems.find((item) => item.id === deliveryCaseId),
    [deliveryCaseId, readyDeliveryItems],
  )
  const selectedDeliveryIsRework = useMemo(
    () => !!selectedDeliveryItem && (isReworkItem(selectedDeliveryItem) || isReworkProductionItem(selectedDeliveryItem)),
    [selectedDeliveryItem],
  )
  const selectedDeliveryProductType = useMemo(
    () => normalizeProductType(selectedDeliveryItem?.productId ?? selectedDeliveryItem?.productType),
    [selectedDeliveryItem?.productId, selectedDeliveryItem?.productType],
  )
  const selectedDeliveryRequiresArchQuantities = useMemo(
    () => isAlignerProductType(selectedDeliveryProductType),
    [selectedDeliveryProductType],
  )
  const selectedDeliveryCase = useMemo(
    () => (selectedDeliveryItem?.caseId ? caseById.get(selectedDeliveryItem.caseId) : undefined),
    [caseById, selectedDeliveryItem?.caseId],
  )
  const selectedDeliveryProductLabel = useMemo(
    () => (selectedDeliveryItem ? resolveLabProductLabel(selectedDeliveryItem, selectedDeliveryCase) : ''),
    [resolveLabProductLabel, selectedDeliveryCase, selectedDeliveryItem],
  )
  const deliveryInitialUpperQty = useMemo(() => {
    if (!selectedDeliveryItem || selectedDeliveryIsRework || !selectedDeliveryRequiresArchQuantities) return 0
    if (selectedDeliveryItem.arch === 'inferior') return 0
    return Math.max(0, Math.trunc(selectedDeliveryItem.plannedUpperQty ?? 0))
  }, [selectedDeliveryIsRework, selectedDeliveryItem, selectedDeliveryRequiresArchQuantities])
  const deliveryInitialLowerQty = useMemo(() => {
    if (!selectedDeliveryItem || selectedDeliveryIsRework || !selectedDeliveryRequiresArchQuantities) return 0
    if (selectedDeliveryItem.arch === 'superior') return 0
    return Math.max(0, Math.trunc(selectedDeliveryItem.plannedLowerQty ?? 0))
  }, [selectedDeliveryIsRework, selectedDeliveryItem, selectedDeliveryRequiresArchQuantities])
  const casesWithAlerts = useMemo(
    () =>
      new Set(caseSource.filter((caseItem) => getReplenishmentAlerts(caseItem).length > 0).map((caseItem) => caseItem.id)),
    [caseSource],
  )
  const alertSummaries = useMemo(
    () =>
      caseSource
        .flatMap((caseItem) => getReplenishmentAlerts(caseItem).map((alert) => ({ caseId: caseItem.id, patientName: caseItem.patientName, dueDate: alert.dueDate, title: alert.title })))
        .slice(0, 3),
    [caseSource],
  )

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
      const matchSearch =
        query.length === 0 ||
        item.patientName.toLowerCase().includes(query) ||
        (item.patientId ? (patientOptionById.get(item.patientId)?.shortId ?? '').toLowerCase().includes(query) : false) ||
        (item.caseId ? (caseById.get(item.caseId)?.shortId ?? '').toLowerCase().includes(query) : false) ||
        (item.requestCode ?? '').toLowerCase().includes(query) ||
        (item.caseId ?? '').toLowerCase().includes(query) ||
        `#${item.trayNumber}`.includes(query) ||
        String(item.trayNumber).includes(query)
      const matchPriority = priority === 'todos' || item.priority.toLowerCase() === priority
      const matchStatus = status === 'todos' || item.status === status
      const matchOverdue = !overdueOnly || isOverdue(item)
      const matchAlerts = !alertsOnly || (item.caseId ? casesWithAlerts.has(item.caseId) : false)
      const matchOrigin =
        originFilter === 'todos'
        || resolveTreatmentOrigin(
          {
            treatmentOrigin: caseItem?.treatmentOrigin,
            clinicId: caseItem?.clinicId ?? item.clinicId,
            patientId: caseItem?.patientId ?? item.patientId,
          },
          {
            patientsById: patientOptionById,
            clinicsById: clinicLookupById,
          },
        ) === originFilter
      return matchSearch && matchPriority && matchStatus && matchOverdue && matchAlerts && matchOrigin
    })
  }, [alertsOnly, caseById, casesWithAlerts, clinicLookupById, items, originFilter, overdueOnly, patientOptionById, priority, search, status])
  const isDeliveredToProfessional = useCallback((item: LabItem) => {
    return isDeliveredToProfessionalItem(item, caseById)
  }, [caseById])
  const pipelineBaseItems = useMemo(
    () => getPipelineItems(items, { isDeliveredToProfessional }),
    [isDeliveredToProfessional, items],
  )
  const aiClinicId = useMemo(
    () =>
      currentUser?.linkedClinicId
      ?? pipelineBaseItems.find((item) => item.clinicId)?.clinicId
      ?? items.find((item) => item.clinicId)?.clinicId
      ?? caseSource.find((item) => item.clinicId)?.clinicId,
    [caseSource, currentUser?.linkedClinicId, items, pipelineBaseItems],
  )
  const pipelineItems = useMemo(
    () => getPipelineItems(filteredItems, { isDeliveredToProfessional }),
    [filteredItems, isDeliveredToProfessional],
  )
  const reworkItems = useMemo(
    () => filteredItems.filter((item) => isReworkItem(item)),
    [filteredItems],
  )
  const remainingBankItems = useMemo(
    () => {
      const raw = filteredItems.filter(
        (item) => {
          const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
          if (caseItem?.status === 'finalizado') return false
          if (caseItem && !hasRemainingByArch(caseItem)) return false
          return (
            isDeliveredToProfessional(item) ||
            (item.requestKind === 'reposicao_programada' && item.status === 'aguardando_iniciar') ||
            item.requestKind === 'reconfeccao' ||
            isReworkItem(item)
          )
        },
      )
      const caseScoped = new Map<string, LabItem>()
      const explicitRework: LabItem[] = []
      const explicitReworkCaseIds = new Set<string>()
      const standalone: LabItem[] = []
      const score = (item: LabItem) => {
        if (item.requestKind === 'reposicao_programada' && item.status === 'aguardando_iniciar') return 4
        if ((item.requestKind ?? 'producao') === 'producao') return 3
        if (item.requestKind === 'reconfeccao') return 2
        return 1
      }

      raw.forEach((item) => {
        if (item.requestKind === 'reconfeccao') {
          explicitRework.push(item)
          if (item.caseId) explicitReworkCaseIds.add(item.caseId)
          return
        }
        if (!item.caseId) {
          standalone.push(item)
          return
        }
        const current = caseScoped.get(item.caseId)
        if (!current) {
          caseScoped.set(item.caseId, item)
          return
        }
        const better = score(item) > score(current) || (score(item) === score(current) && (item.updatedAt ?? '') > (current.updatedAt ?? ''))
        if (better) {
          caseScoped.set(item.caseId, item)
        }
      })

      const caseScopedWithoutExplicitRework = [...caseScoped.values()].filter(
        (item) => !(item.caseId && explicitReworkCaseIds.has(item.caseId)),
      )
      return [...explicitRework, ...caseScopedWithoutExplicitRework, ...standalone]
    },
    [filteredItems, caseById, isDeliveredToProfessional],
  )
  const kpis = useMemo(
    () => ({
      aguardando_iniciar: pipelineItems.filter((item) => item.status === 'aguardando_iniciar').length,
      em_producao: pipelineItems.filter((item) => item.status === 'em_producao').length,
      controle_qualidade: pipelineItems.filter((item) => item.status === 'controle_qualidade').length,
      prontas: pipelineItems.filter((item) => item.status === 'prontas').length,
      atrasados: pipelineItems.filter((item) => item.status !== 'prontas' && isOverdue(item)).length,
    }),
    [pipelineItems],
  )

  const guideTone = (item: LabItem) => {
    const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
    const tray = caseItem?.trays.find((current) => current.trayNumber === item.trayNumber)
    if (tray?.state === 'entregue') return 'green' as const
    if (isOverdue(item)) return 'red' as const
    return 'yellow' as const
  }

  const caseLabel = (item: LabItem) => {
    const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
    const treatment = caseItem?.treatmentCode
    if (treatment) return `${treatment}${revisionSuffix(item.requestCode)}`
    return item.requestCode
  }

  const handleCreate = async (payload: {
    caseId?: string
    productType?: ProductType
    productId?: ProductType
    patientId?: string
    dentistId?: string
    clinicId?: string
    arch: 'superior' | 'inferior' | 'ambos'
    plannedUpperQty?: number
    plannedLowerQty?: number
    patientName: string
    trayNumber: number
    dueDate: string
    priority: 'Baixo' | 'Medio' | 'Urgente'
    notes?: string
    status: LabStatus
  }) => {
    if (!canWrite) return { ok: false, message: 'Sem permissão para criar solicitações.' }
    if (isSupabaseMode) {
      if (!supabase) return { ok: false, message: 'Supabase não configurado.' }
      const nowIso = new Date().toISOString()
      const today = nowIso.slice(0, 10)
      const resolvedProductType = normalizeProductType(payload.productId ?? payload.productType)
      const nextData = {
        requestCode: undefined,
        requestKind: 'producao',
        expectedReplacementDate: payload.dueDate,
        productType: resolvedProductType,
        productId: resolvedProductType,
        arch: payload.arch,
        plannedUpperQty: payload.plannedUpperQty ?? 0,
        plannedLowerQty: payload.plannedLowerQty ?? 0,
        planningDefinedAt: undefined,
        trayNumber: payload.trayNumber,
        patientName: payload.patientName,
        patientId: payload.patientId,
        dentistId: payload.dentistId,
        clinicId: payload.clinicId,
        plannedDate: today,
        dueDate: payload.dueDate,
        priority: payload.priority,
        notes: payload.notes,
        status: payload.status,
      }
      const { error } = await supabase
        .from('lab_items')
        .insert({
          clinic_id: payload.clinicId ?? null,
          case_id: payload.caseId ?? null,
          tray_number: payload.trayNumber,
          status: payload.status,
          priority: payload.priority,
          notes: payload.notes ?? null,
          product_type: resolvedProductType,
          product_id: resolvedProductType,
          data: nextData,
          updated_at: nowIso,
        })
      if (error) {
        return { ok: false, message: error.message }
      }
      if (payload.status === 'em_producao') {
        const seed = await seedInitialReplenishmentSupabase({
          caseId: payload.caseId,
          trayNumber: payload.trayNumber,
          status: payload.status,
          productType: resolvedProductType,
          productId: resolvedProductType,
          priority: payload.priority,
          data: nextData as Record<string, unknown>,
        })
        if (!seed.ok) {
          addToast({ type: 'info', title: 'Reposição inicial', message: seed.error })
        }
      }
      setSupabaseRefreshKey((currentKey) => currentKey + 1)
      setModal({ open: false, mode: 'create', item: null })
      return { ok: true }
    }

    const today = new Date().toISOString().slice(0, 10)
    const result = addLabItem({
      caseId: payload.caseId,
      productType: payload.productType,
      productId: payload.productId,
      patientId: payload.patientId,
      dentistId: payload.dentistId,
      clinicId: payload.clinicId,
      arch: payload.arch,
      plannedUpperQty: payload.plannedUpperQty,
      plannedLowerQty: payload.plannedLowerQty,
      patientName: payload.patientName,
      trayNumber: payload.trayNumber,
      plannedDate: today,
      dueDate: payload.dueDate,
      priority: payload.priority,
      notes: payload.notes,
      status: payload.status,
    })
    if (!result.ok) {
      return { ok: false, message: result.error }
    }
    if (!result.sync.ok) {
      return { ok: false, message: result.sync.message }
    }
    setModal({ open: false, mode: 'create', item: null })
    return { ok: true }
  }

  const handleSave = async (id: string, patch: Partial<LabItem>) => {
    if (!canWrite) return { ok: false, message: 'Sem permissão para editar solicitações.' }
    if (isSupabaseMode) {
      if (!supabase) return { ok: false, message: 'Supabase não configurado.' }
      const { data: current, error: readError } = await supabase
        .from('lab_items')
        .select('id, case_id, tray_number, status, priority, notes, product_type, product_id, data')
        .eq('id', id)
        .maybeSingle()
      if (readError || !current) {
        return { ok: false, message: readError?.message ?? 'Item do laboratório não encontrado.' }
      }

      const currentData = asObject(current.data)
      const plannedUpperQty = patch.plannedUpperQty ?? asNumber(currentData.plannedUpperQty, 0)
      const plannedLowerQty = patch.plannedLowerQty ?? asNumber(currentData.plannedLowerQty, 0)
      const currentProductType = normalizeProductType(
        patch.productType ?? patch.productId ?? current.product_type ?? (current as Record<string, unknown>).product_id ?? currentData.productType ?? currentData.productId,
      )
      const autoStatus: LabStatus = isAlignerProductType(currentProductType)
        ? (plannedUpperQty + plannedLowerQty > 0 ? 'em_producao' : 'aguardando_iniciar')
        : (patch.status ?? (asText(current.status, 'aguardando_iniciar') as LabStatus))
      const currentStatus = asText(current.status, 'aguardando_iniciar') as LabStatus
      const nextStatus = currentStatus === 'aguardando_iniciar' ? autoStatus : ((patch.status ?? currentStatus) as LabStatus)
      const nextPriority = (patch.priority ?? asText(current.priority, asText(currentData.priority, 'Medio'))) as 'Baixo' | 'Medio' | 'Urgente'
      const nextNotes = patch.notes ?? asText(current.notes, asText(currentData.notes, ''))
      const nextTray = patch.trayNumber ?? asNumber(current.tray_number, asNumber(currentData.trayNumber, 1))
      const nowIso = new Date().toISOString()
      const nextProductType = normalizeProductType(
        patch.productType ?? patch.productId ?? current.product_type ?? (current as Record<string, unknown>).product_id ?? currentData.productType ?? currentData.productId,
      )
      const nextData = {
        ...currentData,
        productType: nextProductType,
        productId: normalizeProductType(patch.productId ?? patch.productType ?? (current as Record<string, unknown>).product_id ?? current.product_type ?? currentData.productId ?? currentData.productType),
        arch: patch.arch ?? asText(currentData.arch, 'ambos'),
        plannedUpperQty,
        plannedLowerQty,
        planningDefinedAt:
          patch.plannedUpperQty !== undefined || patch.plannedLowerQty !== undefined
            ? nowIso
            : asText(currentData.planningDefinedAt) || undefined,
        trayNumber: nextTray,
        patientName: patch.patientName ?? asText(currentData.patientName, '-'),
        patientId: patch.patientId ?? (asText(currentData.patientId) || undefined),
        dentistId: patch.dentistId ?? (asText(currentData.dentistId) || undefined),
        clinicId: patch.clinicId ?? (asText(currentData.clinicId) || undefined),
        dueDate: patch.dueDate ?? asText(currentData.dueDate, nowIso.slice(0, 10)),
        plannedDate: patch.plannedDate ?? asText(currentData.plannedDate, nowIso.slice(0, 10)),
        priority: nextPriority,
        notes: nextNotes || undefined,
        status: nextStatus,
      }
      if (nextStatus === 'em_producao') {
        const nextArch = asText(nextData.arch, '')
        if (!nextArch) {
          return { ok: false, message: 'Defina a arcada do produto antes de iniciar producao.' }
        }
        if (isAlignerProductType(nextProductType) && plannedUpperQty + plannedLowerQty <= 0) {
          return { ok: false, message: 'Defina quantidades por arcada antes de iniciar producao.' }
        }
      }

      const { error } = await supabase
        .from('lab_items')
        .update({
          tray_number: nextTray,
          status: nextStatus,
          priority: nextPriority,
          notes: nextNotes || null,
          clinic_id: asText(nextData.clinicId) || null,
          product_type: nextProductType,
          product_id: nextProductType,
          data: nextData,
          updated_at: nowIso,
        })
        .eq('id', id)
      if (error) {
        return { ok: false, message: error.message }
      }
      if (nextStatus === 'em_producao') {
        const seed = await seedInitialReplenishmentSupabase({
          caseId: asText((current as Record<string, unknown>).case_id) || undefined,
          trayNumber: nextTray,
          status: nextStatus,
          productType: nextProductType,
          productId: nextProductType,
          priority: nextPriority,
          data: nextData as Record<string, unknown>,
        })
        if (!seed.ok) {
          addToast({ type: 'info', title: 'Reposição inicial', message: seed.error })
        }
      }
      setSupabaseRefreshKey((currentKey) => currentKey + 1)
      setModal({ open: false, mode: 'create', item: null })
      return { ok: true }
    }

    const result = updateLabItem(id, patch)
    if (result.error) {
      return { ok: false, message: result.error }
    }
    if (!result.sync.ok) {
      return { ok: false, message: result.sync.message }
    }
    setModal({ open: false, mode: 'create', item: null })
    return { ok: true }
  }

  const handleDelete = (id: string) => {
    if (!canWrite || !canDeleteLab) return
    const confirmed = window.confirm('Confirma excluir esta OS? O evento será registrado no historico do paciente.')
    if (!confirmed) return
    if (isSupabaseMode) {
      if (!supabase) {
        addToast({ type: 'error', title: 'Exclusão', message: 'Supabase não configurado.' })
        return
      }
      void (async () => {
        const result = await deleteLabItemSupabase(id)
        if (!result.ok) {
          addToast({ type: 'error', title: 'Exclusão', message: result.error })
          return
        }
        setSupabaseItems((current) => current.filter((item) => item.id !== id))
        setSupabaseRefreshKey((currentKey) => currentKey + 1)
        setModal({ open: false, mode: 'create', item: null })
        addToast({ type: 'info', title: 'Solicitacao removida' })
      })()
      return
    }
    deleteLabItem(id)
    setModal({ open: false, mode: 'create', item: null })
    addToast({ type: 'info', title: 'Solicitacao removida' })
  }

  const nextRangeByArch = (
    caseItem: NonNullable<ReturnType<typeof caseById.get>>,
    arch: 'superior' | 'inferior',
    qty: number,
  ) => {
    const lots = caseItem.deliveryLots ?? []
    const maxDelivered = lots.reduce((acc, lot) => {
      if (lot.arch === arch || lot.arch === 'ambos') {
        return Math.max(acc, lot.toTray)
      }
      return acc
    }, 0)
    const fromTray = maxDelivered + 1
    const toTray = fromTray + qty - 1
    return { fromTray, toTray }
  }

  const createAdvanceLabOrderSupabase = useCallback(
    async (
      sourceLabItemId: string,
      payload: { plannedUpperQty: number; plannedLowerQty: number; dueDate?: string },
    ) => {
      if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
      const { data: source, error: sourceError } = await supabase
        .from('lab_items')
        .select('id, case_id, tray_number, status, priority, notes, product_type, product_id, data')
        .eq('id', sourceLabItemId)
        .is('deleted_at', null)
        .maybeSingle()
      if (sourceError || !source) {
        return { ok: false as const, error: sourceError?.message ?? 'OS de origem não encontrada.' }
      }

      const sourceCaseId = asText((source as Record<string, unknown>).case_id)
      if (!sourceCaseId) return { ok: false as const, error: 'OS sem caso vinculado.' }
      const { data: linkedCaseRow, error: caseError } = await supabase
        .from('cases')
        .select('id, data')
        .eq('id', sourceCaseId)
        .is('deleted_at', null)
        .maybeSingle()
      if (caseError || !linkedCaseRow) {
        return { ok: false as const, error: caseError?.message ?? 'Caso vinculado não encontrado.' }
      }

      const linkedCase = asObject(linkedCaseRow.data)
      const contractStatus = asText(asObject(linkedCase.contract).status, 'pendente')
      if (contractStatus !== 'aprovado') {
        return { ok: false as const, error: 'Contrato não aprovado para gerar reposição.' }
      }

      const treatmentArch = asText(linkedCase.arch, 'ambos') as 'superior' | 'inferior' | 'ambos'
      const totals = normalizeByTreatmentArch(
        getCaseTotalsByArch({
          totalTrays: asNumber(linkedCase.totalTrays, 0),
          totalTraysUpper: asNumber(linkedCase.totalTraysUpper, asNumber(linkedCase.totalTrays, 0)),
          totalTraysLower: asNumber(linkedCase.totalTraysLower, asNumber(linkedCase.totalTrays, 0)),
        }),
        treatmentArch,
      )
      const delivered = normalizeByTreatmentArch(
        getDeliveredByArch({
          installation: asObject(linkedCase.installation) as { deliveredUpper?: number; deliveredLower?: number },
        }),
        treatmentArch,
      )
      const remaining = {
        upper: Math.max(0, totals.upper - delivered.upper),
        lower: Math.max(0, totals.lower - delivered.lower),
      }

      let plannedUpperQty = Math.max(0, Math.trunc(payload.plannedUpperQty))
      let plannedLowerQty = Math.max(0, Math.trunc(payload.plannedLowerQty))
      if (treatmentArch === 'superior') plannedLowerQty = 0
      if (treatmentArch === 'inferior') plannedUpperQty = 0
      if (plannedUpperQty + plannedLowerQty <= 0) {
        return { ok: false as const, error: 'Informe quantidade maior que zero para gerar reposição.' }
      }
      if (plannedUpperQty > remaining.upper || plannedLowerQty > remaining.lower) {
        return { ok: false as const, error: 'Quantidade solicitada maior que o saldo disponivel no banco.' }
      }

      const trays = Array.isArray(linkedCase.trays) ? (linkedCase.trays as Array<Record<string, unknown>>) : []
      const pendingTrays = trays
        .filter((tray) => asText(tray.state) === 'pendente')
        .map((tray) => asNumber(tray.trayNumber, 0))
        .filter((value) => value > 0)
        .sort((a, b) => a - b)
      const nextTrayNumber = pendingTrays[0]
      if (!nextTrayNumber) {
        return { ok: false as const, error: 'Não ha placas pendentes para gerar reposição.' }
      }

      const { data: caseRows, error: rowsError } = await supabase
        .from('lab_items')
        .select('id, data')
        .eq('case_id', sourceCaseId)
        .is('deleted_at', null)
      if (rowsError) return { ok: false as const, error: rowsError.message }

      const sourceData = asObject(source.data)
      const baseCode = asText(linkedCase.treatmentCode, sourceCaseId)
      const requestCodes = ((caseRows ?? []) as Array<Record<string, unknown>>)
        .map((row) => asText(asObject(row.data).requestCode))
        .filter((code) => !!code)
      const sourceRequestCode = asText(sourceData.requestCode)
      const sourceIsRevision = Boolean(sourceRequestCode && new RegExp(`^${baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`).test(sourceRequestCode))
      const requestCode = asText(sourceData.requestKind, 'producao') === 'reposicao_programada' && sourceIsRevision
        ? sourceRequestCode
        : `${baseCode}/${nextRequestRevisionFromCodes(baseCode, requestCodes)}`

      const nowIso = new Date().toISOString()
      const today = nowIso.slice(0, 10)
      const dueDate = payload.dueDate ?? asText(sourceData.expectedReplacementDate, asText(sourceData.dueDate, today))
      const resolvedProductType = normalizeProductType(
        (source as Record<string, unknown>).product_id ?? source.product_type ?? sourceData.productId ?? sourceData.productType,
      )
      const nextData = {
        ...sourceData,
        requestCode,
        requestKind: 'producao',
        expectedReplacementDate: asText(sourceData.expectedReplacementDate, dueDate),
        productType: resolvedProductType,
        productId: resolvedProductType,
        trayNumber: nextTrayNumber,
        plannedUpperQty,
        plannedLowerQty,
        planningDefinedAt: nowIso,
        plannedDate: today,
        dueDate,
        status: 'aguardando_iniciar',
        priority: 'Urgente',
        notes: `Reposição solicitada manualmente a partir de ${sourceRequestCode || source.id}.`,
      }

      const { error: insertError } = await supabase
        .from('lab_items')
        .insert({
          clinic_id: asText(sourceData.clinicId) || null,
          case_id: sourceCaseId,
          tray_number: nextTrayNumber,
          status: 'aguardando_iniciar',
          priority: 'Urgente',
          notes: asText(nextData.notes) || null,
          product_type: resolvedProductType,
          product_id: resolvedProductType,
          data: nextData,
          updated_at: nowIso,
        })
      if (insertError) return { ok: false as const, error: insertError.message }

      if (asText(sourceData.requestKind, 'producao') === 'reposicao_programada') {
        const { error: deleteError } = await supabase
          .from('lab_items')
          .update({ deleted_at: nowIso, updated_at: nowIso })
          .eq('id', sourceLabItemId)
        if (deleteError) return { ok: false as const, error: deleteError.message }
      }

      return { ok: true as const }
    },
    [],
  )

  const seedInitialReplenishmentSupabase = useCallback(
    async (source: {
      caseId?: string
      trayNumber: number
      status: LabStatus
      productType?: ProductType
      productId?: ProductType
      priority?: 'Baixo' | 'Medio' | 'Urgente'
      data: Record<string, unknown>
    }) => {
      if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
      if (!source.caseId) return { ok: true as const }
      if (asText(source.data.requestKind, 'producao') !== 'producao') return { ok: true as const }
      if (source.status !== 'em_producao') return { ok: true as const }

      const trayNumber = Math.max(1, Math.trunc(source.trayNumber))
      const [caseRes, rowsRes] = await Promise.all([
        supabase.from('cases').select('id, clinic_id, data').eq('id', source.caseId).maybeSingle(),
        supabase.from('lab_items').select('id, tray_number, data').eq('case_id', source.caseId),
      ])
      if (caseRes.error || !caseRes.data) {
        return { ok: false as const, error: caseRes.error?.message ?? 'Caso vinculado não encontrado.' }
      }
      if (rowsRes.error) {
        return { ok: false as const, error: rowsRes.error.message }
      }

      const caseData = asObject(caseRes.data.data)
      const caseRows = (rowsRes.data ?? []) as Array<Record<string, unknown>>
      const alreadySeeded = caseRows.some((row) => {
        const rowData = asObject(row.data)
        return (
          asText(rowData.requestKind, 'producao') === 'reposicao_programada'
          && asNumber(row.tray_number, asNumber(rowData.trayNumber, -1)) === trayNumber
        )
      })
      if (alreadySeeded) return { ok: true as const }

      const today = new Date().toISOString().slice(0, 10)
      const trays = Array.isArray(caseData.trays) ? (caseData.trays as Array<Record<string, unknown>>) : []
      const trayFromCase = trays.find((tray) => asNumber(tray.trayNumber, -1) === trayNumber)
      const expectedReplacementDate = asText(
        trayFromCase?.dueDate,
        asText(source.data.expectedReplacementDate, asText(source.data.dueDate, today)),
      )
      const baseCode = asText(caseData.treatmentCode, asText(caseRes.data.id, source.caseId))
      const escapedBase = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const revisionRegex = new RegExp(`^${escapedBase}/(\\d+)$`)
      const nextRevision = caseRows.reduce((acc, row) => {
        const rowData = asObject(row.data)
        const code = asText(rowData.requestCode)
        const match = code.match(revisionRegex)
        if (!match) return acc
        return Math.max(acc, Number(match[1]))
      }, 0) + 1

      const nowIso = new Date().toISOString()
      const resolvedProductType = normalizeProductType(source.productId ?? source.productType)
      const seedData = {
        ...source.data,
        requestCode: `${baseCode}/${nextRevision}`,
        requestKind: 'reposicao_programada',
        expectedReplacementDate,
        plannedUpperQty: 0,
        plannedLowerQty: 0,
        planningDefinedAt: undefined,
        plannedDate: today,
        dueDate: expectedReplacementDate,
        status: 'aguardando_iniciar',
        notes: `Reposição inicial gerada no início da confeccao da placa #${trayNumber}.`,
      }

      const { error } = await supabase.from('lab_items').insert({
        clinic_id: asText(source.data.clinicId, asText(caseRes.data.clinic_id)) || null,
        case_id: source.caseId,
        tray_number: trayNumber,
        status: 'aguardando_iniciar',
        priority: source.priority ?? (asText(source.data.priority, 'Medio') as 'Baixo' | 'Medio' | 'Urgente'),
        notes: asText(seedData.notes) || null,
        product_type: resolvedProductType,
        product_id: resolvedProductType,
        data: seedData,
        updated_at: nowIso,
      })
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    },
    [],
  )

  const handleMoveStatusSupabase = useCallback(
    async (id: string, next: LabStatus) => {
      if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
      const { data: current, error: readError } = await supabase
        .from('lab_items')
        .select('id, case_id, tray_number, status, priority, product_type, product_id, data')
        .eq('id', id)
        .maybeSingle()
      if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Item LAB não encontrado.' }

      const currentData = asObject(current.data)
      const currentCaseId = asText((current as Record<string, unknown>).case_id)
      const currentCase = currentCaseId ? caseById.get(currentCaseId) : undefined
      const nextArch = asText(currentData.arch, '')
      const nextProductType = normalizeProductType(
        current.product_id ?? current.product_type ?? currentData.productId ?? currentData.productType,
      )
      const plannedUpperQty = asNumber(currentData.plannedUpperQty, 0)
      const plannedLowerQty = asNumber(currentData.plannedLowerQty, 0)
      const flow: LabStatus[] = ['aguardando_iniciar', 'em_producao', 'controle_qualidade', 'prontas']
      const currentIndex = flow.indexOf(current.status as LabStatus)
      const nextIndex = flow.indexOf(next)
      if (currentIndex < 0 || nextIndex < 0 || Math.abs(nextIndex - currentIndex) > 1) {
        return { ok: false as const, error: 'Transicao de status invalida para este item.' }
      }
      if (next === 'em_producao') {
        if (!nextArch) {
          return { ok: false as const, error: 'Defina a arcada do produto antes de iniciar producao.' }
        }
        if (isAlignerProductType(nextProductType) && plannedUpperQty + plannedLowerQty <= 0) {
          return { ok: false as const, error: 'Defina quantidades por arcada antes de iniciar producao.' }
        }
        const confirmed = await askProductionConfirmation(
          resolveLabProductLabel(
            {
              caseId: currentCaseId || undefined,
              requestedProductId: asText(currentData.requestedProductId) || undefined,
              requestedProductLabel: asText(currentData.requestedProductLabel) || undefined,
              productType: nextProductType,
              productId: nextProductType,
            },
            currentCase,
          ),
          archLabel(nextArch as 'superior' | 'inferior' | 'ambos'),
        )
        if (!confirmed) {
          return { ok: false as const, error: 'Producao cancelada pelo usuário.' }
        }
      }

      const { error } = await supabase
        .from('lab_items')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) return { ok: false as const, error: error.message }
      if (next === 'em_producao') {
        const seed = await seedInitialReplenishmentSupabase({
          caseId: asText((current as Record<string, unknown>).case_id) || undefined,
          trayNumber: asNumber((current as Record<string, unknown>).tray_number, asNumber(currentData.trayNumber, 1)),
          status: next,
          productType: normalizeProductType(current.product_type ?? current.product_id ?? currentData.productType ?? currentData.productId),
          productId: normalizeProductType(current.product_id ?? current.product_type ?? currentData.productId ?? currentData.productType),
          priority: asText((current as Record<string, unknown>).priority, asText(currentData.priority, 'Medio')) as 'Baixo' | 'Medio' | 'Urgente',
          data: currentData,
        })
        if (!seed.ok) {
          addToast({ type: 'info', title: 'Reposição inicial', message: seed.error })
        }
      }
      setSupabaseRefreshKey((currentKey) => currentKey + 1)
      return { ok: true as const }
    },
    [addToast, askProductionConfirmation, caseById, resolveLabProductLabel, seedInitialReplenishmentSupabase],
  )

  const handleMoveStatusLocal = useCallback(
    async (id: string, next: LabStatus) => {
      const current = items.find((item) => item.id === id)
      if (!current) return { ok: false as const, error: 'Item LAB não encontrado.' }
      if (next === 'em_producao') {
        if (!current.arch) {
          return { ok: false as const, error: 'Defina a arcada do produto antes de iniciar producao.' }
        }
        const currentProductType = normalizeProductType(current.productId ?? current.productType)
        if (isAlignerProductType(currentProductType) && (current.plannedUpperQty ?? 0) + (current.plannedLowerQty ?? 0) <= 0) {
          return { ok: false as const, error: 'Defina quantidades por arcada antes de iniciar producao.' }
        }
        const confirmed = await askProductionConfirmation(
          resolveLabProductLabel(current),
          archLabel(current.arch),
        )
        if (!confirmed) {
          return { ok: false as const, error: 'Producao cancelada pelo usuário.' }
        }
      }
      const result = moveLabItem(id, next)
      if (result.error) return { ok: false as const, error: result.error }
      return { ok: true as const }
    },
    [askProductionConfirmation, items, resolveLabProductLabel],
  )

  const runLabAi = async (endpoint: '/lab/auditoria-solicitacao' | '/lab/previsao-entrega', title: string) => {
    if (!canAiLab) return
    if (!aiClinicId) {
      addToast({ type: 'error', title: 'IA Laboratório', message: 'Não foi possível identificar a clinica do contexto atual.' })
      return
    }
    const highlighted = pipelineItems.slice(0, 8).map((item) => ({
      id: item.id,
      patientName: item.patientName,
      requestCode: item.requestCode,
      dueDate: item.dueDate,
      status: item.status,
      notes: item.notes,
    }))
    const result = await runAiRequest(endpoint, {
      clinicId: aiClinicId,
      inputText: `Itens de laboratorio ativos: ${pipelineBaseItems.length}. Reconfeccoes: ${reworkItems.length}. Prontos: ${readyDeliveryItems.length}.`,
      metadata: {
        highlighted,
        overdue: pipelineBaseItems.filter((item) => isOverdue(item)).length,
      },
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'IA Laboratório', message: result.error })
      return
    }
    setAiModalTitle(title)
    setAiDraft(result.output)
    setAiModalOpen(true)
  }

  const handleConfigureBrotherPrinter = useCallback(() => {
    if (typeof window === 'undefined') return
    const suggested = preferredBrotherPrinter.trim() || 'Brother QL-810W'
    const typed = window.prompt('Nome da impressora Brother (como aparece no Windows):', suggested)
    if (typed === null) return
    const normalized = typed.trim()
    setPreferredBrotherPrinter(normalized)
    addToast({
      type: 'success',
      title: 'Impressora de adesivo',
      message: normalized
        ? `Impressora vinculada: ${normalized}`
        : 'Vinculo removido. O navegador usara a impressora padrão.',
    })
  }, [addToast, preferredBrotherPrinter])

  const printStickerFromCard = useCallback(
    (item: LabItem) => {
      const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
      const patientId = caseItem?.patientId ?? item.patientId
      const patientOption = patientId ? patientOptionById.get(patientId) : undefined
      const dentistsById = new Map(
        (isSupabaseMode
          ? supabaseDentists
          : db.dentists.map((entry) => ({ id: entry.id, name: entry.name ?? '-', gender: entry.gender }))
        ).map((entry) => [entry.id, { name: entry.name, gender: entry.gender }]),
      )
      const clinicsById = new Map(
        (isSupabaseMode
          ? supabaseClinics
          : db.clinics.map((entry) => ({ id: entry.id, tradeName: entry.tradeName ?? '-' }))
        ).map((entry) => [entry.id, entry.tradeName]),
      )
      const casePrintFallback = caseItem ? supabaseCasePrintFallbackByCaseId[caseItem.id] : undefined
      const dentistId = caseItem?.dentistId ?? patientOption?.dentistId ?? item.dentistId
      const dentistRef = dentistId ? dentistsById.get(dentistId) : undefined
      const dentistNameRaw = dentistId
        ? dentistRef?.name || patientOption?.dentistName || casePrintFallback?.dentistName || ''
        : patientOption?.dentistName || casePrintFallback?.dentistName || ''
      const dentistShort = toDentistShortLabelByGender(dentistNameRaw, dentistRef?.gender)
      const patientName = toPatientStickerName(item.patientName || '-')
      const stickerProductLabel = resolveLabProductLabel(item, caseItem)
      const isAlignerSticker = isAlignerProductType(normalizeProductType(item.productId ?? item.productType))
      const upperQty = Math.max(0, Math.trunc(item.plannedUpperQty ?? 0))
      const lowerQty = Math.max(0, Math.trunc(item.plannedLowerQty ?? 0))
      const trayQty = Math.max(0, Math.trunc(item.trayNumber || 0))
      const baseLabelCount = isAlignerSticker ? Math.max(upperQty, lowerQty, trayQty, 1) : 1
      const clinicId = caseItem?.clinicId ?? item.clinicId ?? patientOption?.clinicId ?? ''
      const normalizedClinicId = clinicId.trim().toLowerCase()
      const clinicTradeName = normalizeSpaces(clinicsById.get(clinicId) || patientOption?.clinicName || casePrintFallback?.clinicName || '').toUpperCase()
      const isInternalArrimo =
        caseItem?.treatmentOrigin === 'interno' ||
        normalizedClinicId === 'clinic_arrimo' ||
        normalizedClinicId === 'cli-0001' ||
        clinicTradeName === 'ARRIMO'
      const includeAttachmentGuideLabel = !isInternalArrimo && Boolean(caseItem?.attachmentBondingTray)
      const firstAlignerNumber = includeAttachmentGuideLabel ? 0 : 1
      const totalLabels = isAlignerSticker ? baseLabelCount + (includeAttachmentGuideLabel ? 1 : 0) : baseLabelCount
      const backgroundImage = isInternalArrimo ? 'sticker-arrimo-interno.png' : 'sticker-orthoscan-externo.png'
      const complementRaw = item.notes?.trim() || ''
      const complement = complementRaw.length > 0 && complementRaw.length <= 26 ? complementRaw : ''
      const labelBlock = (alignerNumber: number) => `
          <div class="label ${isInternalArrimo ? 'is-internal' : 'is-external'}">
            <div class="art">
              <img class="bg" src="${window.location.origin}/brand/${backgroundImage}" alt="Etiqueta" />
              <div class="content">
                <div class="line">${escapeHtml(dentistShort)}</div>
                <div class="line">${escapeHtml(patientName)}</div>
                <div class="line">${escapeHtml(isAlignerSticker ? `Alinhador ${alignerNumber}` : stickerProductLabel)}</div>
                ${complement ? `<div class="line small">${escapeHtml(complement)}</div>` : ''}
              </div>
            </div>
          </div>
      `
      const labelsHtml = Array.from({ length: totalLabels }, (_, index) => labelBlock(firstAlignerNumber + index)).join('')
      const html = `
        <!doctype html>
        <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Etiquetas - ${escapeHtml(patientName)}</title>
          <style>
            :root {
              --label-size: 62mm;
              --safe-inset-x: 2.4mm;
              --safe-inset-y: 3.8mm;
              --text-x: 3.2mm;
              --text-y: 20.2mm;
              --text-w: 52.4mm;
              --text-h: 17.2mm;
              --font-main: 3.20mm;
              --font-small: 2.70mm;
              --line-gap: 0.48mm;
            }
            @media print {
              @page { size: 62mm 62mm; margin: 0; }
              html, body { margin: 0; padding: 0; width: var(--label-size); }
              .screen-only { display: none !important; }
            }
            @media screen {
              html, body { margin: 0; padding: 0; }
              body { background: #e5e7eb; }
              .sheet { padding: 4mm; }
            }
            body {
              font-family: Verdana, Arial, sans-serif;
              color: #000;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              overflow: visible;
              background: #fff;
            }
            .sheet {
              width: var(--label-size);
            }
            .label {
              position: relative;
              display: block;
              width: var(--label-size);
              height: var(--label-size);
              overflow: hidden;
              background: #fff;
              page-break-after: always;
              break-after: page;
            }
            .label:last-child { page-break-after: auto; break-after: auto; }
            .label.is-internal {
              --text-x: 3.0mm;
              --text-y: 19.2mm;
              --text-w: 52.8mm;
              --text-h: 18.2mm;
              --font-main: 4.10mm;
              --font-small: 3.00mm;
              --line-gap: 0.62mm;
            }
            .label.is-external {
              --text-x: 3.2mm;
              --text-y: 20.2mm;
              --text-w: 52.4mm;
              --text-h: 17.2mm;
              --font-main: 2.95mm;
              --font-small: 2.70mm;
              --line-gap: 0.42mm;
            }
            .art {
              position: absolute;
              left: var(--safe-inset-x);
              top: var(--safe-inset-y);
              width: calc(var(--label-size) - (var(--safe-inset-x) * 2));
              height: calc(var(--label-size) - (var(--safe-inset-y) * 2));
              overflow: hidden;
              background: #fff;
            }
            .bg {
              width: 100%;
              height: 100%;
              display: block;
              object-fit: fill;
              image-rendering: -webkit-optimize-contrast;
            }
            .content {
              position: absolute;
              left: var(--text-x);
              top: var(--text-y);
              width: var(--text-w);
              height: var(--text-h);
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              text-align: center;
              line-height: 1.18;
              font-weight: 700;
              font-size: var(--font-main);
              letter-spacing: 0;
              text-rendering: geometricPrecision;
              -webkit-font-smoothing: none;
            }
            .content .line {
              margin: var(--line-gap) 0;
              max-width: 100%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .content .small { font-size: var(--font-small); }
          </style>
        </head>
        <body>
          <main class="sheet">
            ${labelsHtml}
          </main>
        </body>
        </html>
      `
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const printUrl = URL.createObjectURL(blob)
      const popup = window.open(printUrl, '_blank')
      if (!popup) {
        addToast({ type: 'error', title: 'Imprimir adesivo', message: 'Não foi possível abrir a janela de impressão.' })
        return
      }
      const onLoaded = () => {
        popup.focus()
        popup.print()
        setTimeout(() => URL.revokeObjectURL(printUrl), 10_000)
      }
      if (popup.document.readyState === 'complete') onLoaded()
      else popup.addEventListener('load', onLoaded, { once: true })
    },
    [
      addToast,
      caseById,
      db.dentists,
      db.clinics,
      isSupabaseMode,
      patientOptionById,
      supabaseClinics,
      supabaseCasePrintFallbackByCaseId,
      supabaseDentists,
    ],
  )

  const getGuidePrintContext = useCallback(
    (item: LabItem): GuidePrintContext => {
      const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
      const patientId = caseItem?.patientId ?? item.patientId
      const patientOption = patientId ? patientOptionById.get(patientId) : undefined
      const dentistsById = new Map(
        (isSupabaseMode
          ? supabaseDentists
          : db.dentists.map((entry) => ({ id: entry.id, name: entry.name ?? '-' }))
        ).map((entry) => [entry.id, entry.name]),
      )
      const clinicsById = new Map(
        (isSupabaseMode
          ? supabaseClinics
          : db.clinics.map((entry) => ({ id: entry.id, tradeName: entry.tradeName ?? '-' }))
        ).map((entry) => [entry.id, entry.tradeName]),
      )
      const casePrintFallback = caseItem ? supabaseCasePrintFallbackByCaseId[caseItem.id] : undefined
      const treatmentArch = caseItem?.arch ?? item.arch ?? 'ambos'
      const hasUpperArch = treatmentArch !== 'inferior'
      const hasLowerArch = treatmentArch !== 'superior'
      const totalUpper = hasUpperArch ? toNonNegativeInt(caseItem?.totalTraysUpper ?? caseItem?.totalTrays) : 0
      const totalLower = hasLowerArch ? toNonNegativeInt(caseItem?.totalTraysLower ?? caseItem?.totalTrays) : 0
      const planLabel = hasUpperArch && hasLowerArch
        ? `Superior ${totalUpper} | Inferior ${totalLower}`
        : hasUpperArch
          ? `Superior ${totalUpper}`
          : hasLowerArch
            ? `Inferior ${totalLower}`
            : '-'
      const caseLabel = formatFriendlyRequestCode(caseItem?.treatmentCode ?? item.requestCode ?? caseItem?.id ?? item.id)
      const issueDate = new Date()
      const issueDateLabel = issueDate.toLocaleString('pt-BR')
      const emittedByRaw = currentUser?.name || currentUser?.email || 'Sistema'
      const emittedBy = emittedByRaw.includes('@') ? emittedByRaw.split('@')[0] : emittedByRaw
      const clinicId = caseItem?.clinicId ?? patientOption?.clinicId ?? item.clinicId
      const clinicName = clinicId
        ? clinicsById.get(clinicId) || patientOption?.clinicName || casePrintFallback?.clinicName || '-'
        : patientOption?.clinicName || casePrintFallback?.clinicName || '-'
      const dentistId = caseItem?.dentistId ?? patientOption?.dentistId ?? item.dentistId
      const requesterDentistId = caseItem?.requestedByDentistId ?? dentistId
      const dentistNameRaw = dentistId
        ? dentistsById.get(dentistId) || patientOption?.dentistName || casePrintFallback?.dentistName || '-'
        : patientOption?.dentistName || casePrintFallback?.dentistName || '-'
      const requesterNameRaw = requesterDentistId
        ? dentistsById.get(requesterDentistId) || casePrintFallback?.requesterName || dentistNameRaw
        : casePrintFallback?.requesterName || dentistNameRaw
      const patientBirthDateRaw =
        patientOption?.birthDate ||
        casePrintFallback?.patientBirthDate ||
        (patientId ? db.patients.find((entry) => entry.id === patientId)?.birthDate : undefined)
      const generationDate = item.createdAt ? new Date(item.createdAt) : issueDate
      const deliveryExpectedDate = new Date(generationDate)
      deliveryExpectedDate.setDate(deliveryExpectedDate.getDate() + 10)

      return {
        caseLabel,
        issueDateLabel,
        patientName: caseItem?.patientName ?? item.patientName,
        patientBirthDateLabel: patientBirthDateRaw ? formatGuideDate(patientBirthDateRaw) : '-',
        clinicName,
        dentistName: withProfessionalPrefix(dentistNameRaw),
        requesterName: withProfessionalPrefix(requesterNameRaw),
        productLabel: resolveLabProductLabel(item, caseItem),
        planLabel,
        changeDaysLabel: String(caseItem?.changeEveryDays ?? 10),
        deliveryExpectedLabel: deliveryExpectedDate.toLocaleDateString('pt-BR'),
        emittedBy,
        emitOrigin: window.location.origin,
        hasUpperArch,
        hasLowerArch,
      }
    },
    [
      caseById,
      currentUser,
      db.clinics,
      db.dentists,
      db.patients,
      isSupabaseMode,
      patientOptionById,
      resolveLabProductLabel,
      supabaseCasePrintFallbackByCaseId,
      supabaseClinics,
      supabaseDentists,
    ],
  )

  const preparePrintPopup = useCallback((title: string) => {
    const popup = window.open('', '_blank')
    if (!popup) return null
    popup.document.write(`
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; }
          p { margin: 0; font-size: 14px; }
        </style>
      </head>
      <body>
        <p>Gerando impressao...</p>
      </body>
      </html>
    `)
    popup.document.close()
    return popup
  }, [])

  const printHtmlDocument = useCallback(
    (html: string, errorTitle: string, preparedPopup?: Window | null) => {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const printUrl = URL.createObjectURL(blob)
      const popup = preparedPopup && !preparedPopup.closed ? preparedPopup : window.open(printUrl, '_blank')
      if (!popup) {
        URL.revokeObjectURL(printUrl)
        addToast({ type: 'error', title: errorTitle, message: 'Não foi possível abrir a janela de impressão.' })
        return false
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
      if (preparedPopup && !preparedPopup.closed) {
        popup.addEventListener('load', onLoaded, { once: true })
        popup.location.replace(printUrl)
      } else if (popup.document.readyState === 'complete') {
        onLoaded()
      } else {
        popup.addEventListener('load', onLoaded, { once: true })
      }
      return true
    },
    [addToast],
  )

  const forcePrintHtmlDocument = useCallback(
    (html: string, errorTitle: string, preparedPopup?: Window | null) => {
      const popup = preparedPopup && !preparedPopup.closed ? preparedPopup : window.open('', '_blank')
      if (!popup) {
        addToast({ type: 'error', title: errorTitle, message: 'Não foi possível abrir a janela de impressão.' })
        return false
      }
      let printed = false
      const runPrint = () => {
        if (printed || popup.closed) return
        printed = true
        popup.focus()
        popup.print()
      }
      popup.addEventListener('load', () => {
        setTimeout(runPrint, 150)
      }, { once: true })
      popup.document.open()
      popup.document.write(html)
      popup.document.close()
      setTimeout(runPrint, 900)
      return true
    },
    [addToast],
  )

  const printGuideDocument = useCallback(
    (item: LabItem, options: GuidePrintOptions, preparedPopup?: Window | null, forcePrint = false) =>
      (forcePrint ? forcePrintHtmlDocument : printHtmlDocument)(
        buildLabGuideHtml(getGuidePrintContext(item), options),
        options.kind === 'initial' ? 'Reimpressao O.S' : 'Comprovante de entrega',
        preparedPopup,
      ),
    [forcePrintHtmlDocument, getGuidePrintContext, printHtmlDocument],
  )

  const reprintGuideFromModal = useCallback(
    (item: LabItem) => {
      printGuideDocument(item, { kind: 'initial' })
    },
    [printGuideDocument],
  )

  return (
    <AppShell breadcrumb={['Início', 'Laboratório']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Laboratório</h1>
          <p className="mt-2 text-sm text-slate-500">Fila de produção e entregas</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {canWrite ? (
            <Button className="w-full sm:w-auto" variant="secondary" onClick={handleConfigureBrotherPrinter}>
              Impressora Brother
            </Button>
          ) : null}
          {canAiLab ? (
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void runLabAi('/lab/auditoria-solicitacao', 'Auditar solicitação')}>
              Auditar solicitação
            </Button>
          ) : null}
          {canAiLab ? (
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void runLabAi('/lab/previsao-entrega', 'Prever próxima entrega')}>
              Prever próxima entrega
            </Button>
          ) : null}
          {canWrite ? (
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setDeliveryOpen(true)}>
              Registrar entrega ao profissional
            </Button>
          ) : null}
        </div>
      </section>

      {canWrite ? (
        <section className="mt-2">
          <p className="text-xs text-slate-500">
            Impressora vinculada: {preferredBrotherPrinter.trim() || 'Não definida (será usada a padrão do navegador)'}
          </p>
        </section>
      ) : null}

      {canAiLab ? (
        <section className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-semibold">Alertas IA</p>
          <div className="mt-2 space-y-1">
            {aiAlerts.length === 0 ? <p>Nenhum alerta salvo.</p> : aiAlerts.slice(0, 5).map((item, idx) => <p key={`${idx}_${item.slice(0, 20)}`}>{item}</p>)}
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <LabFilters
          search={search}
          priority={priority}
          overdueOnly={overdueOnly}
          alertsOnly={alertsOnly}
          status={status}
          origin={originFilter}
          onSearchChange={setSearch}
          onPriorityChange={setPriority}
          onOverdueOnlyChange={setOverdueOnly}
          onAlertsOnlyChange={setAlertsOnly}
          onStatusChange={setStatus}
          onOriginChange={setOriginFilter}
        />
      </section>

      <section className="mt-6">
        <LabKpiRow kpis={kpis} />
      </section>

      {alertsOnly && alertSummaries.length > 0 ? (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {alertSummaries.map((item) => (
            <p key={`${item.caseId}_${item.dueDate}`}>{item.patientName}: {item.title} (previsto para {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString('pt-BR')})</p>
          ))}
        </section>
      ) : null}

      <section className="mt-6">
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          <Button variant={boardTab === 'esteira' ? 'primary' : 'secondary'} onClick={() => setBoardTab('esteira')}>
            Esteira
          </Button>
          <Button variant={boardTab === 'reconfeccao' ? 'primary' : 'secondary'} onClick={() => setBoardTab('reconfeccao')}>
            Placas com defeito (reconfecção)
          </Button>
          <Button variant={boardTab === 'banco_restante' ? 'primary' : 'secondary'} onClick={() => setBoardTab('banco_restante')}>
            Banco de reposições
          </Button>
        </div>
        {boardTab === 'esteira' ? (
          <LabBoard
            items={pipelineItems}
            guideTone={guideTone}
            caseLabel={caseLabel}
            productLabel={resolveLabProductLabel}
            onItemsChange={() => {
              if (isSupabaseMode) setSupabaseRefreshKey((current) => current + 1)
            }}
            onDetails={(item) => setModal({ open: true, mode: 'edit', item })}
            onPrintLabel={printStickerFromCard}
            onMoveStatus={canWrite ? (isSupabaseMode ? handleMoveStatusSupabase : handleMoveStatusLocal) : undefined}
            canEdit={canWrite}
          />
        ) : boardTab === 'reconfeccao' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {reworkItems.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma placa com defeito encontrada com os filtros atuais.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">OS</th>
                      <th className="px-3 py-2 font-semibold">Paciente</th>
                      <th className="px-3 py-2 font-semibold">Placa</th>
                      <th className="px-3 py-2 font-semibold">Arcada</th>
                      <th className="px-3 py-2 font-semibold">Prazo</th>
                      <th className="px-3 py-2 font-semibold">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reworkItems.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          {formatFriendlyRequestCode((item.caseId ? caseById.get(item.caseId)?.treatmentCode : undefined) ?? item.requestCode)}
                        </td>
                        <td className="px-3 py-2">{item.patientName}</td>
                        <td className="px-3 py-2">#{item.trayNumber}</td>
                        <td className="px-3 py-2">{item.arch}</td>
                        <td className="px-3 py-2">{formatDate(item.dueDate)}</td>
                        <td className="px-3 py-2">{item.notes || 'Reavaliar item em controle de qualidade.'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {remainingBankItems.length === 0 ? (
              <p className="text-sm text-slate-500">Sem placas no banco de restante para os filtros atuais.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">OS</th>
                      <th className="px-3 py-2 font-semibold">Paciente</th>
                      <th className="px-3 py-2 font-semibold">Produto</th>
                      <th className="px-3 py-2 font-semibold">Pedido (Inf/Sup)</th>
                      <th className="px-3 py-2 font-semibold">Entregue ao paciente (Inf/Sup)</th>
                      <th className="px-3 py-2 font-semibold">Saldo restante (Inf/Sup)</th>
                      <th className="px-3 py-2 font-semibold">Data instalação</th>
                      <th className="px-3 py-2 font-semibold">Previsão reposição LAB</th>
                      <th className="px-3 py-2 font-semibold">Status do pedido</th>
                      <th className="px-3 py-2 font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remainingBankItems.map((item) => {
                      const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
                      const treatmentArch = caseItem?.arch ?? item.arch ?? 'ambos'
                      const totals = normalizeByTreatmentArch(getCaseTotalsByArch(caseItem), treatmentArch)
                      const delivered = normalizeByTreatmentArch(getDeliveredByArch(caseItem), treatmentArch)
                      const remaining = {
                        upper: Math.max(0, totals.upper - delivered.upper),
                        lower: Math.max(0, totals.lower - delivered.lower),
                      }
                      const installationDate = caseItem?.installation?.installedAt
                      const nextAlignerStartDate = caseItem ? getNextDeliveryDueDate(caseItem) : null
                      const replenishmentLabDate = nextAlignerStartDate ? minusDays(nextAlignerStartDate, guideAutomationLeadDays) : null
                      const readyForDelivery = !!(caseItem && casesReadyForDelivery.has(caseItem.id))
                      const treatmentStatus =
                        caseItem?.status === 'finalizado'
                          ? 'Finalizado'
                          : readyForDelivery
                            ? 'Pronto para entrega'
                          : installationDate
                            ? 'Em producao'
                            : 'Aguardando instalação'

                      return (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{formatFriendlyRequestCode(caseItem?.treatmentCode ?? item.requestCode)}</td>
                          <td className="px-3 py-2">{item.patientName}</td>
                          <td className="px-3 py-2">{resolveLabProductLabel(item, caseItem)}</td>
                          <td className="px-3 py-2">{formatInfSupByArch(totals, treatmentArch)}</td>
                          <td className="px-3 py-2">{formatInfSupByArch(delivered, treatmentArch)}</td>
                          <td className="px-3 py-2">{formatInfSupByArch(remaining, treatmentArch)}</td>
                          <td className="px-3 py-2">{installationDate ? formatDate(installationDate) : '-'}</td>
                          <td className="px-3 py-2">{replenishmentLabDate ? formatDate(replenishmentLabDate) : '-'}</td>
                          <td className="px-3 py-2">{treatmentStatus}</td>
                          <td className="px-3 py-2">
                            {canWrite && item.caseId ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setAdvanceTarget(item)
                                  const nextUpper = treatmentArch === 'inferior' ? 0 : Math.max(0, remaining.upper)
                                  const nextLower = treatmentArch === 'superior' ? 0 : Math.max(0, remaining.lower)
                                  setAdvanceUpperQty(String(nextUpper))
                                  setAdvanceLowerQty(String(nextLower))
                                  setAdvanceModalOpen(true)
                                }}
                              >
                                Solicitar reposição
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <LabItemModal
        mode={modal.mode}
        item={modal.item}
        open={modal.open}
        cases={caseSource}
        patientOptions={patientOptions}
        readOnly={!canWrite}
        onClose={() => setModal({ open: false, mode: 'create', item: null })}
        onCreate={handleCreate}
        onSave={handleSave}
        onDelete={handleDelete}
        onReprintGuide={reprintGuideFromModal}
        allowDelete={canDeleteLab}
      />
      <RegisterDeliveryLotModal
        open={deliveryOpen}
        caseOptions={deliveryCaseOptions}
        selectedCaseId={deliveryCaseId}
        isSelectedRework={selectedDeliveryIsRework}
        selectedProductLabel={selectedDeliveryProductLabel}
        selectedArch={selectedDeliveryItem?.arch ?? ''}
        requiresArchQuantities={selectedDeliveryRequiresArchQuantities}
        initialUpperQty={deliveryInitialUpperQty}
        initialLowerQty={deliveryInitialLowerQty}
        onCaseChange={setDeliveryCaseId}
        onClose={() => setDeliveryOpen(false)}
        onConfirm={(payload) => {
          void (async () => {
            if (!canWrite) return
            if (!deliveryCaseId) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Selecione um pedido.' })
              return
            }
            const selectedReadyItem = readyDeliveryItems.find((item) => item.id === deliveryCaseId)
            if (!selectedReadyItem) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Selecione uma OS pronta valida.' })
              return
            }
            const closePreparedPopup = (popup?: Window | null) => {
              if (popup && !popup.closed) popup.close()
            }
            if (!selectedReadyItem.caseId) {
              const deliveryReceipt: GuidePrintOptions = {
                kind: 'delivery_receipt',
                deliveredToDoctorAt: payload.deliveredToDoctorAt,
                deliveredUpperQty: 0,
                deliveredLowerQty: 0,
                note: payload.note,
              }
              const preparedPopup = preparePrintPopup('Comprovante de entrega ao dentista')
              if (isSupabaseMode) {
                if (!supabase) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: 'Supabase não configurado.' })
                  return
                }
                const { data: current, error: readError } = await supabase
                  .from('lab_items')
                  .select('id, data, notes')
                  .eq('id', selectedReadyItem.id)
                  .maybeSingle()
                if (readError || !current) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: readError?.message ?? 'OS não encontrada.' })
                  return
                }
                const currentData = asObject((current as Record<string, unknown>).data)
                const nextData = {
                  ...currentData,
                  deliveredToProfessionalAt: payload.deliveredToDoctorAt,
                }
                const { error } = await supabase
                  .from('lab_items')
                  .update({
                    data: nextData,
                    notes: payload.note ?? (asText((current as Record<string, unknown>).notes) || null),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', selectedReadyItem.id)
                if (error) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: error.message })
                  return
                }
                setSupabaseItems((currentItems) => currentItems.filter((item) => item.id !== selectedReadyItem.id))
                setSupabaseRefreshKey((current) => current + 1)
                setDeliveryOpen(false)
                setDeliveryCaseId('')
                addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
                printGuideDocument(selectedReadyItem, deliveryReceipt, preparedPopup, Boolean(payload.forcePrint))
                return
              }
              const result = updateLabItem(selectedReadyItem.id, {
                deliveredToProfessionalAt: payload.deliveredToDoctorAt,
                notes: payload.note ?? selectedReadyItem.notes,
              })
              if (result.error) {
                closePreparedPopup(preparedPopup)
                addToast({ type: 'error', title: 'Entrega de lote', message: result.error })
                return
              }
              setDeliveryOpen(false)
              setDeliveryCaseId('')
              addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
              printGuideDocument(selectedReadyItem, deliveryReceipt, preparedPopup, Boolean(payload.forcePrint))
              return
            }
            const selectedCaseId = selectedReadyItem.caseId
            const caseItem = caseById.get(selectedCaseId)
            if (!caseItem) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Pedido não encontrado.' })
              return
            }
            const selectedProductType = normalizeProductType(
              selectedReadyItem.productId
                ?? selectedReadyItem.productType
                ?? caseItem.productId
                ?? caseItem.productType,
            )
            const selectedRequiresArchQuantities = isAlignerProductType(selectedProductType)
            const caseTotals = getCaseTotalsByArch(caseItem)
            const selectedIsRework = isReworkItem(selectedReadyItem) || isReworkProductionItem(selectedReadyItem)
            const upperQty = Math.max(0, Math.trunc(payload.upperQty))
            const lowerQty = Math.max(0, Math.trunc(payload.lowerQty))
            if (!selectedIsRework && selectedRequiresArchQuantities && upperQty + lowerQty <= 0) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Informe quantidade superior e/ou inferior.' })
              return
            }

            if (!selectedIsRework && !selectedRequiresArchQuantities) {
              const nextStatus = 'em_entrega'
              const nextPhase = 'em_producao'
              const nextNote = payload.note ?? selectedReadyItem.notes
              const deliveryReceipt: GuidePrintOptions = {
                kind: 'delivery_receipt',
                deliveredToDoctorAt: payload.deliveredToDoctorAt,
                deliveredUpperQty: 0,
                deliveredLowerQty: 0,
                note: payload.note,
              }
              const preparedPopup = preparePrintPopup('Comprovante de entrega ao dentista')
              if (isSupabaseMode) {
                if (!supabase) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: 'Supabase não configurado.' })
                  return
                }
                const nowIso = new Date().toISOString()
                const { error: labError } = await supabase
                  .from('lab_items')
                  .update({
                    data: {
                      ...selectedReadyItem,
                      deliveredToProfessionalAt: payload.deliveredToDoctorAt,
                    },
                    notes: nextNote ?? null,
                    updated_at: nowIso,
                  })
                  .eq('id', selectedReadyItem.id)
                if (labError) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: labError.message })
                  return
                }
                const nextData = {
                  ...caseItem,
                  status: nextStatus,
                  phase: nextPhase,
                  updatedAt: nowIso,
                }
                const { error: caseError } = await supabase
                  .from('cases')
                  .update({
                    data: nextData,
                    status: nextStatus,
                    updated_at: nowIso,
                  })
                  .eq('id', selectedCaseId)
                if (caseError) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: caseError.message })
                  return
                }
                setSupabaseRefreshKey((current) => current + 1)
              } else {
                const labResult = updateLabItem(selectedReadyItem.id, {
                  deliveredToProfessionalAt: payload.deliveredToDoctorAt,
                  notes: nextNote,
                })
                if (labResult.error) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: labResult.error })
                  return
                }
                updateCase(selectedCaseId, {
                  status: nextStatus,
                  phase: nextPhase,
                })
              }

              setDeliveryOpen(false)
              setDeliveryCaseId('')
              addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
              printGuideDocument(selectedReadyItem, deliveryReceipt, preparedPopup, Boolean(payload.forcePrint))
              return
            }

            const ops: Array<{ arch: 'superior' | 'inferior'; fromTray: number; toTray: number }> = []
            if (selectedIsRework) {
              if (selectedReadyItem.arch === 'superior' || selectedReadyItem.arch === 'ambos') {
                ops.push({ arch: 'superior', fromTray: selectedReadyItem.trayNumber, toTray: selectedReadyItem.trayNumber })
              }
              if (selectedReadyItem.arch === 'inferior' || selectedReadyItem.arch === 'ambos') {
                ops.push({ arch: 'inferior', fromTray: selectedReadyItem.trayNumber, toTray: selectedReadyItem.trayNumber })
              }
            }
            if (!selectedIsRework && upperQty > 0) {
              const range = nextRangeByArch(caseItem, 'superior', upperQty)
              if (range.toTray > caseTotals.upper) {
                addToast({ type: 'error', title: 'Entrega de lote', message: `Quantidade superior excede o total da arcada superior (${caseTotals.upper}).` })
                return
              }
              ops.push({ arch: 'superior', ...range })
            }
            if (!selectedIsRework && lowerQty > 0) {
              const range = nextRangeByArch(caseItem, 'inferior', lowerQty)
              if (range.toTray > caseTotals.lower) {
                addToast({ type: 'error', title: 'Entrega de lote', message: `Quantidade inferior excede o total da arcada inferior (${caseTotals.lower}).` })
                return
              }
              ops.push({ arch: 'inferior', ...range })
            }
            if (!ops.length) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Nenhum lote valido para registrar.' })
              return
            }

            const deliveredUpperQty = ops
              .filter((op) => op.arch === 'superior')
              .reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
            const deliveredLowerQty = ops
              .filter((op) => op.arch === 'inferior')
              .reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
            const deliveryReceipt: GuidePrintOptions = {
              kind: 'delivery_receipt',
              deliveredToDoctorAt: payload.deliveredToDoctorAt,
              deliveredUpperQty,
              deliveredLowerQty,
              note: payload.note,
            }
            const preparedPopup = preparePrintPopup('Comprovante de entrega ao dentista')

            if (isSupabaseMode) {
              if (!supabase) {
                closePreparedPopup(preparedPopup)
                addToast({ type: 'error', title: 'Entrega de lote', message: 'Supabase não configurado.' })
                return
              }
              const nextLots = [...(caseItem.deliveryLots ?? [])]
              const nextTrays = (caseItem.trays ?? []).map((tray) => ({ ...tray }))
              ops.forEach((op) => {
                nextLots.push({
                  id: `lot_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
                  arch: op.arch,
                  fromTray: op.fromTray,
                  toTray: op.toTray,
                  quantity: op.toTray - op.fromTray + 1,
                  deliveredToDoctorAt: payload.deliveredToDoctorAt,
                  note: payload.note,
                  createdAt: new Date().toISOString(),
                })
                for (let trayNumber = op.fromTray; trayNumber <= op.toTray; trayNumber += 1) {
                  const tray = nextTrays.find((item) => item.trayNumber === trayNumber)
                  if (tray) {
                    tray.state = 'entregue'
                    tray.deliveredAt = payload.deliveredToDoctorAt
                  }
                }
              })
              const nextStatus = 'em_entrega'
              const nextPhase = 'em_producao'
              const nowIso = new Date().toISOString()
              const nextData = {
                ...caseItem,
                deliveryLots: nextLots,
                trays: nextTrays,
                status: nextStatus,
                phase: nextPhase,
                updatedAt: nowIso,
              }
              const { error } = await supabase
                .from('cases')
                .update({
                  data: nextData,
                  status: nextStatus,
                  updated_at: nowIso,
                })
                .eq('id', selectedCaseId)
              if (error) {
                closePreparedPopup(preparedPopup)
                addToast({ type: 'error', title: 'Entrega de lote', message: error.message })
                return
              }
              setSupabaseRefreshKey((current) => current + 1)
            } else {
              for (const op of ops) {
                const result = registerCaseDeliveryLot(selectedCaseId, {
                  arch: op.arch,
                  fromTray: op.fromTray,
                  toTray: op.toTray,
                  deliveredToDoctorAt: payload.deliveredToDoctorAt,
                  note: payload.note,
                })
                if (!result.ok) {
                  closePreparedPopup(preparedPopup)
                  addToast({ type: 'error', title: 'Entrega de lote', message: result.error })
                  return
                }
              }
            }

            setDeliveryOpen(false)
            setDeliveryCaseId('')
            addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
            printGuideDocument(selectedReadyItem, deliveryReceipt, preparedPopup, Boolean(payload.forcePrint))
          })()
        }}
      />


      {productionConfirm.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-lg">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar início da producao</h3>
            <p className="mt-2 text-sm text-slate-600">
              Confirmar producao de {productionConfirm.productLabel} para arcada {productionConfirm.archLabel}?
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => resolveProductionConfirmation(false)}>
                Cancelar
              </Button>
              <Button onClick={() => resolveProductionConfirmation(true)}>
                Confirmar
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {advanceModalOpen && advanceTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-md">
            <h3 className="text-lg font-semibold text-slate-900">Solicitar reposição</h3>
            <p className="mt-1 text-sm text-slate-500">
              {advanceTarget.patientName} - {advanceTarget.requestCode ?? `Placa #${advanceTarget.trayNumber}`}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Qtd Sup</label>
                <Input type="number" min={0} value={advanceUpperQty} onChange={(e) => setAdvanceUpperQty(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Qtd Inf</label>
                <Input type="number" min={0} value={advanceLowerQty} onChange={(e) => setAdvanceLowerQty(e.target.value)} />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdvanceModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  void (async () => {
                    if (isSupabaseMode) {
                      const result = await createAdvanceLabOrderSupabase(advanceTarget.id, {
                        plannedUpperQty: Number(advanceUpperQty),
                        plannedLowerQty: Number(advanceLowerQty),
                      })
                      if (!result.ok) {
                        addToast({ type: 'error', title: 'Solicitacao de reposição', message: result.error })
                        return
                      }
                      setSupabaseRefreshKey((current) => current + 1)
                      setAdvanceModalOpen(false)
                      setAdvanceTarget(null)
                      addToast({ type: 'success', title: 'Guia gerada na esteira de aguardando iniciar' })
                      return
                    }

                    const result = createAdvanceLabOrder(advanceTarget.id, {
                      plannedUpperQty: Number(advanceUpperQty),
                      plannedLowerQty: Number(advanceLowerQty),
                    })
                    if (!result.ok) {
                      addToast({ type: 'error', title: 'Solicitacao de reposição', message: result.error })
                      return
                    }
                    if (!result.sync.ok) {
                      addToast({ type: 'error', title: 'Solicitacao de reposição', message: result.sync.message })
                      return
                    }
                    setAdvanceModalOpen(false)
                    setAdvanceTarget(null)
                    addToast({ type: 'success', title: 'Guia gerada na esteira de aguardando iniciar' })
                  })()
                }}
              >
                Gerar guia
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <AiEditableModal
        open={aiModalOpen}
        title={aiModalTitle}
        value={aiDraft}
        loading={aiLoading}
        onChange={setAiDraft}
        onClose={() => setAiModalOpen(false)}
        onSave={() => {
          setAiAlerts((current) => [aiDraft.trim(), ...current].filter((item) => item))
          setAiModalOpen(false)
        }}
        saveLabel="Salvar em Alertas IA"
      />
    </AppShell>
  )
}




