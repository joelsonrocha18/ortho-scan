import { supabase } from '../lib/supabaseClient'
import type { CaseTray } from '../types/Case'
import type { LabItem } from '../types/Lab'
import type { ProductType } from '../types/Product'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import type { Scan, ScanAttachment } from '../types/Scan'
import { nextOrthTreatmentCode, normalizeOrthTreatmentCode } from '../lib/treatmentCode'

export type ProfileRecord = {
  user_id: string
  login_email?: string | null
  role: string
  clinic_id: string | null
  dentist_id: string | null
  full_name: string | null
  cpf: string | null
  phone: string | null
  onboarding_completed_at: string | null
  is_active: boolean
  deleted_at: string | null
  created_at?: string
  updated_at?: string
}

export async function getProfileByUserId(userId: string) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, login_email, role, clinic_id, dentist_id, full_name, cpf, phone, onboarding_completed_at, is_active, deleted_at, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return data as ProfileRecord | null
}

export async function listProfiles(options?: { includeDeleted?: boolean }) {
  if (!supabase) return []
  let query = supabase
    .from('profiles')
    .select('user_id, login_email, role, clinic_id, dentist_id, full_name, cpf, phone, onboarding_completed_at, is_active, deleted_at, created_at, updated_at')
  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null)
  }
  const { data, error } = await query
  if (error) return []
  return (data ?? []) as ProfileRecord[]
}

export async function setProfileActive(userId: string, isActive: boolean) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}

export async function softDeleteProfile(userId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { error } = await supabase
    .from('profiles')
    .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}

export async function restoreProfile(userId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { error } = await supabase
    .from('profiles')
    .update({ deleted_at: null, is_active: true, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<ProfileRecord, 'full_name' | 'cpf' | 'phone' | 'role' | 'clinic_id' | 'dentist_id' | 'is_active'>>,
) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
  if (error) return { ok: false as const, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false as const, error: 'Perfil não atualizado. Verifique permissoes para editar este usuário.' }
  }
  return { ok: true as const }
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

function asProductType(value: unknown, fallback: ProductType = 'alinhador_12m'): ProductType {
  return normalizeProductType(value, fallback)
}

function appendHistoryLine(base: string | null | undefined, line: string) {
  const now = new Date()
  const stamp = now.toLocaleString('pt-BR')
  const entry = `[${stamp}] ${line}`
  const previous = (base ?? '').trim()
  const merged = previous ? `${previous}\n${entry}` : entry
  return merged.slice(-8000)
}

async function appendPatientHistorySupabase(patientId: string | null | undefined, line: string) {
  if (!supabase || !patientId) return
  const { data, error } = await supabase
    .from('patients')
    .select('id, notes')
    .eq('id', patientId)
    .maybeSingle()
  if (error || !data) return
  const currentNotes = (data as Record<string, unknown>).notes as string | null | undefined
  const nextNotes = appendHistoryLine(currentNotes, line)
  await supabase
    .from('patients')
    .update({ notes: nextNotes, updated_at: new Date().toISOString() })
    .eq('id', patientId)
}

function normalizeScanAttachments(attachments: ScanAttachment[]) {
  const now = new Date().toISOString()
  return attachments.map((attachment) => ({
    ...attachment,
    status: attachment.status ?? 'ok',
    attachedAt: attachment.attachedAt ?? attachment.createdAt ?? now,
    createdAt: attachment.createdAt ?? now,
  }))
}

function buildPendingTrays(totalTrays: number, scanDate: string, changeEveryDays: number): CaseTray[] {
  const trays: CaseTray[] = []
  const base = new Date(`${scanDate}T00:00:00`)
  for (let tray = 1; tray <= totalTrays; tray += 1) {
    const due = new Date(base)
    due.setDate(due.getDate() + changeEveryDays * tray)
    trays.push({ trayNumber: tray, state: 'pendente', dueDate: due.toISOString().slice(0, 10) })
  }
  return trays
}

function nextExamCode() {
  const stamp = Date.now().toString().slice(-6)
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `EXM-${stamp}${rand}`
}

async function nextTreatmentCodeSupabase() {
  if (!supabase) return ''
  const [casesRes, scansRes] = await Promise.all([
    supabase.from('cases').select('data').is('deleted_at', null),
    supabase.from('scans').select('data').is('deleted_at', null),
  ])
  const collected: string[] = []
  ;(casesRes.data ?? []).forEach((row) => {
    const data = asObject((row as Record<string, unknown>).data)
    const code = normalizeOrthTreatmentCode(asText(data.treatmentCode))
    if (code) collected.push(code)
  })
  ;(scansRes.data ?? []).forEach((row) => {
    const data = asObject((row as Record<string, unknown>).data)
    const code = normalizeOrthTreatmentCode(asText(data.serviceOrderCode))
    if (code) collected.push(code)
  })
  return nextOrthTreatmentCode(collected)
}

async function inferTreatmentOriginSupabase(clinicId?: string | null): Promise<'interno' | 'externo'> {
  if (!clinicId) return 'externo'
  const normalizedId = clinicId.trim().toLowerCase()
  if (normalizedId === 'clinic_arrimo') return 'interno'
  if (!supabase) return 'externo'
  const { data } = await supabase
    .from('clinics')
    .select('id, short_id, trade_name')
    .eq('id', clinicId)
    .maybeSingle()
  const shortId = asText((data as Record<string, unknown> | null)?.short_id).trim().toUpperCase()
  const tradeName = asText((data as Record<string, unknown> | null)?.trade_name).trim().toUpperCase()
  if (shortId === 'CLI-0001' || tradeName === 'ARRIMO') return 'interno'
  return 'externo'
}

export async function createScanSupabase(scan: Omit<Scan, 'id' | 'createdAt' | 'updatedAt'>) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const now = new Date().toISOString()
  const attachments = normalizeScanAttachments(scan.attachments)
  let resolvedClinicId = scan.clinicId ?? null

  if (!resolvedClinicId && scan.patientId) {
    const { data: patientRow } = await supabase
      .from('patients')
      .select('clinic_id')
      .eq('id', scan.patientId)
      .maybeSingle()
    resolvedClinicId = (patientRow as { clinic_id?: string | null } | null)?.clinic_id ?? null
  }

  if (!resolvedClinicId && scan.dentistId) {
    const { data: dentistRow } = await supabase
      .from('dentists')
      .select('clinic_id')
      .eq('id', scan.dentistId)
      .maybeSingle()
    resolvedClinicId = (dentistRow as { clinic_id?: string | null } | null)?.clinic_id ?? null
  }

  if (!resolvedClinicId) {
    return { ok: false as const, error: 'Selecione uma clinica valida antes de salvar o exame.' }
  }
  const shortId = scan.shortId ?? nextExamCode()
  const serviceOrderCode = normalizeOrthTreatmentCode(scan.serviceOrderCode) || (await nextTreatmentCodeSupabase())

  const { data, error } = await supabase
    .from('scans')
    .insert({
      clinic_id: resolvedClinicId,
      patient_id: scan.patientId ?? null,
      dentist_id: scan.dentistId ?? null,
      requested_by_dentist_id: scan.requestedByDentistId ?? null,
      arch: scan.arch,
      complaint: scan.complaint ?? null,
      dentist_guidance: scan.dentistGuidance ?? null,
      data: {
        patientName: scan.patientName,
        shortId,
        serviceOrderCode,
        purposeProductId: scan.purposeProductId,
        purposeProductType: scan.purposeProductType,
        purposeLabel: scan.purposeLabel,
        scanDate: scan.scanDate,
        arch: scan.arch,
        complaint: scan.complaint,
        dentistGuidance: scan.dentistGuidance,
        notes: scan.notes,
        planningDetectedUpperTrays: scan.planningDetectedUpperTrays,
        planningDetectedLowerTrays: scan.planningDetectedLowerTrays,
        planningDetectedAt: scan.planningDetectedAt,
        planningDetectedSource: scan.planningDetectedSource,
        attachments,
        status: scan.status ?? 'pendente',
        linkedCaseId: scan.linkedCaseId,
        createdAt: now,
        updatedAt: now,
      },
      updated_at: now,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false as const, error: error.message }
  if (!data?.id) return { ok: false as const, error: 'Scan não criado. Verifique permissoes.' }
  return { ok: true as const, id: data.id as string }
}

export async function createCaseFromScanSupabase(
  scan: Scan,
  payload: {
    totalTraysUpper?: number
    totalTraysLower?: number
    changeEveryDays: number
    attachmentBondingTray: boolean
    planningNote?: string
  },
) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  if (scan.status !== 'aprovado') return { ok: false as const, error: 'Apenas scans aprovados podem gerar caso.' }
  if (scan.linkedCaseId) return { ok: false as const, error: 'Este scan ja foi convertido em caso.' }
  const selectedProductType = asProductType(scan.purposeProductType ?? scan.purposeProductId)
  const isAlignerFlow = isAlignerProductType(selectedProductType)
  const upper = payload.totalTraysUpper ?? 0
  const lower = payload.totalTraysLower ?? 0
  const normalizedUpper = isAlignerFlow ? (scan.arch === 'inferior' ? 0 : upper) : 0
  const normalizedLower = isAlignerFlow ? (scan.arch === 'superior' ? 0 : lower) : 0
  const totalTrays = Math.max(normalizedUpper, normalizedLower)
  if (isAlignerFlow && totalTrays <= 0) return { ok: false as const, error: 'Informe total de placas superior e/ou inferior.' }

  const now = new Date().toISOString()
  const treatmentCode = normalizeOrthTreatmentCode(scan.serviceOrderCode) || (await nextTreatmentCodeSupabase())
  const treatmentOrigin = await inferTreatmentOriginSupabase(scan.clinicId ?? null)
  const status = 'planejamento'
  const phase = 'planejamento'
  const nextData = {
    productType: selectedProductType as ProductType,
    productId: selectedProductType as ProductType,
    requestedProductId: scan.purposeProductId,
    requestedProductLabel: scan.purposeLabel,
    treatmentCode,
    treatmentOrigin,
    patientName: scan.patientName,
    scanDate: scan.scanDate,
    totalTrays: isAlignerFlow ? totalTrays : 0,
    totalTraysUpper: normalizedUpper || undefined,
    totalTraysLower: normalizedLower || undefined,
    changeEveryDays: isAlignerFlow ? payload.changeEveryDays : 0,
    attachmentBondingTray: isAlignerFlow ? payload.attachmentBondingTray : false,
    planningNote: payload.planningNote,
    status,
    phase,
    budget: undefined,
    contract: { status: 'pendente' as const },
    deliveryLots: [],
    installation: undefined,
    trays: isAlignerFlow ? buildPendingTrays(totalTrays, scan.scanDate, payload.changeEveryDays) : [],
    attachments: [],
    sourceScanId: scan.id,
    sourceExamCode: scan.shortId,
    arch: scan.arch,
    complaint: scan.complaint,
    dentistGuidance: scan.dentistGuidance,
    scanFiles: normalizeScanAttachments(scan.attachments),
    createdAt: now,
    updatedAt: now,
  }

  const { data: created, error: createError } = await supabase
    .from('cases')
    .insert({
      clinic_id: scan.clinicId ?? null,
      patient_id: scan.patientId ?? null,
      dentist_id: scan.dentistId ?? null,
      requested_by_dentist_id: scan.requestedByDentistId ?? null,
      scan_id: scan.id,
      status,
      change_every_days: isAlignerFlow ? payload.changeEveryDays : 0,
      total_trays_upper: isAlignerFlow ? (normalizedUpper || null) : null,
      total_trays_lower: isAlignerFlow ? (normalizedLower || null) : null,
      attachments_tray: isAlignerFlow ? payload.attachmentBondingTray : false,
      product_type: selectedProductType,
      product_id: selectedProductType,
      data: nextData,
      updated_at: now,
    })
    .select('id')
    .maybeSingle()
  if (createError) return { ok: false as const, error: createError.message }
  if (!created?.id) return { ok: false as const, error: 'Caso não criado. Verifique permissoes.' }

  const scanDataNext = {
    patientName: scan.patientName,
    serviceOrderCode: treatmentCode,
    purposeProductId: scan.purposeProductId,
    purposeProductType: scan.purposeProductType,
    purposeLabel: scan.purposeLabel,
    scanDate: scan.scanDate,
    arch: scan.arch,
    complaint: scan.complaint,
    dentistGuidance: scan.dentistGuidance,
    notes: scan.notes,
    planningDetectedUpperTrays: scan.planningDetectedUpperTrays,
    planningDetectedLowerTrays: scan.planningDetectedLowerTrays,
    planningDetectedAt: scan.planningDetectedAt,
    planningDetectedSource: scan.planningDetectedSource,
    attachments: normalizeScanAttachments(scan.attachments),
    status: 'convertido',
    linkedCaseId: created.id,
    createdAt: scan.createdAt,
    updatedAt: now,
  }
  const { error: scanUpdateError } = await supabase
    .from('scans')
    .update({ data: scanDataNext, updated_at: now })
    .eq('id', scan.id)
  if (scanUpdateError) return { ok: false as const, error: scanUpdateError.message }

  return { ok: true as const, caseId: created.id as string }
}

export async function patchCaseDataSupabase(
  caseId: string,
  patch: Record<string, unknown>,
  options?: { status?: string; phase?: string },
) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const now = new Date().toISOString()
  const { data: current, error: readError } = await supabase
    .from('cases')
    .select('id, status, data')
    .eq('id', caseId)
    .maybeSingle()
  if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Caso não encontrado.' }

  const currentData = asObject(current.data)
  const nextStatus = options?.status ?? asText(currentData.status, asText(current.status, 'planejamento'))
  const nextPhase = options?.phase ?? asText(currentData.phase, 'planejamento')
  const nextData = {
    ...currentData,
    ...patch,
    status: nextStatus,
    phase: nextPhase,
    updatedAt: now,
  }

  const { data, error } = await supabase
    .from('cases')
    .update({
      data: nextData,
      status: nextStatus,
      updated_at: now,
    })
    .eq('id', caseId)
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!data || data.length === 0) return { ok: false as const, error: 'Caso não atualizado. Verifique permissoes.' }
  return { ok: true as const }
}

export async function listCaseLabItemsSupabase(caseId: string): Promise<LabItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('lab_items')
    .select('id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, deleted_at, data')
    .eq('case_id', caseId)
    .is('deleted_at', null)
  if (error) return []

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const meta = asObject(row.data)
    const createdAt = asText(row.created_at, new Date().toISOString())
    const updatedAt = asText(row.updated_at, createdAt)
    return {
      id: asText(row.id),
      requestCode: asText(meta.requestCode) || undefined,
      productType: asProductType(row.product_type ?? row.product_id ?? meta.productType ?? meta.productId),
      productId: asProductType(row.product_id ?? row.product_type ?? meta.productId ?? meta.productType),
      requestedProductId: asText(meta.requestedProductId) || undefined,
      requestedProductLabel: asText(meta.requestedProductLabel) || undefined,
      requestKind: asText(meta.requestKind, 'producao') as LabItem['requestKind'],
      expectedReplacementDate: asText(meta.expectedReplacementDate) || undefined,
      caseId: asText(row.case_id) || undefined,
      arch: asText(meta.arch, 'ambos') as LabItem['arch'],
      plannedUpperQty: asNumber(meta.plannedUpperQty, 0),
      plannedLowerQty: asNumber(meta.plannedLowerQty, 0),
      planningDefinedAt: asText(meta.planningDefinedAt) || undefined,
      trayNumber: asNumber(row.tray_number, asNumber(meta.trayNumber, 1)),
      patientName: asText(meta.patientName, '-'),
      plannedDate: asText(meta.plannedDate, createdAt.slice(0, 10)),
      dueDate: asText(meta.dueDate, createdAt.slice(0, 10)),
      status: asText(row.status, 'aguardando_iniciar') as LabItem['status'],
      priority: asText(row.priority, 'Medio') as LabItem['priority'],
      notes: asText(row.notes, asText(meta.notes)) || undefined,
      createdAt,
      updatedAt,
    } satisfies LabItem
  })
}

export async function generateCaseLabOrderSupabase(caseId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data: current, error: readError } = await supabase
    .from('cases')
    .select('id, clinic_id, patient_id, status, data')
    .eq('id', caseId)
    .maybeSingle()
  if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Caso não encontrado.' }

  const currentData = asObject(current.data)
  const contract = asObject(currentData.contract)
  if (asText(contract.status, 'pendente') !== 'aprovado') {
    return { ok: false as const, error: 'Contrato não aprovado. Não e possível gerar OS para o laboratorio.' }
  }

  const existingItems = await listCaseLabItemsSupabase(caseId)
  const existing = existingItems.find((item) => (item.requestKind ?? 'producao') === 'producao')
  if (existing) return { ok: true as const, alreadyExists: true as const }

  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const due = new Date(`${today}T00:00:00`)
  due.setDate(due.getDate() + 7)
  const dueDate = due.toISOString().slice(0, 10)

  const requestCode = asText(currentData.treatmentCode, asText(current.id))
  const productType = asProductType(currentData.productType ?? currentData.productId)
  const { error: createError } = await supabase
    .from('lab_items')
    .insert({
      case_id: caseId,
      clinic_id: current.clinic_id ?? null,
      tray_number: 1,
      status: 'aguardando_iniciar',
      priority: 'Medio',
      notes: 'OS gerada a partir do fluxo comercial do caso. Defina quantidade por arcada antes de produzir.',
      product_type: productType,
      product_id: productType,
      data: {
        requestCode,
        productType,
        productId: productType,
        requestedProductId: asText(currentData.requestedProductId) || undefined,
        requestedProductLabel: asText(currentData.requestedProductLabel) || undefined,
        requestKind: 'producao',
        expectedReplacementDate: dueDate,
        arch: asText(currentData.arch, 'ambos'),
        patientName: asText(currentData.patientName, '-'),
        trayNumber: 1,
        plannedDate: today,
        dueDate,
        plannedUpperQty: 0,
        plannedLowerQty: 0,
      },
      updated_at: now,
    })
  if (createError) return { ok: false as const, error: createError.message }
  return { ok: true as const, alreadyExists: false as const }
}

export async function updateScanStatusSupabase(scanId: string, status: 'aprovado' | 'reprovado') {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data: current, error: readError } = await supabase
    .from('scans')
    .select('id, data')
    .eq('id', scanId)
    .maybeSingle()
  if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Scan não encontrado.' }
  const nextData = { ...asObject(current.data), status }
  const { data, error } = await supabase
    .from('scans')
    .update({ data: nextData, updated_at: new Date().toISOString() })
    .eq('id', scanId)
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!data || data.length === 0) return { ok: false as const, error: 'Scan não atualizado. Verifique permissoes.' }
  return { ok: true as const }
}

export async function deleteScanSupabase(scanId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data: current } = await supabase
    .from('scans')
    .select('id, patient_id, data')
    .eq('id', scanId)
    .maybeSingle()
  const currentData = asObject((current as Record<string, unknown> | null)?.data)
  const patientId = asText((current as Record<string, unknown> | null)?.patient_id, asText(currentData.patientId)) || undefined
  const patientName = asText(currentData.patientName, '-')
  const scanDate = asText(currentData.scanDate)
  const linkedCaseIdFromScan = asText(currentData.linkedCaseId)
  const now = new Date().toISOString()

  const caseIds = new Set<string>()
  if (linkedCaseIdFromScan) caseIds.add(linkedCaseIdFromScan)
  const { data: casesByScan } = await supabase
    .from('cases')
    .select('id')
    .eq('scan_id', scanId)
    .is('deleted_at', null)
  ;(casesByScan ?? []).forEach((row) => {
    const id = asText((row as Record<string, unknown>).id)
    if (id) caseIds.add(id)
  })

  if (caseIds.size > 0) {
    const ids = Array.from(caseIds)
    await supabase
      .from('lab_items')
      .update({ deleted_at: now, updated_at: now })
      .in('case_id', ids)
      .is('deleted_at', null)

    await supabase
      .from('cases')
      .update({ deleted_at: now, updated_at: now })
      .in('id', ids)
      .is('deleted_at', null)

    // Tabela opcional no banco; se não existir, apenas ignora.
    const replacementDelete = await supabase
      .from('replacement_bank')
      .delete()
      .in('case_id', ids)
    if (replacementDelete.error) {
      // no-op
    }
  }

  const { data, error } = await supabase
    .from('scans')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', scanId)
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!data || data.length === 0) return { ok: false as const, error: 'Scan não excluido. Verifique permissoes.' }
  await appendPatientHistorySupabase(
    patientId,
    caseIds.size > 0
      ? `Exame excluido pelo administrador com cascata (${caseIds.size} pedido(s), OS e reposicoes). Paciente: ${patientName}. Data do exame: ${scanDate || '-'}.`
      : `Exame excluido pelo administrador. Paciente: ${patientName}. Data do exame: ${scanDate || '-'}.`,
  )
  return { ok: true as const }
}

export async function deleteCaseSupabase(caseId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data: current, error: readError } = await supabase
    .from('cases')
    .select('id, patient_id, data')
    .eq('id', caseId)
    .maybeSingle()
  if (readError || !current) return { ok: false as const, error: readError?.message ?? 'Caso não encontrado.' }

  const currentData = asObject((current as Record<string, unknown>).data)
  const patientId = asText((current as Record<string, unknown>).patient_id, asText(currentData.patientId)) || undefined
  const treatmentCode = asText(currentData.treatmentCode, caseId)
  const patientName = asText(currentData.patientName, '-')
  const now = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('cases')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', caseId)
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!updated || updated.length === 0) return { ok: false as const, error: 'Caso não excluido. Verifique permissoes.' }

  await supabase
    .from('lab_items')
    .update({ deleted_at: now, updated_at: now })
    .eq('case_id', caseId)
    .is('deleted_at', null)
  const linkedScans = await supabase
    .from('scans')
    .select('id, data')
    .eq('data->>linkedCaseId', caseId)
    .is('deleted_at', null)
  if (!linkedScans.error) {
    for (const row of linkedScans.data ?? []) {
      const scanData = asObject((row as Record<string, unknown>).data)
      const nextScanData = {
        ...scanData,
        linkedCaseId: undefined,
        status: scanData.status === 'convertido' ? 'aprovado' : scanData.status,
        updatedAt: now,
      }
      await supabase
        .from('scans')
        .update({ data: nextScanData, updated_at: now })
        .eq('id', asText((row as Record<string, unknown>).id))
    }
  }

  const replacementDelete = await supabase
    .from('replacement_bank')
    .delete()
    .eq('case_id', caseId)
  if (replacementDelete.error) {
    // no-op
  }

  await appendPatientHistorySupabase(
    patientId,
    `Pedido ${treatmentCode} excluido pelo administrador, incluindo OS vinculadas. Paciente: ${patientName}.`,
  )
  return { ok: true as const }
}

export async function deleteLabItemSupabase(labItemId: string) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const { data: current, error: readError } = await supabase
    .from('lab_items')
    .select('id, case_id, tray_number, data')
    .eq('id', labItemId)
    .maybeSingle()
  if (readError || !current) return { ok: false as const, error: readError?.message ?? 'OS não encontrada.' }

  const meta = asObject((current as Record<string, unknown>).data)
  const caseId = asText((current as Record<string, unknown>).case_id) || undefined
  const trayNumber = asNumber((current as Record<string, unknown>).tray_number, asNumber(meta.trayNumber, 1))
  let patientId: string | undefined
  let patientName = asText(meta.patientName, '-')
  if (caseId) {
    const { data: linkedCase } = await supabase
      .from('cases')
      .select('id, patient_id, data')
      .eq('id', caseId)
      .maybeSingle()
    if (linkedCase) {
      const caseData = asObject((linkedCase as Record<string, unknown>).data)
      patientId = asText((linkedCase as Record<string, unknown>).patient_id, asText(caseData.patientId)) || undefined
      patientName = asText(caseData.patientName, patientName)
    }
  }

  const now = new Date().toISOString()
  const { data: updated, error } = await supabase
    .from('lab_items')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', labItemId)
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!updated || updated.length === 0) return { ok: false as const, error: 'OS não excluida. Verifique permissoes.' }

  await appendPatientHistorySupabase(
    patientId,
    `OS de laboratorio excluida pelo administrador (placa #${trayNumber}) para ${patientName}.`,
  )
  return { ok: true as const }
}

export async function inviteUser(payload: {
  email: string
  role: string
  clinicId: string
  dentistId?: string
  fullName?: string
  password?: string
  cpf?: string
  phone?: string
  accessToken: string
}) {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }
  const accessToken = payload.accessToken?.trim()
  if (!accessToken) return { ok: false as const, error: 'Sessao expirada. Saia e entre novamente.' }
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!anonKey) return { ok: false as const, error: 'Supabase anon key ausente no build.' }
  if (!supabaseUrl) return { ok: false as const, error: 'Supabase URL ausente no build.' }

  const requestBodyBase = {
    email: payload.email,
    role: payload.role,
    clinicId: payload.clinicId,
    dentistId: payload.dentistId,
    fullName: payload.fullName,
    password: payload.password,
    cpf: payload.cpf,
    phone: payload.phone,
  }
  const callInvite = async (token: string) => {
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${anonKey}`,
          'x-user-jwt': token,
          'Content-Type': 'application/json',
          apikey: anonKey,
        },
        body: JSON.stringify({ ...requestBodyBase, userJwt: token }),
      })
      const raw = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; code?: string; message?: string } | null
      return { response, raw, networkError: '' }
    } catch (error) {
      return {
        response: null,
        raw: null,
        networkError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let first = await callInvite(accessToken)
  if (!first.response) {
    return {
      ok: false as const,
      error: `Falha de rede/CORS ao chamar invite-user. Verifique ALLOWED_ORIGIN e tente novamente. Detalhe: ${first.networkError}`,
      code: 'network_error',
    }
  }
  const firstMessage = (first.raw?.error ?? first.raw?.message ?? '').toLowerCase()
  const shouldRetry =
    first.response.status === 401 ||
    first.response.status === 403 ||
    firstMessage.includes('invalid jwt')

  if (shouldRetry) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    const refreshedToken = refreshed.session?.access_token ?? ''
    if (!refreshError && refreshedToken) {
      first = await callInvite(refreshedToken)
    }
  }
  if (!first.response) {
    return {
      ok: false as const,
      error: `Falha de rede/CORS ao chamar invite-user. Verifique ALLOWED_ORIGIN e tente novamente. Detalhe: ${first.networkError}`,
      code: 'network_error',
    }
  }

  if (!first.response.ok || (first.raw && first.raw.ok === false)) {
    const normalizedMessage = (first.raw?.error ?? first.raw?.message ?? '').toLowerCase()
    const code = first.raw?.code
      ?? (normalizedMessage.includes('invalid jwt') ? 'unauthorized' : undefined)
      ?? (first.response.status === 401 ? 'unauthorized' : first.response.status === 403 ? 'forbidden' : 'invite_failed')
    const detailed = first.raw?.error ?? first.raw?.message ?? `Falha ao criar usuário (HTTP ${first.response.status}).`
    return { ok: false as const, error: detailed, code }
  }
  return { ok: true as const, data: first.raw }
}

export async function normalizeTreatmentIdsSupabase() {
  if (!supabase) return { ok: false as const, error: 'Supabase não configurado.' }

  const [scansRes, casesRes] = await Promise.all([
    supabase
      .from('scans')
      .select('id, created_at, data')
      .is('deleted_at', null),
    supabase
      .from('cases')
      .select('id, scan_id, created_at, data')
      .is('deleted_at', null),
  ])

  if (scansRes.error) return { ok: false as const, error: scansRes.error.message }
  if (casesRes.error) return { ok: false as const, error: casesRes.error.message }

  const scans = (scansRes.data ?? []) as Array<Record<string, unknown>>
  const cases = (casesRes.data ?? []) as Array<Record<string, unknown>>

  const linkedCaseByScanId = new Map<string, string>()
  const scanCreatedAt = new Map<string, string>()
  scans.forEach((row) => {
    const scanId = asText(row.id)
    const data = asObject(row.data)
    const linkedCaseId = asText(data.linkedCaseId)
    if (scanId) {
      scanCreatedAt.set(scanId, asText(row.created_at, new Date().toISOString()))
    }
    if (scanId && linkedCaseId) {
      linkedCaseByScanId.set(scanId, linkedCaseId)
    }
  })
  cases.forEach((row) => {
    const caseId = asText(row.id)
    const scanId = asText(row.scan_id)
    if (scanId && caseId) linkedCaseByScanId.set(scanId, caseId)
  })

  const sortedScanIds = [...scanCreatedAt.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id)

  const nextCodes: string[] = []
  const codeByScanId = new Map<string, string>()
  const codeByCaseId = new Map<string, string>()

  sortedScanIds.forEach((scanId) => {
    const code = nextOrthTreatmentCode(nextCodes)
    nextCodes.push(code)
    codeByScanId.set(scanId, code)
    const linkedCaseId = linkedCaseByScanId.get(scanId)
    if (linkedCaseId) codeByCaseId.set(linkedCaseId, code)
  })

  const caseRowsById = new Map<string, Record<string, unknown>>()
  cases.forEach((row) => caseRowsById.set(asText(row.id), row))

  const missingCases = cases
    .map((row) => asText(row.id))
    .filter((id) => id && !codeByCaseId.has(id))
    .map((id) => ({
      id,
      createdAt: asText(caseRowsById.get(id)?.created_at, new Date().toISOString()),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  missingCases.forEach((row) => {
    const code = nextOrthTreatmentCode(nextCodes)
    nextCodes.push(code)
    codeByCaseId.set(row.id, code)
  })

  let updatedScans = 0
  for (const row of scans) {
    const scanId = asText(row.id)
    if (!scanId) continue
    const currentData = asObject(row.data)
    const targetCode = codeByScanId.get(scanId) ?? normalizeOrthTreatmentCode(asText(currentData.serviceOrderCode))
    if (!targetCode) continue
    const currentCode = normalizeOrthTreatmentCode(asText(currentData.serviceOrderCode))
    if (currentCode === targetCode) continue
    const nextData = {
      ...currentData,
      serviceOrderCode: targetCode,
      updatedAt: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('scans')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('id', scanId)
    if (!error) updatedScans += 1
  }

  let updatedCases = 0
  for (const row of cases) {
    const caseId = asText(row.id)
    if (!caseId) continue
    const currentData = asObject(row.data)
    const targetCode = codeByCaseId.get(caseId)
    if (!targetCode) continue
    const currentCode = normalizeOrthTreatmentCode(asText(currentData.treatmentCode))
    if (currentCode === targetCode) continue
    const nextData = {
      ...currentData,
      treatmentCode: targetCode,
      updatedAt: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('cases')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('id', caseId)
    if (!error) updatedCases += 1
  }

  return {
    ok: true as const,
    updatedScans,
    updatedCases,
  }
}

