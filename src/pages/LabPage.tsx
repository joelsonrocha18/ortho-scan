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
import { registerCaseDeliveryLot } from '../data/caseRepo'
import { addLabItem, createAdvanceLabOrder, deleteLabItem, listLabItems, moveLabItem, updateLabItem } from '../data/labRepo'
import { getPipelineItems } from '../domain/labPipeline'
import { getNextDeliveryDueDate, getReplenishmentAlerts } from '../domain/replenishment'
import AppShell from '../layouts/AppShell'
import type { LabItem, LabStatus } from '../types/Lab'
import type { ProductType } from '../types/Product'
import { isAlignerProductType, normalizeProductType, PRODUCT_TYPE_LABEL } from '../types/Product'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { listCasesForUser, listLabItemsForUser } from '../auth/scope'
import { supabase } from '../lib/supabaseClient'
import { loadSystemSettings } from '../lib/systemSettings'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { deleteLabItemSupabase } from '../repo/profileRepo'
import { runAiEndpoint as runAiRequest } from '../repo/aiRepo'

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
  dentistId?: string
  clinicId?: string
  dentistName?: string
  clinicName?: string
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

function getDeliveredByArch(caseItem?: {
  installation?: { deliveredUpper?: number; deliveredLower?: number }
  deliveryLots?: Array<{ arch: 'superior' | 'inferior' | 'ambos'; quantity: number }>
}) {
  if (!caseItem) return { upper: 0, lower: 0 }
  const fromDentistLots = (caseItem.deliveryLots ?? []).reduce(
    (acc, lot) => {
      const qty = toNonNegativeInt(lot.quantity)
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
  if (fromDentistLots.upper > 0 || fromDentistLots.lower > 0) {
    return fromDentistLots
  }
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
  installation?: { deliveredUpper?: number; deliveredLower?: number }
  deliveryLots?: Array<{ arch: 'superior' | 'inferior' | 'ambos'; quantity: number }>
}) {
  if (!caseItem) return false
  const totals = getCaseTotalsByArch(caseItem)
  const delivered = getDeliveredByArch(caseItem)
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

export default function LabPage() {
  const [searchParams] = useSearchParams()
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'lab.write')
  const canAiLab = can(currentUser, 'ai.lab')
  const canDeleteLab = currentUser?.role === 'master_admin'
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'todos' | 'urgente' | 'medio' | 'baixo'>('todos')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [status, setStatus] = useState<'todos' | LabStatus>('todos')
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
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()
  const [productionConfirm, setProductionConfirm] = useState<ProductionConfirmState>({
    open: false,
    productLabel: '',
    archLabel: '',
    resolver: null,
  })
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
      return
    }
    let active = true
    void (async () => {
      const [casesRes, labRes, patientsRes, dentistsRes, clinicsRes] = await Promise.all([
        supabase
          .from('cases')
          .select('id, short_id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, status, product_type, product_id, data, deleted_at')
          .is('deleted_at', null),
        supabase
          .from('lab_items')
          .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, deleted_at, data')
          .is('deleted_at', null),
        supabase.from('patients').select('id, short_id, name, clinic_id, primary_dentist_id, deleted_at').is('deleted_at', null),
        supabase.from('dentists').select('id, name, deleted_at').is('deleted_at', null),
        supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null),
      ])
      if (!active) return

      const dentistsById = new Map(
        ((dentistsRes.data ?? []) as Array<{ id: string; name?: string }>).map((row) => [row.id, row.name ?? '-']),
      )
      const clinicsById = new Map(
        ((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => [row.id, row.trade_name ?? '-']),
      )
      const patientOptions = ((patientsRes.data ?? []) as Array<{ id: string; short_id?: string; name?: string; clinic_id?: string; primary_dentist_id?: string }>).map((row) => ({
        id: row.id,
        shortId: row.short_id ?? undefined,
        name: row.name ?? '-',
        clinicId: row.clinic_id ?? undefined,
        dentistId: row.primary_dentist_id ?? undefined,
        clinicName: row.clinic_id ? clinicsById.get(row.clinic_id) : undefined,
        dentistName: row.primary_dentist_id ? dentistsById.get(row.primary_dentist_id) : undefined,
      }))
      setSupabasePatientOptions(patientOptions)

      const mappedCases = ((casesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const data = asObject(row.data)
        const createdAt = new Date().toISOString()
        return {
          id: asText(row.id),
          shortId: asText(row.short_id) || undefined,
          productType: normalizeProductType(row.product_type ?? row.product_id ?? data.productType ?? data.productId),
          productId: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
          patientId: asText(data.patientId, asText(row.patient_id)) || undefined,
          dentistId: asText(data.dentistId, asText(row.dentist_id)) || undefined,
          clinicId: asText(data.clinicId, asText(row.clinic_id)) || undefined,
          treatmentCode: asText(data.treatmentCode) || undefined,
          treatmentOrigin: (asText(data.treatmentOrigin, 'externo') as 'interno' | 'externo'),
          patientName: asText(data.patientName, '-'),
          requestedByDentistId: asText(row.requested_by_dentist_id) || undefined,
          scanDate: asText(data.scanDate, createdAt.slice(0, 10)),
          totalTrays: asNumber(data.totalTrays, 0),
          changeEveryDays: asNumber(data.changeEveryDays, 7),
          totalTraysUpper: asNumber(data.totalTraysUpper, asNumber(data.totalTrays, 0)),
          totalTraysLower: asNumber(data.totalTraysLower, asNumber(data.totalTrays, 0)),
          attachmentBondingTray: Boolean(data.attachmentBondingTray),
          status: (asText(data.status, 'planejamento') as 'planejamento' | 'em_producao' | 'em_entrega' | 'finalizado'),
          phase: (asText(data.phase, 'planejamento') as 'planejamento' | 'orcamento' | 'contrato_pendente' | 'contrato_aprovado' | 'em_producao' | 'finalizado'),
          budget: data.budget as typeof db.cases[number]['budget'],
          contract: data.contract as typeof db.cases[number]['contract'],
          deliveryLots: (data.deliveryLots as typeof db.cases[number]['deliveryLots']) ?? [],
          installation: data.installation as typeof db.cases[number]['installation'],
          trays: (data.trays as typeof db.cases[number]['trays']) ?? [],
          attachments: [],
          sourceScanId: asText(data.sourceScanId) || undefined,
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
          productType: normalizeProductType(row.product_type ?? row.product_id ?? data.productType ?? data.productId),
          productId: normalizeProductType(row.product_id ?? row.product_type ?? data.productId ?? data.productType),
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
          const notes = `Solicitacao automatica de reposicao programada (${caseItem.id}_${tray.trayNumber}_${expected}).`
          const data = {
            requestCode,
            requestKind: 'reposicao_programada',
            expectedReplacementDate: expected,
            productType: resolvedProductType,
            productId: resolvedProductType,
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
  const deliveryInitialUpperQty = useMemo(() => {
    if (!selectedDeliveryItem || selectedDeliveryIsRework) return 0
    if (selectedDeliveryItem.arch === 'inferior') return 0
    return Math.max(0, Math.trunc(selectedDeliveryItem.plannedUpperQty ?? 0))
  }, [selectedDeliveryIsRework, selectedDeliveryItem])
  const deliveryInitialLowerQty = useMemo(() => {
    if (!selectedDeliveryItem || selectedDeliveryIsRework) return 0
    if (selectedDeliveryItem.arch === 'superior') return 0
    return Math.max(0, Math.trunc(selectedDeliveryItem.plannedLowerQty ?? 0))
  }, [selectedDeliveryIsRework, selectedDeliveryItem])
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
      return matchSearch && matchPriority && matchStatus && matchOverdue && matchAlerts
    })
  }, [alertsOnly, caseById, casesWithAlerts, items, overdueOnly, patientOptionById, priority, search, status])
  const isDeliveredToProfessional = useCallback((item: LabItem) => {
    return isDeliveredToProfessionalItem(item, caseById)
  }, [caseById])
  const pipelineBaseItems = useMemo(
    () => getPipelineItems(items, { isDeliveredToProfessional }),
    [isDeliveredToProfessional, items],
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
    if (item.requestCode) return item.requestCode
    return item.requestCode ?? treatment
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
      if (!supabase) return { ok: false, message: 'Supabase nao configurado.' }
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
          addToast({ type: 'info', title: 'Reposicao inicial', message: seed.error })
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
          addToast({ type: 'info', title: 'Reposicao inicial', message: seed.error })
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
    const confirmed = window.confirm('Confirma excluir esta OS? O evento sera registrado no historico do paciente.')
    if (!confirmed) return
    if (isSupabaseMode) {
      if (!supabase) {
        addToast({ type: 'error', title: 'Exclusao', message: 'Supabase nao configurado.' })
        return
      }
      void (async () => {
        const result = await deleteLabItemSupabase(id)
        if (!result.ok) {
          addToast({ type: 'error', title: 'Exclusao', message: result.error })
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
      if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.' }
      if (!source.caseId) return { ok: true as const }
      if (asText(source.data.requestKind, 'producao') !== 'producao') return { ok: true as const }
      if (source.status !== 'em_producao') return { ok: true as const }

      const trayNumber = Math.max(1, Math.trunc(source.trayNumber))
      const [caseRes, rowsRes] = await Promise.all([
        supabase.from('cases').select('id, clinic_id, data').eq('id', source.caseId).maybeSingle(),
        supabase.from('lab_items').select('id, tray_number, data').eq('case_id', source.caseId),
      ])
      if (caseRes.error || !caseRes.data) {
        return { ok: false as const, error: caseRes.error?.message ?? 'Caso vinculado nao encontrado.' }
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
        notes: `Reposicao inicial gerada no inicio da confeccao da placa #${trayNumber}.`,
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
      if (!supabase) return { ok: false as const, error: 'Supabase nao configurado.' }
      const { data: current, error: readError } = await supabase
        .from('lab_items')
        .select('id, case_id, tray_number, status, priority, product_type, product_id, data')
        .eq('id', id)
        .maybeSingle()
      if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Item LAB nao encontrado.' }

      const currentData = asObject(current.data)
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
          PRODUCT_TYPE_LABEL[nextProductType],
          archLabel(nextArch as 'superior' | 'inferior' | 'ambos'),
        )
        if (!confirmed) {
          return { ok: false as const, error: 'Producao cancelada pelo usuario.' }
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
          addToast({ type: 'info', title: 'Reposicao inicial', message: seed.error })
        }
      }
      setSupabaseRefreshKey((currentKey) => currentKey + 1)
      return { ok: true as const }
    },
    [addToast, askProductionConfirmation, seedInitialReplenishmentSupabase],
  )

  const handleMoveStatusLocal = useCallback(
    async (id: string, next: LabStatus) => {
      const current = items.find((item) => item.id === id)
      if (!current) return { ok: false as const, error: 'Item LAB nao encontrado.' }
      if (next === 'em_producao') {
        if (!current.arch) {
          return { ok: false as const, error: 'Defina a arcada do produto antes de iniciar producao.' }
        }
        const currentProductType = normalizeProductType(current.productId ?? current.productType)
        if (isAlignerProductType(currentProductType) && (current.plannedUpperQty ?? 0) + (current.plannedLowerQty ?? 0) <= 0) {
          return { ok: false as const, error: 'Defina quantidades por arcada antes de iniciar producao.' }
        }
        const confirmed = await askProductionConfirmation(
          PRODUCT_TYPE_LABEL[currentProductType],
          archLabel(current.arch),
        )
        if (!confirmed) {
          return { ok: false as const, error: 'Producao cancelada pelo usuario.' }
        }
      }
      const result = moveLabItem(id, next)
      if (result.error) return { ok: false as const, error: result.error }
      return { ok: true as const }
    },
    [askProductionConfirmation, items],
  )

  const runLabAi = async (endpoint: '/lab/auditoria-solicitacao' | '/lab/previsao-entrega', title: string) => {
    if (!canAiLab) return
    const highlighted = pipelineItems.slice(0, 8).map((item) => ({
      id: item.id,
      patientName: item.patientName,
      requestCode: item.requestCode,
      dueDate: item.dueDate,
      status: item.status,
      notes: item.notes,
    }))
    const result = await runAiRequest(endpoint, {
      clinicId: currentUser?.linkedClinicId,
      inputText: `Itens de laboratorio ativos: ${pipelineBaseItems.length}. Reconfeccoes: ${reworkItems.length}. Prontos: ${readyDeliveryItems.length}.`,
      metadata: {
        highlighted,
        overdue: pipelineBaseItems.filter((item) => isOverdue(item)).length,
      },
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'IA Laboratorio', message: result.error })
      return
    }
    setAiModalTitle(title)
    setAiDraft(result.output)
    setAiModalOpen(true)
  }

  return (
    <AppShell breadcrumb={['Início', 'Laboratório']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Laboratório</h1>
          <p className="mt-2 text-sm text-slate-500">Fila de produção e entregas</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
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
          {canWrite ? (
            <Button className="w-full sm:w-auto" onClick={() => setModal({ open: true, mode: 'create', item: null })}>Solicitacao avulsa</Button>
          ) : null}
        </div>
      </section>

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
          onSearchChange={setSearch}
          onPriorityChange={setPriority}
          onOverdueOnlyChange={setOverdueOnly}
          onAlertsOnlyChange={setAlertsOnly}
          onStatusChange={setStatus}
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
            onItemsChange={() => {
              if (isSupabaseMode) setSupabaseRefreshKey((current) => current + 1)
            }}
            onDetails={(item) => setModal({ open: true, mode: 'edit', item })}
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
                        <td className="px-3 py-2">{item.requestCode ?? (item.caseId ? caseById.get(item.caseId)?.treatmentCode : undefined) ?? '-'}</td>
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
                      <th className="px-3 py-2 font-semibold">Entregue (Inf/Sup)</th>
                      <th className="px-3 py-2 font-semibold">Restante (Inf/Sup)</th>
                      <th className="px-3 py-2 font-semibold">Data instalação</th>
                      <th className="px-3 py-2 font-semibold">Previsão reposição LAB</th>
                      <th className="px-3 py-2 font-semibold">Status do pedido</th>
                      <th className="px-3 py-2 font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remainingBankItems.map((item) => {
                      const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
                      const totals = getCaseTotalsByArch(caseItem)
                      const delivered = getDeliveredByArch(caseItem)
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
                          <td className="px-3 py-2">{item.requestCode ?? '-'}</td>
                          <td className="px-3 py-2">{item.patientName}</td>
                          <td className="px-3 py-2">{PRODUCT_TYPE_LABEL[item.productType ?? 'alinhador_12m']}</td>
                          <td className="px-3 py-2">{`${totals.lower}/${totals.upper}`}</td>
                          <td className="px-3 py-2">{`${delivered.lower}/${delivered.upper}`}</td>
                          <td className="px-3 py-2">{`${remaining.lower}/${remaining.upper}`}</td>
                          <td className="px-3 py-2">{installationDate ? formatDate(installationDate) : '-'}</td>
                          <td className="px-3 py-2">{replenishmentLabDate ? formatDate(replenishmentLabDate) : '-'}</td>
                          <td className="px-3 py-2">{treatmentStatus}</td>
                          <td className="px-3 py-2">
                            {canWrite && !isSupabaseMode && item.caseId ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setAdvanceTarget(item)
                                  setAdvanceUpperQty(String(Math.max(1, item.plannedUpperQty ?? 0)))
                                  setAdvanceLowerQty(String(Math.max(1, item.plannedLowerQty ?? 0)))
                                  setAdvanceModalOpen(true)
                                }}
                              >
                                Gerar OS antecipada
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
        allowDelete={canDeleteLab}
      />
      <RegisterDeliveryLotModal
        open={deliveryOpen}
        caseOptions={deliveryCaseOptions}
        selectedCaseId={deliveryCaseId}
        isSelectedRework={selectedDeliveryIsRework}
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
            if (!selectedReadyItem.caseId) {
              if (isSupabaseMode) {
                if (!supabase) {
                  addToast({ type: 'error', title: 'Entrega de lote', message: 'Supabase nao configurado.' })
                  return
                }
                const { data: current, error: readError } = await supabase
                  .from('lab_items')
                  .select('id, data, notes')
                  .eq('id', selectedReadyItem.id)
                  .maybeSingle()
                if (readError || !current) {
                  addToast({ type: 'error', title: 'Entrega de lote', message: readError?.message ?? 'OS nao encontrada.' })
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
                  addToast({ type: 'error', title: 'Entrega de lote', message: error.message })
                  return
                }
                setSupabaseItems((currentItems) => currentItems.filter((item) => item.id !== selectedReadyItem.id))
                setSupabaseRefreshKey((current) => current + 1)
                setDeliveryOpen(false)
                setDeliveryCaseId('')
                addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
                return
              }
              const result = updateLabItem(selectedReadyItem.id, {
                deliveredToProfessionalAt: payload.deliveredToDoctorAt,
                notes: payload.note ?? selectedReadyItem.notes,
              })
              if (result.error) {
                addToast({ type: 'error', title: 'Entrega de lote', message: result.error })
                return
              }
              setDeliveryOpen(false)
              setDeliveryCaseId('')
              addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
              return
            }
            const selectedCaseId = selectedReadyItem.caseId
            const caseItem = caseById.get(selectedCaseId)
            if (!caseItem) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Pedido nao encontrado.' })
              return
            }
            const caseTotals = getCaseTotalsByArch(caseItem)
            const selectedIsRework = isReworkItem(selectedReadyItem) || isReworkProductionItem(selectedReadyItem)
            const upperQty = Math.max(0, Math.trunc(payload.upperQty))
            const lowerQty = Math.max(0, Math.trunc(payload.lowerQty))
            if (!selectedIsRework && upperQty + lowerQty <= 0) {
              addToast({ type: 'error', title: 'Entrega de lote', message: 'Informe quantidade superior e/ou inferior.' })
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

            if (isSupabaseMode) {
              if (!supabase) {
                addToast({ type: 'error', title: 'Entrega de lote', message: 'Supabase nao configurado.' })
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
              const allDelivered = nextTrays.length > 0 && nextTrays.every((item) => item.state === 'entregue')
              const nextStatus = allDelivered ? 'finalizado' : 'em_entrega'
              const nextPhase = allDelivered ? 'finalizado' : 'em_producao'
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
                  addToast({ type: 'error', title: 'Entrega de lote', message: result.error })
                  return
                }
              }
            }

            setDeliveryOpen(false)
            setDeliveryCaseId('')
            addToast({ type: 'success', title: 'Entrega registrada pelo laboratorio' })
          })()
        }}
      />


      {productionConfirm.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-lg">
            <h3 className="text-lg font-semibold text-slate-900">Confirmar inicio da producao</h3>
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
            <h3 className="text-lg font-semibold text-slate-900">Gerar OS antecipada</h3>
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
                  const result = createAdvanceLabOrder(advanceTarget.id, {
                    plannedUpperQty: Number(advanceUpperQty),
                    plannedLowerQty: Number(advanceLowerQty),
                  })
                  if (!result.ok) {
                    addToast({ type: 'error', title: 'OS antecipada', message: result.error })
                    return
                  }
                  if (!result.sync.ok) {
                    addToast({ type: 'error', title: 'OS antecipada', message: result.sync.message })
                    return
                  }
                  setAdvanceModalOpen(false)
                  setAdvanceTarget(null)
                  addToast({ type: 'success', title: 'OS antecipada gerada' })
                }}
              >
                Gerar
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



