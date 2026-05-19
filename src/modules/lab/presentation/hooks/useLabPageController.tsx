import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../../../../app/ToastProvider'
import { can } from '../../../../auth/permissions'
import { loadExcelJS } from '../../../../lib/loadExcelJS'
import { getCurrentUser } from '../../../../lib/auth'
import { loadSystemSettings } from '../../../../lib/systemSettings'
import { useDb } from '../../../../lib/useDb'
import { useSupabaseSyncTick } from '../../../../lib/useSupabaseSyncTick'
import type { Case } from '../../../../types/Case'
import type { ProductType } from '../../../../types/Product'
import type { LabOverview, RegisterLabOrderInput } from '../../application/ports/LabRepository'
import { RegisterLabOrderUseCase, RegisterShipmentUseCase, UpdateLabStageUseCase } from '../../application/useCases'
import { createLabRepository } from '../../infra'
import type { LabOrder } from '../../domain/entities/LabOrder'
import {
  ProductionQueueService,
  LabPatientReportService,
  getInitialDeliveryQuantities,
  getCasesWithReplenishmentAlerts,
  getPipelineOrders,
  getQueueKpis,
  getReadyDeliveryOrders,
  getRemainingBankOrders,
  getReplenishmentAlertSummaries,
} from '../../domain'
import { formatFriendlyRequestCode, getGuideKindForLabOrder, getGuideReprintLabel, isReworkItem, isReworkProductionItem, resolveLabProductLabel, archLabel } from '../lib/labPresentation'

type ModalState =
  | { open: false; mode: 'create' | 'edit'; item: null }
  | { open: true; mode: 'create'; item: null }
  | { open: true; mode: 'edit'; item: LabOrder }

type ProductionConfirmState = {
  open: boolean
  productLabel: string
  archLabel: string
  resolver: ((confirmed: boolean) => void) | null
}

type LabCaseOption = LabOverview['cases'][number]
type LabPatientOption = LabOverview['patientOptions'][number]

export function useLabPageController() {
  const [searchParams] = useSearchParams()
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'lab.write')
  const canDeleteLab = currentUser?.role === 'master_admin'
  const canAiLab = false
  const repository = useMemo(() => createLabRepository(currentUser), [currentUser])
  const registerLabOrder = useMemo(() => new RegisterLabOrderUseCase(repository, currentUser), [currentUser, repository])
  const updateLabStage = useMemo(() => new UpdateLabStageUseCase(repository, currentUser), [currentUser, repository])
  const registerShipment = useMemo(() => new RegisterShipmentUseCase(repository, currentUser), [currentUser, repository])
  const [overview, setOverview] = useState<LabOverview>({
    items: [],
    cases: [],
    patientOptions: [],
    dentists: [],
    clinics: [],
    casePrintFallbackByCaseId: {},
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'todos' | 'urgente' | 'medio' | 'baixo'>('todos')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [status, setStatus] = useState<'todos' | LabOrder['status']>('todos')
  const [originFilter, setOriginFilter] = useState<'todos' | 'interno' | 'externo'>('todos')
  const [boardTab, setBoardTab] = useState<'esteira' | 'reconfeccao' | 'banco_restante'>('esteira')
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create', item: null })
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [deliveryCaseId, setDeliveryCaseId] = useState('')
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false)
  const [advanceTarget, setAdvanceTarget] = useState<LabOrder | null>(null)
  const [advanceUpperQty, setAdvanceUpperQty] = useState('1')
  const [advanceLowerQty, setAdvanceLowerQty] = useState('1')
  const [productionConfirm, setProductionConfirm] = useState<ProductionConfirmState>({
    open: false,
    productLabel: '',
    archLabel: '',
    resolver: null,
  })
  const [preferredBrotherPrinter, setPreferredBrotherPrinter] = useState('')
  const setAiModalOpen = (_open: boolean) => {}
  const setAiModalTitle = (_title: string) => {}
  const setAiDraft = (_draft: string) => {}
  const setAiAlerts = (_updater: string[] | ((current: string[]) => string[])) => {}
  const runAiRequest = async (_endpoint: string, _payload: unknown) => ({ ok: false as const, error: 'IA desativada no modo enxuto.', output: '' })
  const [exportingPatientReport, setExportingPatientReport] = useState(false)
  const supabaseSyncTick = useSupabaseSyncTick()
  const guideAutomationLeadDays = Math.max(0, Math.trunc(loadSystemSettings().guideAutomation?.leadDays ?? 10))
  const labSyncSignature = `${db.cases.map((item) => item.updatedAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}`

  const refreshOverview = useCallback(async () => {
    setLoading(true)
    const result = await repository.loadOverview()
    if (!result.ok) {
      addToast({ type: 'error', title: 'Laboratório', message: result.error })
      setLoading(false)
      return
    }
    setOverview(result.data)
    setLoading(false)
  }, [addToast, repository])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview, supabaseSyncTick, labSyncSignature])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'esteira' || tab === 'reconfeccao' || tab === 'banco_restante') {
      setBoardTab(tab)
    }
  }, [searchParams])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('orthoscan.lab.brother_printer_name') ?? ''
    setPreferredBrotherPrinter(saved)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const normalized = preferredBrotherPrinter.trim()
    if (!normalized) {
      window.localStorage.removeItem('orthoscan.lab.brother_printer_name')
      return
    }
    window.localStorage.setItem('orthoscan.lab.brother_printer_name', normalized)
  }, [preferredBrotherPrinter])

  const caseById = useMemo(
    () => new Map<string, Case>(overview.cases.map((item): [string, Case] => [item.id, item])),
    [overview.cases],
  )
  const patientOptionById = useMemo(
    () =>
      new Map<string, LabPatientOption>(
        overview.patientOptions.map((item): [string, LabPatientOption] => [item.id, item]),
      ),
    [overview.patientOptions],
  )
  const clinicLookupById = useMemo(
    () => new Map<string, { id: string; tradeName: string }>(overview.clinics.map((item): [string, { id: string; tradeName: string }] => [item.id, { id: item.id, tradeName: item.tradeName }])),
    [overview.clinics],
  )
  const scansById = useMemo(
    () =>
      new Map<string, { purposeLabel?: string; purposeProductId?: string; purposeProductType?: ProductType }>(
        db.scans.map((scan): [string, { purposeLabel?: string; purposeProductId?: string; purposeProductType?: ProductType }] => [
          scan.id,
          {
            purposeLabel: scan.purposeLabel,
            purposeProductId: scan.purposeProductId,
            purposeProductType: scan.purposeProductType as ProductType | undefined,
          },
        ]),
      ),
    [db.scans],
  )

  const resolveOrderProductLabel = useCallback(
    (item: LabOrder, caseItemOverride?: LabCaseOption) =>
      resolveLabProductLabel(item, { caseById, scansById }, caseItemOverride),
    [caseById, scansById],
  )

  const casesWithAlerts = useMemo(() => getCasesWithReplenishmentAlerts(overview.cases), [overview.cases])
  const alertSummaries = useMemo(() => getReplenishmentAlertSummaries(overview.cases), [overview.cases])
  const filteredItems = useMemo(
    () =>
      ProductionQueueService.filter(overview.items, {
        search,
        priority,
        overdueOnly,
        alertsOnly,
        status,
        origin: originFilter,
      }, {
        caseById,
        patientOptionsById: patientOptionById,
        clinicById: clinicLookupById,
        casesWithAlerts,
      }),
    [alertsOnly, caseById, casesWithAlerts, clinicLookupById, originFilter, overdueOnly, overview.items, patientOptionById, priority, search, status],
  )
  const pipelineItems = useMemo(() => getPipelineOrders(filteredItems, caseById), [caseById, filteredItems])
  const reworkItems = useMemo(() => filteredItems.filter((item) => isReworkItem(item)), [filteredItems])
  const remainingBankItems = useMemo(
    () => getRemainingBankOrders(filteredItems, caseById, (item) => ProductionQueueService.isDeliveredToProfessional(item, caseById)),
    [caseById, filteredItems],
  )
  const kpis = useMemo(() => getQueueKpis(pipelineItems), [pipelineItems])
  const readyDeliveryItems = useMemo(() => getReadyDeliveryOrders(overview.items, caseById), [caseById, overview.items])
  const deliveryCaseOptions = useMemo(
    () =>
      readyDeliveryItems.map((item) => ({
        id: item.id,
        label: `${item.patientName} (${formatFriendlyRequestCode(item.requestCode)})${item.caseId ? '' : ' - Avulsa'}${isReworkItem(item) || isReworkProductionItem(item) ? ` - Reconfecção placa #${item.trayNumber}` : ''}`,
      })),
    [readyDeliveryItems],
  )
  const selectedDeliveryItem = useMemo(() => readyDeliveryItems.find((item) => item.id === deliveryCaseId), [deliveryCaseId, readyDeliveryItems])
  const selectedDeliveryCase = useMemo(() => (selectedDeliveryItem?.caseId ? caseById.get(selectedDeliveryItem.caseId) : undefined), [caseById, selectedDeliveryItem])
  const selectedDeliveryProductLabel = useMemo(
    () => (selectedDeliveryItem ? resolveOrderProductLabel(selectedDeliveryItem, selectedDeliveryCase) : ''),
    [resolveOrderProductLabel, selectedDeliveryCase, selectedDeliveryItem],
  )
  const selectedDeliveryIsRework = Boolean(selectedDeliveryItem && (isReworkItem(selectedDeliveryItem) || isReworkProductionItem(selectedDeliveryItem)))
  const selectedDeliveryRequiresArchQuantities = Boolean(
    selectedDeliveryItem &&
    resolveOrderProductLabel(selectedDeliveryItem, selectedDeliveryCase).toLowerCase().includes('alinhador'),
  )
  const initialDeliveryQuantities = getInitialDeliveryQuantities(selectedDeliveryItem)
  const aiClinicId = ''

  const askProductionConfirmation = useCallback((productLabel: string, currentArchLabel: string) => (
    new Promise<boolean>((resolve) => {
      setProductionConfirm({
        open: true,
        productLabel,
        archLabel: currentArchLabel,
        resolver: resolve,
      })
    })
  ), [])

  const resolveProductionConfirmation = useCallback((confirmed: boolean) => {
    setProductionConfirm((current) => {
      current.resolver?.(confirmed)
      return { open: false, productLabel: '', archLabel: '', resolver: null }
    })
  }, [])

  const printHtml = useCallback((title: string, html: string) => {
    const popup = window.open('', '_blank')
    if (!popup) {
      addToast({ type: 'error', title, message: 'Não foi possível abrir a janela de impressão.' })
      return
    }
    popup.document.write(html)
    popup.document.close()
    setTimeout(() => {
      popup.focus()
      popup.print()
    }, 120)
  }, [addToast])

  const printSticker = useCallback((item: LabOrder) => {
    printHtml(
      'Etiqueta do laboratório',
      `<!doctype html><html><head><meta charset="utf-8" /><title>Etiqueta</title></head><body style="font-family:Arial;padding:24px"><h2>${item.patientName}</h2><p>${resolveOrderProductLabel(item)}</p><p>Placa #${item.trayNumber}</p><p>${item.requestCode ?? item.id}</p></body></html>`,
    )
  }, [printHtml, resolveOrderProductLabel])

  const printGuide = useCallback((item: LabOrder, mode: 'initial' | 'replenishment' | 'delivery_receipt') => {
    const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
    const title =
      mode === 'delivery_receipt'
        ? 'Comprovante de entrega ao dentista'
        : mode === 'replenishment'
          ? 'Guia de reposição'
          : 'Ordem de serviço'
    printHtml(
      title,
      `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:Arial;padding:32px"><h1>${title}</h1><p><strong>Paciente:</strong> ${item.patientName}</p><p><strong>OS:</strong> ${item.requestCode ?? item.id}</p><p><strong>Produto:</strong> ${resolveOrderProductLabel(item, caseItem)}</p><p><strong>Placa:</strong> #${item.trayNumber}</p><p><strong>Prazo:</strong> ${item.dueDate}</p></body></html>`,
    )
  }, [caseById, printHtml, resolveOrderProductLabel])

  const handleCreate = useCallback(async (payload: RegisterLabOrderInput) => {
    if (!canWrite) return { ok: false, message: 'Sem permissão para criar solicitações.' }
    const result = await registerLabOrder.execute(payload)
    if (!result.ok) return { ok: false, message: result.error }
    await refreshOverview()
    setModal({ open: false, mode: 'create', item: null })
    return { ok: true }
  }, [canWrite, refreshOverview, registerLabOrder])

  const handleSave = useCallback(async (id: string, patch: Partial<LabOrder>) => {
    if (!canWrite) return { ok: false, message: 'Sem permissão para editar solicitações.' }
    const result = await repository.updateOrder(id, patch)
    if (!result.ok) return { ok: false, message: result.error }
    await refreshOverview()
    setModal({ open: false, mode: 'create', item: null })
    return { ok: true }
  }, [canWrite, refreshOverview, repository])

  const handleDelete = useCallback((id: string) => {
    if (!canWrite || !canDeleteLab) return
    if (!window.confirm('Confirma excluir esta OS? O evento será registrado no histórico do paciente.')) return
    void (async () => {
      const result = await repository.deleteOrder(id)
      if (!result.ok) {
        addToast({ type: 'error', title: 'Exclusão', message: result.error })
        return
      }
      setModal({ open: false, mode: 'create', item: null })
      addToast({ type: 'info', title: 'Solicitacao removida' })
      await refreshOverview()
    })()
  }, [addToast, canDeleteLab, canWrite, refreshOverview, repository])

  const handleMoveStatus = useCallback(async (id: string, nextStage: LabOrder['status']) => {
    const current = overview.items.find((item) => item.id === id)
    if (!current) return { ok: false as const, error: 'Item LAB não encontrado.' }
    if (nextStage === 'em_producao') {
      const confirmed = await askProductionConfirmation(resolveOrderProductLabel(current), archLabel(current.arch))
      if (!confirmed) {
        return { ok: false as const, error: 'Produção cancelada pelo usuário.' }
      }
    }
    const result = await updateLabStage.execute({ id, nextStage })
    if (!result.ok) return { ok: false as const, error: result.error }
    await refreshOverview()
    return { ok: true as const }
  }, [askProductionConfirmation, overview.items, refreshOverview, resolveOrderProductLabel, updateLabStage])

  const handleAdvanceRequest = useCallback((item: LabOrder) => {
    const caseItem = item.caseId ? caseById.get(item.caseId) : undefined
    const totals = caseItem ? caseItem.totalTraysUpper ?? caseItem.totalTrays : 0
    setAdvanceUpperQty(String(item.arch === 'inferior' ? 0 : totals))
    setAdvanceLowerQty(String(item.arch === 'superior' ? 0 : (caseItem?.totalTraysLower ?? caseItem?.totalTrays ?? 0)))
    setAdvanceTarget(item)
    setAdvanceModalOpen(true)
  }, [caseById])

  const handleAdvanceConfirm = useCallback(() => {
    if (!advanceTarget) return
    void (async () => {
      const result = await repository.createAdvanceOrder({
        sourceLabItemId: advanceTarget.id,
        plannedUpperQty: Number(advanceUpperQty),
        plannedLowerQty: Number(advanceLowerQty),
      })
      if (!result.ok) {
        addToast({ type: 'error', title: 'Solicitacao de reposição', message: result.error })
        return
      }
      setAdvanceModalOpen(false)
      setAdvanceTarget(null)
      addToast({ type: 'success', title: 'Guia gerada na esteira de aguardando iniciar' })
      await refreshOverview()
    })()
  }, [addToast, advanceLowerQty, advanceTarget, advanceUpperQty, refreshOverview, repository])

  const handleRegisterShipment = useCallback((payload: { upperQty: number; lowerQty: number; deliveredToDoctorAt: string; note?: string; forcePrint?: boolean }) => {
    if (!canWrite) return
    if (!selectedDeliveryItem) {
      addToast({ type: 'error', title: 'Entrega de lote', message: 'Selecione uma OS pronta valida.' })
      return
    }
    void (async () => {
      const result = await registerShipment.execute({
        labOrderId: selectedDeliveryItem.id,
        deliveredToDoctorAt: payload.deliveredToDoctorAt,
        note: payload.note,
        upperQty: payload.upperQty,
        lowerQty: payload.lowerQty,
      })
      if (!result.ok) {
        addToast({ type: 'error', title: 'Entrega de lote', message: result.error })
        return
      }
      setDeliveryOpen(false)
      setDeliveryCaseId('')
      addToast({ type: 'success', title: 'Entrega registrada pelo laboratório' })
      printGuide(selectedDeliveryItem, 'delivery_receipt')
      await refreshOverview()
    })()
  }, [addToast, canWrite, printGuide, refreshOverview, registerShipment, selectedDeliveryItem])

  const handleConfigureBrotherPrinter = useCallback(() => {
    const suggested = preferredBrotherPrinter.trim() || 'Brother QL-810W'
    const typed = window.prompt('Nome da impressora Brother (como aparece no Windows):', suggested)
    if (typed === null) return
    const normalized = typed.trim()
    setPreferredBrotherPrinter(normalized)
    addToast({
      type: 'success',
      title: 'Impressora de adesivo',
      message: normalized ? `Impressora vinculada: ${normalized}` : 'Vinculo removido. O navegador usara a impressora padrão.',
    })
  }, [addToast, preferredBrotherPrinter])

  const handleExportPatientReport = useCallback(async () => {
    if (exportingPatientReport) return
    if (overview.cases.length === 0) {
      addToast({ type: 'error', title: 'Relatório', message: 'Nenhum caso disponível para exportação.' })
      return
    }

    setExportingPatientReport(true)
    try {
      const ExcelJS = await loadExcelJS()
      const dentistsById = new Map(overview.dentists.map((item) => [item.id, { name: item.name }]))
      const rows = LabPatientReportService.buildRows({
        cases: overview.cases,
        labOrders: overview.items,
        dentistsById,
        guideAutomationLeadDays,
      })

      if (rows.length === 0) {
        addToast({ type: 'error', title: 'Relatório', message: 'Nenhum paciente encontrado para o relatório.' })
        return
      }

      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('Pacientes LAB')
      worksheet.columns = [
        { header: 'Número do caso', key: 'caseNumber', width: 18 },
        { header: 'Nome do paciente', key: 'patientName', width: 34 },
        { header: 'Nome do dentista', key: 'dentistName', width: 30 },
        { header: 'Tratamento', key: 'treatment', width: 22 },
        { header: 'Dias de troca', key: 'changeDays', width: 14 },
        { header: 'Status', key: 'status', width: 24 },
        { header: 'Interno/externo', key: 'treatmentOrigin', width: 16 },
        { header: 'Placas entregues ao dentista', key: 'deliveredToDentist', width: 24 },
      { header: 'Data da última troca do paciente', key: 'lastPatientChangeDate', width: 24 },
        { header: 'Data prevista de reposição', key: 'predictedReplacementDate', width: 22 },
        { header: 'Data limite para entregar reposição', key: 'replacementDeliveryDeadline', width: 26 },
      ]

      rows.forEach((row) => {
        worksheet.addRow(row)
      })

      const header = worksheet.getRow(1)
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5D84' } }
      header.alignment = { vertical: 'middle', horizontal: 'center' }
      worksheet.autoFilter = {
        from: 'A1',
        to: 'K1',
      }
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]

      const content = await workbook.xlsx.writeBuffer()
      const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `relatorio_pacientes_lab_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)

      addToast({ type: 'success', title: 'Relatório gerado', message: `${rows.length} paciente(s) exportados.` })
    } catch (error) {
      console.error(error)
      addToast({ type: 'error', title: 'Relatório', message: 'Falha ao gerar a planilha de pacientes.' })
    } finally {
      setExportingPatientReport(false)
    }
  }, [addToast, exportingPatientReport, guideAutomationLeadDays, overview.cases, overview.dentists, overview.items])

  const runLabAi = useCallback(async (endpoint: '/lab/auditoria-solicitacao' | '/lab/previsao-entrega', title: string) => {
    if (!canAiLab || !aiClinicId) return
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
      inputText: `Itens de laboratório ativos: ${pipelineItems.length}. Reconfecções: ${reworkItems.length}. Prontos: ${readyDeliveryItems.length}.`,
      metadata: {
        highlighted,
        overdue: pipelineItems.filter((item) => ProductionQueueService.isOverdue(item)).length,
      },
    })
    if (!result.ok) {
      addToast({ type: 'error', title: 'IA Laboratório', message: result.error })
      return
    }
    setAiModalTitle(title)
    setAiDraft(result.output)
    setAiModalOpen(true)
    setAiAlerts((current) => [result.output, ...current].slice(0, 10))
  }, [addToast, aiClinicId, canAiLab, pipelineItems, readyDeliveryItems.length, reworkItems.length])

  return {
    loading,
    overview,
    currentUser,
    canWrite,
    canDeleteLab,
    search,
    priority,
    overdueOnly,
    alertsOnly,
    status,
    originFilter,
    boardTab,
    modal,
    deliveryOpen,
    deliveryCaseId,
    advanceModalOpen,
    advanceTarget,
    advanceUpperQty,
    advanceLowerQty,
    productionConfirm,
    preferredBrotherPrinter,
    exportingPatientReport,
    guideAutomationLeadDays,
    caseById,
    patientOptions: overview.patientOptions,
    cases: overview.cases,
    pipelineItems,
    reworkItems,
    remainingBankItems,
    kpis,
    alertSummaries,
    readyDeliveryItems,
    deliveryCaseOptions,
    selectedDeliveryItem,
    selectedDeliveryCase,
    selectedDeliveryIsRework,
    selectedDeliveryRequiresArchQuantities,
    selectedDeliveryProductLabel,
    deliveryInitialUpperQty: initialDeliveryQuantities.upper,
    deliveryInitialLowerQty: initialDeliveryQuantities.lower,
    resolveOrderProductLabel,
    setSearch,
    setPriority,
    setOverdueOnly,
    setAlertsOnly,
    setStatus,
    setOriginFilter,
    setBoardTab,
    setModal,
    setDeliveryOpen,
    setDeliveryCaseId,
    setAdvanceModalOpen,
    setAdvanceUpperQty,
    setAdvanceLowerQty,
    resolveProductionConfirmation,
    handleCreate,
    handleSave,
    handleDelete,
    handleMoveStatus,
    handleAdvanceRequest,
    handleAdvanceConfirm,
    handleRegisterShipment,
    handleConfigureBrotherPrinter,
    handleExportPatientReport,
    handlePrintSticker: printSticker,
    handleReprintGuide: (item: LabOrder) => printGuide(item, getGuideKindForLabOrder(item)),
    handleRunAudit: () => void runLabAi('/lab/auditoria-solicitacao', 'Auditar solicitação'),
    handleRunForecast: () => void runLabAi('/lab/previsao-entrega', 'Prever próxima entrega'),
    getGuideReprintLabel,
    refreshOverview,
  }
}
