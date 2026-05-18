import {
  addAttachment,
  clearCaseScanFileError,
  deleteCase,
  getCase,
  markCaseScanFileError,
  registerCaseInstallation,
  setTrayState as setCaseTrayState,
  updateCase,
} from '../../../../data/caseRepo'
import { generateLabOrder } from '../../../../data/labRepo'
import { ensureReplacementBankForCase } from '../../../../data/replacementBankRepo'
import { buildActualChangeDateMap, buildAlignerWhatsappHref, recalculateTrayDueDates } from '../../../../lib/alignerChange'
import { createSignedUrl } from '../../../../repo/storageRepo'
import {
  deleteCaseSupabase,
  generateCaseLabOrderSupabase,
  patchCaseDataSupabase,
} from '../../../../repo/profileRepo'
import { formatPtBrDateTime, nowIsoDateTime } from '../../../../shared/utils/date'
import type { Case, CaseTray, TrayState } from '../../../../types/Case'
import type { LabItem } from '../../../../types/Lab'
import { CaseLifecycleService } from '../../domain'
import { printCaseLabOrder } from '../lib/caseLabPrint'
import { parseBrlCurrencyInput } from '../lib/caseDetailPresentation'

type UseCaseDetailActionsArgs = {
  currentCase: Case | null
  currentUser: { name?: string; email?: string } | null
  isSupabaseMode: boolean
  canWrite: boolean
  canWriteLocalOnly: boolean
  canManageTray: boolean
  canDeleteCase: boolean
  hasProductionOrder: boolean
  hasDentistDelivery: boolean
  hasUpperArch: boolean
  hasLowerArch: boolean
  totalUpper: number
  totalLower: number
  todayIso: string
  budgetValue: string
  budgetNotes: string
  contractNotes: string
  attachmentType: 'imagem' | 'documento' | 'outro'
  attachmentDate: string
  attachmentNote: string
  attachmentFile: File | null
  installationDate: string
  installationNote: string
  installationDeliveredUpper: string
  installationDeliveredLower: string
  changeEveryDaysInput: string
  trayState: TrayState
  trayNote: string
  reworkArch: 'superior' | 'inferior' | 'ambos'
  selectedTray: CaseTray | null
  linkedLabItems: LabItem[]
  readyToDeliverPatient: { upper: number; lower: number }
  deliveredToDentist: { upper: number; lower: number }
  changeSchedule: Array<{ trayNumber: number; changeDate: string }>
  nextReplacementDueDate?: string
  canConcludeTreatmentManually: boolean
  displayCaseCode: string
  clinicName?: string
  dentistLabel: string
  requesterLabel: string
  displayProductLabel: string
  patientBirthDate?: string
  patientDisplayName: string
  patientWhatsapp?: string
  currentContractApprovedAt?: string
  registerTrayRework: {
    execute: (input: { caseId: string; trayNumber: number; arch: 'superior' | 'inferior' | 'ambos'; reason: string }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  }
  updateCaseStatus: {
    execute: (input: { caseId: string; nextStatus: Case['status']; nextPhase?: Case['phase']; reason?: string }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  }
  addCaseNote: {
    execute: (input: { caseId: string; scope: 'planning' | 'budget' | 'contract' | 'installation' | 'tray' | 'general'; note: string; trayNumber?: number }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  }
  addToast: (payload: { type: 'success' | 'error' | 'info'; title: string; message?: string }) => void
  navigate: (to: string, options?: { replace?: boolean }) => void
  refreshSupabase: () => void
  setOptimisticTrays: (value: CaseTray[] | null) => void
  setOptimisticActualChangeDates: (value: NonNullable<Case['installation']>['actualChangeDates'] | null) => void
  setSelectedTray: (value: CaseTray | null) => void
  setAttachmentFile: (value: File | null) => void
  setAttachmentNote: (value: string) => void
  setAttachmentModalOpen: (value: boolean) => void
}

export function useCaseDetailActions(args: UseCaseDetailActionsArgs) {
  const recalculateFromTray = (
    trays: CaseTray[],
    payload: {
      startTrayNumber: number
      overrideDueDates?: Map<number, string>
      actualChangeDates?: NonNullable<Case['installation']>['actualChangeDates']
    },
  ) => {
    const installation = args.currentCase?.installation
    const actualDates = payload.actualChangeDates ?? installation?.actualChangeDates ?? []
    const nextInstallation = installation ? { ...installation, actualChangeDates: actualDates } : undefined
    return recalculateTrayDueDates({
      trays,
      changeEveryDays: args.currentCase?.changeEveryDays ?? args.changeEveryDaysInput ? Math.max(1, Math.trunc(Number(args.changeEveryDaysInput) || 1)) : 1,
      installedAt: installation?.installedAt,
      actualUpperByTray: buildActualChangeDateMap(nextInstallation, 'superior'),
      actualLowerByTray: buildActualChangeDateMap(nextInstallation, 'inferior'),
      startTrayNumber: payload.startTrayNumber,
      overrideDueDates: payload.overrideDueDates,
    })
  }

  const concludeTreatmentManually = () => {
    if (!args.canWrite || !args.currentCase) return
    if (!args.canConcludeTreatmentManually) {
      args.addToast({ type: 'error', title: 'Concluir tratamento', message: 'Ainda existem placas pendentes para entrega ao paciente.' })
      return
    }
    void (async () => {
      const result = await Promise.resolve(args.updateCaseStatus.execute({
        caseId: args.currentCase!.id,
        nextStatus: 'finalizado',
        nextPhase: 'finalizado',
        reason: 'Tratamento concluido manualmente.',
      }))
      if (!result.ok) {
        args.addToast({ type: 'error', title: 'Concluir tratamento', message: result.error })
        return
      }
      if (args.isSupabaseMode) args.refreshSupabase()
      args.addToast({ type: 'success', title: 'Tratamento concluido manualmente' })
    })()
  }

  const saveTrayChanges = () => {
    if (!args.canManageTray || !args.selectedTray || !args.currentCase) return
    void (async () => {
      const trayInCase = args.currentCase!.trays.find((item) => item.trayNumber === args.selectedTray!.trayNumber)
      if (!trayInCase) return
      if (args.trayState === 'rework' && trayInCase.state !== 'rework') {
        const reworkReason = args.trayNote.trim().length > 0 ? args.trayNote.trim() : `Reconfecção solicitada via linha do tempo da placa #${args.selectedTray!.trayNumber}.`
        const reworkResult = await args.registerTrayRework.execute({
          caseId: args.currentCase!.id,
          trayNumber: args.selectedTray!.trayNumber,
          arch: args.reworkArch,
          reason: reworkReason,
        })
        if (!reworkResult.ok) {
          args.addToast({ type: 'error', title: 'Reconfecção', message: reworkResult.error })
          return
        }
        if (args.isSupabaseMode) args.refreshSupabase()
        args.addToast({ type: 'success', title: 'OS de reconfecção geradas', message: 'Reconfecção e confecção adicionadas na esteira.' })
        args.setSelectedTray(null)
        return
      }

      if (args.isSupabaseMode) {
        const nextTrays = args.currentCase!.trays.map((item) =>
          item.trayNumber === args.selectedTray!.trayNumber
            ? { ...item, state: args.trayState, notes: args.trayNote.trim() || undefined }
            : item,
        )
        const result = await patchCaseDataSupabase(args.currentCase!.id, { trays: nextTrays })
        if (!result.ok) {
          args.addToast({ type: 'error', title: 'Placa', message: result.error })
          return
        }
        if (args.trayNote.trim()) {
          await Promise.resolve(args.addCaseNote.execute({
            caseId: args.currentCase!.id,
            scope: 'tray',
            trayNumber: args.selectedTray!.trayNumber,
            note: args.trayNote.trim(),
          }))
        }
        args.refreshSupabase()
        args.addToast({ type: 'success', title: 'Placa atualizada' })
        args.setSelectedTray(null)
        return
      }

      if (args.trayState !== trayInCase.state) {
        const stateResult = setCaseTrayState(args.currentCase!.id, args.selectedTray!.trayNumber, args.trayState)
        if (!stateResult.ok) {
          args.addToast({ type: 'error', title: 'Erro ao atualizar placa', message: stateResult.error })
          return
        }
      }

      const latestCase = (getCase(args.currentCase!.id) ?? args.currentCase)!
      const nextTrays = latestCase.trays.map((item) =>
        item.trayNumber === args.selectedTray!.trayNumber ? { ...item, notes: args.trayNote.trim() || undefined } : item,
      )
      updateCase(args.currentCase!.id, { trays: nextTrays })
      if (args.trayNote.trim()) {
        await Promise.resolve(args.addCaseNote.execute({
          caseId: args.currentCase!.id,
          scope: 'tray',
          trayNumber: args.selectedTray!.trayNumber,
          note: args.trayNote.trim(),
        }))
      }
      args.addToast({ type: 'success', title: 'Placa atualizada' })
      args.setSelectedTray(null)
    })()
  }

  const handleAttachmentSave = () => {
    if (!args.canWriteLocalOnly || !args.currentCase) return
    if (!args.attachmentFile) {
      args.addToast({ type: 'error', title: 'Anexos', message: 'Selecione um arquivo.' })
      return
    }
    const objectUrl = URL.createObjectURL(args.attachmentFile)
    const result = addAttachment(args.currentCase.id, {
      name: args.attachmentFile.name,
      type: args.attachmentType === 'imagem' ? 'foto' : args.attachmentType === 'documento' ? 'scan' : 'outro',
      url: objectUrl,
      mime: args.attachmentFile.type,
      size: args.attachmentFile.size,
      isLocal: true,
      status: 'ok',
      attachedAt: args.attachmentDate,
      note: args.attachmentNote.trim() || undefined,
    })
    if (!result.ok) {
      args.addToast({ type: 'error', title: 'Anexos', message: result.error })
      return
    }
    args.setAttachmentFile(null)
    args.setAttachmentNote('')
    args.setAttachmentModalOpen(false)
    args.addToast({ type: 'success', title: 'Anexo adicionado' })
  }

  const concludePlanning = () => {
    if (!args.canWrite || !args.currentCase) return
    void (async () => {
      const result = await Promise.resolve(args.updateCaseStatus.execute({
        caseId: args.currentCase!.id,
        nextStatus: 'planejamento',
        nextPhase: 'orçamento',
        reason: 'Planejamento concluido.',
      }))
      if (!result.ok) {
        args.addToast({ type: 'error', title: 'Planejamento', message: result.error })
        return
      }
      if (args.isSupabaseMode) args.refreshSupabase()
      args.addToast({ type: 'success', title: 'Planejamento concluido' })
    })()
  }

  const closeBudget = () => {
    if (!args.canWrite || !args.currentCase) return
    const parsed = parseBrlCurrencyInput(args.budgetValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      args.addToast({ type: 'error', title: 'Orçamento', message: 'Informe um valor válido para o orçamento.' })
      return
    }
    void (async () => {
      const budgetPatch = {
        budget: { value: parsed, notes: args.budgetNotes.trim() || undefined, createdAt: nowIsoDateTime() },
        contract: { ...(args.currentCase!.contract ?? { status: 'pendente' }), status: 'pendente' as const, notes: args.contractNotes.trim() || undefined },
      }
      if (args.isSupabaseMode) {
        const result = await patchCaseDataSupabase(args.currentCase!.id, budgetPatch)
        if (!result.ok) {
          args.addToast({ type: 'error', title: 'Orçamento', message: result.error })
          return
        }
      } else {
        updateCase(args.currentCase!.id, budgetPatch)
      }
      const statusResult = await Promise.resolve(args.updateCaseStatus.execute({
        caseId: args.currentCase!.id,
        nextStatus: 'planejamento',
        nextPhase: 'contrato_pendente',
        reason: 'Orçamento fechado.',
      }))
      if (!statusResult.ok) {
        args.addToast({ type: 'error', title: 'Orçamento', message: statusResult.error })
        return
      }
      if (args.budgetNotes.trim()) await Promise.resolve(args.addCaseNote.execute({ caseId: args.currentCase!.id, scope: 'budget', note: args.budgetNotes.trim() }))
      if (args.contractNotes.trim()) await Promise.resolve(args.addCaseNote.execute({ caseId: args.currentCase!.id, scope: 'contract', note: args.contractNotes.trim() }))
      if (args.isSupabaseMode) args.refreshSupabase()
      args.addToast({ type: 'success', title: 'Orçamento fechado' })
    })()
  }

  const approveContract = () => {
    if (!args.canWrite || !args.currentCase) return
    const approvedAt = nowIsoDateTime()
    void (async () => {
      const contractPatch = { contract: { status: 'aprovado' as const, approvedAt, notes: args.contractNotes.trim() || undefined } }
      if (args.isSupabaseMode) {
        const result = await patchCaseDataSupabase(args.currentCase!.id, contractPatch)
        if (!result.ok) {
          args.addToast({ type: 'error', title: 'Contrato', message: result.error })
          return
        }
      } else {
        updateCase(args.currentCase!.id, contractPatch)
      }
      const statusResult = await Promise.resolve(args.updateCaseStatus.execute({
        caseId: args.currentCase!.id,
        nextStatus: 'planejamento',
        nextPhase: 'contrato_aprovado',
        reason: 'Contrato aprovado.',
      }))
      if (!statusResult.ok) {
        args.addToast({ type: 'error', title: 'Contrato', message: statusResult.error })
        return
      }
      if (args.contractNotes.trim()) await Promise.resolve(args.addCaseNote.execute({ caseId: args.currentCase!.id, scope: 'contract', note: args.contractNotes.trim() }))
      if (!args.isSupabaseMode) ensureReplacementBankForCase(args.currentCase!.id)
      else args.refreshSupabase()
      args.addToast({ type: 'success', title: 'Contrato aprovado', message: `Aprovado em ${formatPtBrDateTime(approvedAt)}` })
    })()
  }

  const handleDeleteCase = () => {
    if (!args.canDeleteCase || !args.currentCase) return
    const confirmed = window.confirm('Confirma excluir este pedido? Esta ação remove itens LAB vinculados e registra no histórico do paciente.')
    if (!confirmed) return
    if (args.isSupabaseMode) {
      void (async () => {
        const result = await deleteCaseSupabase(args.currentCase!.id)
        if (!result.ok) {
          args.addToast({ type: 'error', title: 'Erro ao excluir pedido', message: result.error })
          return
        }
        args.addToast({ type: 'success', title: 'Pedido excluido' })
        args.navigate('/app/cases', { replace: true })
      })()
      return
    }
    const result = deleteCase(args.currentCase.id)
    if (!result.ok) {
      args.addToast({ type: 'error', title: 'Erro ao excluir pedido', message: result.error })
      return
    }
    args.addToast({ type: 'success', title: 'Pedido excluido' })
    args.navigate('/app/cases', { replace: true })
  }

  const createLabOrder = () => {
    if (!args.canWrite || !args.currentCase) return
    if (args.isSupabaseMode) {
      void (async () => {
        const result = await generateCaseLabOrderSupabase(args.currentCase!.id)
        if (!result.ok) {
          args.addToast({ type: 'error', title: 'Gerar OS', message: result.error })
          return
        }
        args.refreshSupabase()
        args.addToast({ type: 'success', title: 'OS do laboratório', message: result.alreadyExists ? 'A OS já existia para este pedido.' : 'OS gerada com sucesso.' })
        printLabOrder(true)
      })()
      return
    }
    const result = generateLabOrder(args.currentCase.id)
    if (!result.ok) {
      args.addToast({ type: 'error', title: 'Gerar OS', message: result.error })
      return
    }
    args.addToast({ type: 'success', title: 'OS do laboratório', message: result.alreadyExists ? 'A OS já existia para este pedido.' : 'OS gerada com sucesso.' })
    printLabOrder(true)
  }

  function printLabOrder(skipProductionCheck = false) {
    if (!args.currentCase) return
    if (!skipProductionCheck && !args.hasProductionOrder) {
      args.addToast({ type: 'error', title: 'Imprimir OS', message: 'Gere a OS do LAB antes de imprimir.' })
      return
    }
    try {
      const planLabel = args.hasUpperArch && args.hasLowerArch
        ? `Superior ${args.totalUpper} | Inferior ${args.totalLower}`
        : args.hasUpperArch
          ? `Superior ${args.totalUpper}`
          : args.hasLowerArch
            ? `Inferior ${args.totalLower}`
            : '-'
      const emittedByRaw = args.currentUser?.name || args.currentUser?.email || 'Sistema'
      const emittedBy = emittedByRaw.includes('@') ? emittedByRaw.split('@')[0] : emittedByRaw
      printCaseLabOrder({
        caseLabel: args.displayCaseCode,
        patientName: args.currentCase.patientName,
        patientBirthDateLabel: args.patientBirthDate ? new Date(`${args.patientBirthDate}T00:00:00`).toLocaleDateString('pt-BR') : '-',
        clinicName: args.clinicName,
        dentistLabel: args.dentistLabel,
        requesterLabel: args.requesterLabel,
        productLabel: args.displayProductLabel,
        planLabel,
        changeEveryDays: args.currentCase.changeEveryDays,
        deliveredToDentistUpperValue: args.hasUpperArch ? String(args.deliveredToDentist.upper) : '-',
        deliveredToDentistLowerValue: args.hasLowerArch ? String(args.deliveredToDentist.lower) : '-',
        deliveredToDentistUpperCaption: args.hasUpperArch ? `de ${args.totalUpper} planejadas` : 'Arcada não utilizada',
        deliveredToDentistLowerCaption: args.hasLowerArch ? `de ${args.totalLower} planejadas` : 'Arcada não utilizada',
        emittedBy,
        emitOrigin: window.location.origin,
        issueDate: new Date(),
      })
    } catch (error) {
      args.addToast({ type: 'error', title: 'Imprimir OS', message: error instanceof Error ? error.message : 'Não foi possível abrir a janela de impressão.' })
    }
  }

  return {
    concludeTreatmentManually,
    saveTrayChanges,
    handleAttachmentSave,
    concludePlanning,
    closeBudget,
    approveContract,
    handleDeleteCase,
    createLabOrder,
    printLabOrder,
    markCaseFileError: (fileId: string) => {
      if (!args.canWriteLocalOnly || !args.currentCase) return
      const reason = window.prompt('Motivo do erro no anexo:')
      if (!reason || !reason.trim()) return
      const result = markCaseScanFileError(args.currentCase.id, fileId, reason)
      if (!result.ok) {
        args.addToast({ type: 'error', title: 'Anexos', message: result.error })
        return
      }
      args.addToast({ type: 'info', title: 'Anexo marcado como erro' })
    },
    clearCaseFileError: (fileId: string) => {
      if (!args.canWriteLocalOnly || !args.currentCase) return
      const result = clearCaseScanFileError(args.currentCase.id, fileId)
      if (!result.ok) {
        args.addToast({ type: 'error', title: 'Anexos', message: result.error })
        return
      }
      args.addToast({ type: 'success', title: 'Erro removido do anexo' })
    },
    saveInstallation: () => {
      if (!args.canWrite || !args.currentCase) return
      const upperCount = args.hasUpperArch ? Number(args.installationDeliveredUpper) : 0
      const lowerCount = args.hasLowerArch ? Number(args.installationDeliveredLower) : 0
      if (!Number.isFinite(upperCount) || !Number.isFinite(lowerCount) || upperCount < 0 || lowerCount < 0) {
        args.addToast({ type: 'error', title: 'Instalação', message: 'Informe quantidades válidas por arcada.' })
        return
      }
      if (args.hasUpperArch && Math.trunc(upperCount) > args.readyToDeliverPatient.upper) {
        args.addToast({ type: 'error', title: 'Instalação', message: `Superior disponível para o paciente: ${args.readyToDeliverPatient.upper}.` })
        return
      }
      if (args.hasLowerArch && Math.trunc(lowerCount) > args.readyToDeliverPatient.lower) {
        args.addToast({ type: 'error', title: 'Instalação', message: `Inferior disponível para o paciente: ${args.readyToDeliverPatient.lower}.` })
        return
      }
      if (!args.currentCase.installation && Math.trunc(upperCount + lowerCount) <= 0) {
        args.addToast({ type: 'error', title: 'Instalação', message: 'Na primeira instalação, informe ao menos 1 alinhador entregue ao paciente.' })
        return
      }
      if (args.isSupabaseMode) {
        if (!args.hasProductionOrder) {
          args.addToast({ type: 'error', title: 'Instalação', message: 'A ordem de serviço do LAB ainda não foi gerada para este pedido.' })
          return
        }
        const currentInstallation = args.currentCase.installation
        const currentDeliveredUpper = currentInstallation?.deliveredUpper ?? 0
        const currentDeliveredLower = currentInstallation?.deliveredLower ?? 0
        const nextDeliveredUpper = Math.trunc(currentDeliveredUpper + upperCount)
        const nextDeliveredLower = Math.trunc(currentDeliveredLower + lowerCount)
        const currentPairDelivered = Math.max(0, Math.min(currentDeliveredUpper, currentDeliveredLower))
        const nextPairDelivered = Math.max(0, Math.min(nextDeliveredUpper, nextDeliveredLower))
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
            deliveredAt: args.installationDate,
            note: args.installationNote.trim() || undefined,
            createdAt: nowIsoDateTime(),
          })
        }
        const nextTrayAfterDelivery = args.hasUpperArch && args.hasLowerArch
          ? Math.max(0, Math.min(nextDeliveredUpper, nextDeliveredLower)) + 1
          : args.hasUpperArch
            ? Math.max(0, Math.trunc(nextDeliveredUpper)) + 1
            : Math.max(0, Math.trunc(nextDeliveredLower)) + 1
        const nextDueAfterDelivery = nextTrayAfterDelivery > 0
          ? args.changeSchedule.find((row) => row.trayNumber === nextTrayAfterDelivery)?.changeDate
          : undefined
        const nextStatus = CaseLifecycleService.deriveTreatmentStatus({
          installedAt: currentInstallation?.installedAt ?? args.installationDate,
          changeEveryDays: args.currentCase.changeEveryDays,
          totalUpper: args.totalUpper,
          totalLower: args.totalLower,
          deliveredUpper: nextDeliveredUpper,
          deliveredLower: nextDeliveredLower,
          todayIso: args.todayIso,
          nextDueDate: nextDueAfterDelivery,
        })
        void (async () => {
          const result = await patchCaseDataSupabase(
            args.currentCase!.id,
            {
              installation: {
                installedAt: currentInstallation?.installedAt ?? args.installationDate,
                note: args.installationNote.trim() || currentInstallation?.note,
                deliveredUpper: nextDeliveredUpper,
                deliveredLower: nextDeliveredLower,
                patientDeliveryLots,
                actualChangeDates: currentInstallation?.actualChangeDates,
                manualChangeCompletion: currentInstallation?.manualChangeCompletion,
              },
              status: nextStatus,
              phase: 'em_producao',
            },
            { status: nextStatus, phase: 'em_producao' },
          )
          if (!result.ok) {
            args.addToast({ type: 'error', title: 'Instalação', message: result.error })
            return
          }
          args.refreshSupabase()
          args.addToast({ type: 'success', title: 'Instalação registrada' })
        })()
        return
      }
      const result = registerCaseInstallation(args.currentCase.id, {
        installedAt: args.installationDate,
        note: args.installationNote.trim() || undefined,
        deliveredUpper: Math.trunc(upperCount),
        deliveredLower: Math.trunc(lowerCount),
      })
      if (!result.ok) {
        args.addToast({ type: 'error', title: 'Instalação', message: result.error })
        return
      }
      const nextDeliveredUpper = (args.currentCase.installation?.deliveredUpper ?? 0) + Math.trunc(upperCount)
      const nextDeliveredLower = (args.currentCase.installation?.deliveredLower ?? 0) + Math.trunc(lowerCount)
      const nextTrayAfterDelivery = args.hasUpperArch && args.hasLowerArch
        ? Math.max(0, Math.min(nextDeliveredUpper, nextDeliveredLower)) + 1
        : args.hasUpperArch
          ? Math.max(0, Math.trunc(nextDeliveredUpper)) + 1
          : Math.max(0, Math.trunc(nextDeliveredLower)) + 1
      const nextDueAfterDelivery = nextTrayAfterDelivery > 0
        ? args.changeSchedule.find((row) => row.trayNumber === nextTrayAfterDelivery)?.changeDate
        : undefined
      const nextStatus = CaseLifecycleService.deriveTreatmentStatus({
        installedAt: args.currentCase.installation?.installedAt ?? args.installationDate,
        changeEveryDays: args.currentCase.changeEveryDays,
        totalUpper: args.totalUpper,
        totalLower: args.totalLower,
        deliveredUpper: nextDeliveredUpper,
        deliveredLower: nextDeliveredLower,
        todayIso: args.todayIso,
        nextDueDate: nextDueAfterDelivery,
      })
      updateCase(args.currentCase.id, { status: nextStatus, phase: 'em_producao' })
      args.addToast({ type: 'success', title: 'Instalação registrada' })
    },
    saveActualChangeDate: (arch: 'superior' | 'inferior', trayNumber: number, changedAt: string) => {
      if (!args.canWrite || !args.currentCase) return
      if (!args.currentCase.installation) {
        args.addToast({ type: 'error', title: 'Troca real', message: 'Registre a instalação antes de ajustar a troca real.' })
        return
      }
      const nextActualDates = (args.currentCase.installation.actualChangeDates ?? []).filter(
        (entry) => !(entry.trayNumber === trayNumber && (!entry.arch || entry.arch === arch || entry.arch === 'ambos')),
      )
      if (changedAt) nextActualDates.push({ trayNumber, changedAt, arch })
      const nextTrays = recalculateFromTray(args.currentCase.trays, {
        startTrayNumber: trayNumber + 1,
        actualChangeDates: nextActualDates,
      })
      args.setOptimisticTrays(nextTrays)
      args.setOptimisticActualChangeDates(nextActualDates)
      if (args.isSupabaseMode) {
        void (async () => {
          const result = await patchCaseDataSupabase(args.currentCase!.id, {
            installation: { ...args.currentCase!.installation, actualChangeDates: nextActualDates },
            trays: nextTrays,
          })
          if (!result.ok) {
            args.setOptimisticTrays(null)
            args.setOptimisticActualChangeDates(null)
            args.addToast({ type: 'error', title: 'Troca real', message: result.error })
            return
          }
          args.refreshSupabase()
          args.addToast({ type: 'success', title: 'Troca real atualizada' })
        })()
        return
      }
      const updated = updateCase(args.currentCase.id, {
        installation: { ...args.currentCase.installation, actualChangeDates: nextActualDates },
        trays: nextTrays,
      })
      if (!updated) {
        args.setOptimisticTrays(null)
        args.setOptimisticActualChangeDates(null)
        args.addToast({ type: 'error', title: 'Troca real', message: 'Não foi possível atualizar a data real de troca.' })
        return
      }
      args.addToast({ type: 'success', title: 'Troca real atualizada' })
    },
    saveTrayDueDate: (trayNumber: number, dueDate: string) => {
      if (!args.canManageTray || !args.currentCase) return
      const normalizedDueDate = dueDate.trim()
      if (!normalizedDueDate) {
        args.addToast({ type: 'error', title: 'Troca prevista', message: 'Informe uma data válida para a previsão.' })
        return
      }
      const currentTray = args.currentCase.trays.find((item) => item.trayNumber === trayNumber)
      if (!currentTray) return
      const nextTrays = recalculateFromTray(args.currentCase.trays, {
        startTrayNumber: trayNumber,
        overrideDueDates: new Map([[trayNumber, normalizedDueDate]]),
      })
      args.setOptimisticTrays(nextTrays)
      if (args.isSupabaseMode) {
        void (async () => {
          const result = await patchCaseDataSupabase(args.currentCase!.id, { trays: nextTrays })
          if (!result.ok) {
            args.setOptimisticTrays(null)
            args.addToast({ type: 'error', title: 'Troca prevista', message: result.error })
            return
          }
          args.refreshSupabase()
          args.addToast({ type: 'success', title: 'Troca prevista atualizada' })
        })()
        return
      }
      const updated = updateCase(args.currentCase.id, { trays: nextTrays })
      if (!updated) {
        args.addToast({ type: 'error', title: 'Troca prevista', message: 'Não foi possível atualizar a data prevista.' })
        return
      }
      args.addToast({ type: 'success', title: 'Troca prevista atualizada' })
    },
    saveManualChangeCompletion: (arch: 'superior' | 'inferior', trayNumber: number, completed: boolean) => {
      if (!args.canWrite || !args.currentCase?.installation) return
      const nextCompletion = (args.currentCase.installation.manualChangeCompletion ?? []).filter(
        (entry) => !(entry.trayNumber === trayNumber && (!entry.arch || entry.arch === arch || entry.arch === 'ambos')),
      )
      nextCompletion.push({ trayNumber, completed, arch })
      if (args.isSupabaseMode) {
        void (async () => {
          const result = await patchCaseDataSupabase(args.currentCase!.id, {
            installation: { ...args.currentCase!.installation, manualChangeCompletion: nextCompletion },
          })
          if (!result.ok) {
            args.addToast({ type: 'error', title: 'Troca concluída', message: result.error })
            return
          }
          args.refreshSupabase()
        })()
        return
      }
      const updated = updateCase(args.currentCase.id, {
        installation: { ...args.currentCase.installation, manualChangeCompletion: nextCompletion },
      })
      if (!updated) args.addToast({ type: 'error', title: 'Troca concluída', message: 'Não foi possível atualizar o status manual.' })
    },
    saveChangeEveryDays: () => {
      if (!args.canWrite || !args.currentCase) return
      const parsed = Math.trunc(Number(args.changeEveryDaysInput))
      if (!Number.isFinite(parsed) || parsed <= 0) {
        args.addToast({ type: 'error', title: 'Troca', message: 'Informe um número de dias válido.' })
        return
      }
      if (parsed === args.currentCase.changeEveryDays) {
        args.addToast({ type: 'info', title: 'Troca', message: 'Sem alterações para salvar.' })
        return
      }
      if (args.isSupabaseMode) {
        void (async () => {
          const result = await patchCaseDataSupabase(args.currentCase!.id, { changeEveryDays: parsed })
          if (!result.ok) {
            args.addToast({ type: 'error', title: 'Troca', message: result.error })
            return
          }
          args.refreshSupabase()
          args.addToast({ type: 'success', title: 'Troca', message: 'Dias de troca atualizados.' })
        })()
        return
      }
      updateCase(args.currentCase.id, { changeEveryDays: parsed })
      args.addToast({ type: 'success', title: 'Troca', message: 'Dias de troca atualizados.' })
    },
    openScanFile: (item: NonNullable<Case['scanFiles']>[number]) => {
      void (async () => {
        if (item.filePath) {
          const signed = await createSignedUrl(item.filePath, 300)
          if (!signed.ok) {
            args.addToast({ type: 'error', title: 'Arquivos do exame', message: signed.error })
            return
          }
          window.open(signed.url, '_blank', 'noopener,noreferrer')
          return
        }
        if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer')
      })()
    },
    openWhatsappForTray: (payload: { upper?: number; lower?: number; changeDate: string }) => {
      const whatsappHref = buildAlignerWhatsappHref(
        args.patientWhatsapp,
        args.patientDisplayName || args.currentCase?.patientName || '',
        { upper: payload.upper, lower: payload.lower },
        payload.changeDate,
        args.todayIso,
      )
      if (whatsappHref) window.open(whatsappHref, '_blank', 'noopener,noreferrer')
    },
  }
}
