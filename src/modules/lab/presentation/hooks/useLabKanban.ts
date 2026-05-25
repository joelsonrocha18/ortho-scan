import { useCallback, useEffect, useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { LabSLAService } from '../../domain/services/LabSLAService'
import { subscribeToLabQueue, updateLabCaseStage, type LabCase } from '../../infra/firebaseLabRepository'
import type { LabOrder } from '../../domain/entities/LabOrder'

export type LabStage =
  | 'triagem'
  | 'setup'
  | 'impressao'
  | 'termoformagem'
  | 'acabamento'
  | 'expedicao'

export type KanbanCard = {
  caseId: string
  patientName: string
  dentistName: string
  currentStage: LabStage
  priority: 'normal' | 'urgent' | 'vip'
  dueDate: Timestamp
  slaStatus: 'on_time' | 'warning' | 'overdue'
  alignerCount: number
  assignedTechId?: string
}

function isLabStage(value: unknown): value is LabStage {
  return value === 'triagem' ||
    value === 'setup' ||
    value === 'impressao' ||
    value === 'termoformagem' ||
    value === 'acabamento' ||
    value === 'expedicao'
}

function normalizeSlaStatus(value: string): KanbanCard['slaStatus'] {
  if (value === 'overdue') return 'overdue'
  if (value === 'warning') return 'warning'
  return 'on_time'
}

function toKanbanCard(item: LabCase): KanbanCard | null {
  if (!item.dueDate || typeof item.dueDate !== 'object' || !('toDate' in item.dueDate) || typeof item.dueDate.toDate !== 'function') return null
  const dueDate = item.dueDate as Timestamp
  const currentStage = isLabStage(item.currentStage) ? item.currentStage : 'triagem'
  const priority = item.priority === 'vip' || item.priority === 'urgent' ? item.priority : 'normal'
  const alignerCount = Math.max(0, Math.trunc(item.alignerCount ?? 0))
  const sla = LabSLAService.evaluate({
    id: item.id,
    patientName: item.patientName ?? 'Paciente sem nome',
    status: currentStage === 'expedicao' ? 'prontas' : currentStage === 'triagem' ? 'aguardando_iniciar' : 'em_producao',
    arch: 'ambos',
    trayNumber: 1,
    plannedDate: new Date().toISOString().slice(0, 10),
    dueDate: dueDate.toDate().toISOString().slice(0, 10),
    priority: priority === 'urgent' || priority === 'vip' ? 'Urgente' : 'Medio',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies LabOrder)

  return {
    caseId: item.caseId ?? item.id,
    patientName: item.patientName ?? 'Paciente sem nome',
    dentistName: item.dentistName ?? 'Dentista nao informado',
    currentStage,
    priority,
    dueDate,
    slaStatus: normalizeSlaStatus(sla.status),
    alignerCount,
    assignedTechId: item.assignedTechId,
  }
}

export function useLabKanban(clinicId: string) {
  const [cases, setCases] = useState<KanbanCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId) {
      setCases([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const unsubscribe = subscribeToLabQueue(clinicId, (data) => {
      setCases(data.map(toKanbanCard).filter((item): item is KanbanCard => Boolean(item)))
      setLoading(false)
    })
    return () => unsubscribe()
  }, [clinicId])

  const moveCard = useCallback(async (caseId: string, newStage: LabStage) => {
    await updateLabCaseStage(caseId, newStage)
  }, [])

  return { cases, loading, moveCard }
}
