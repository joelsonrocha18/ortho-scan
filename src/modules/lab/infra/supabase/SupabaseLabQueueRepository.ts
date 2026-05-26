import { supabase } from '../../../../lib/supabaseClient'
import { logger } from '../../../../lib/logger'

export type LabQueueStage =
  | 'triagem'
  | 'setup'
  | 'impressao'
  | 'termoformagem'
  | 'acabamento'
  | 'expedicao'

export type LabCase = {
  id: string
  caseId?: string
  patientName?: string
  dentistName?: string
  currentStage?: LabQueueStage
  priority?: 'normal' | 'urgent' | 'vip'
  dueDate?: string
  alignerCount?: number
  assignedTechId?: string
}

type LabRow = Record<string, unknown>
type Unsubscribe = () => void

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeStage(value: unknown): LabQueueStage {
  const normalized = asText(value).trim().toLowerCase()
  if (
    normalized === 'triagem' ||
    normalized === 'setup' ||
    normalized === 'impressao' ||
    normalized === 'termoformagem' ||
    normalized === 'acabamento' ||
    normalized === 'expedicao'
  ) {
    return normalized
  }
  if (normalized === 'aguardando_iniciar') return 'triagem'
  if (normalized === 'em_producao') return 'setup'
  if (normalized === 'controle_qualidade') return 'acabamento'
  if (normalized === 'prontas') return 'expedicao'
  return 'triagem'
}

function normalizePriority(value: unknown): LabCase['priority'] {
  const normalized = asText(value).trim().toLowerCase()
  if (normalized === 'vip') return 'vip'
  if (normalized === 'urgent' || normalized === 'urgente') return 'urgent'
  return 'normal'
}

function normalizeDate(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return undefined
}

function isOpenLabRow(row: LabRow) {
  const data = asObject(row.data)
  const status = asText(row.status, asText(data.status)).trim().toLowerCase()
  return status !== 'completed' && status !== 'concluido' && status !== 'concluido' && status !== 'prontas'
}

function mapLabRow(row: LabRow): LabCase {
  const data = asObject(row.data)
  const plannedUpperQty = asNumber(data.plannedUpperQty)
  const plannedLowerQty = asNumber(data.plannedLowerQty)
  return {
    id: asText(row.id),
    caseId: asText(row.case_id, asText(data.caseId)) || undefined,
    patientName: asText(data.patientName, asText(row.patient_name)) || undefined,
    dentistName: asText(data.dentistName, asText(row.dentist_name)) || undefined,
    currentStage: normalizeStage(data.currentStage ?? data.stage ?? row.stage ?? row.status),
    priority: normalizePriority(row.priority ?? data.priority),
    dueDate: normalizeDate(data.dueDate ?? row.due_date ?? row.updated_at),
    alignerCount: asNumber(data.alignerCount, plannedUpperQty + plannedLowerQty),
    assignedTechId: asText(data.assignedTechId, asText(row.assigned_tech_id)) || undefined,
  }
}

export async function listLabQueue(clinicId: string): Promise<LabCase[]> {
  if (!supabase) {
    throw new Error('Supabase nao configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
  }
  const { data, error } = await supabase
    .from('lab_items')
    .select('id, clinic_id, case_id, patient_name, dentist_name, due_date, assigned_tech_id, stage, status, priority, updated_at, data')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
  if (error) throw error
  return ((data ?? []) as LabRow[])
    .filter(isOpenLabRow)
    .map(mapLabRow)
}

export function subscribeToLabQueue(
  clinicId: string,
  onUpdate: (cases: LabCase[]) => void,
): Unsubscribe {
  if (!supabase) {
    logger.error('Supabase nao configurado para assinar a fila do laboratorio.', { clinicId })
    onUpdate([])
    return () => undefined
  }

  const client = supabase
  let disposed = false
  const refresh = () => {
    void listLabQueue(clinicId)
      .then((cases) => {
        if (!disposed) onUpdate(cases)
      })
      .catch((error) => {
        logger.error('Falha ao atualizar fila LAB pelo Supabase.', { clinicId }, error)
        if (!disposed) onUpdate([])
      })
  }

  refresh()
  const channel = client
    .channel(`lab_queue:${clinicId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_items', filter: `clinic_id=eq.${clinicId}` }, refresh)
    .subscribe()

  return () => {
    disposed = true
    void client.removeChannel(channel)
  }
}

export async function updateLabCaseStage(caseId: string, newStage: LabQueueStage): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase nao configurado. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
  }
  const { data: current, error: readError } = await supabase
    .from('lab_items')
    .select('data')
    .eq('id', caseId)
    .maybeSingle()
  if (readError) throw readError

  const now = new Date().toISOString()
  const nextData = {
    ...asObject((current as LabRow | null)?.data),
    currentStage: newStage,
    stage: newStage,
    updatedAt: now,
  }
  const { error } = await supabase
    .from('lab_items')
    .update({
      stage: newStage,
      status: newStage,
      data: nextData,
      updated_at: now,
    })
    .eq('id', caseId)
  if (error) throw error
}
