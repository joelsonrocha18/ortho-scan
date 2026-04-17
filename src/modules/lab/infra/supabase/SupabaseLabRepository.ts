import { supabase } from '../../../../lib/supabaseClient'
import { loadSystemSettings } from '../../../../lib/systemSettings'
import { ok, err, type Result } from '../../../../shared/errors'
import { BUSINESS_EVENTS, logger } from '../../../../shared/observability'
import { nowIsoDate, nowIsoDateTime, toIsoDate } from '../../../../shared/utils/date'
import { createEntityId } from '../../../../shared/utils/id'
import type { Case } from '../../../../types/Case'
import { isAlignerProductType, normalizeProductType } from '../../../../types/Product'
import type { User } from '../../../../types/User'
import type {
  CreateAdvanceLabOrderInput,
  LabOverview,
  LabPatientOption,
  LabRepository,
  RegisterLabOrderInput,
  RegisterReworkInput,
  RegisterReworkOutput,
  RegisterShipmentInput,
  RegisterShipmentOutput,
  UpdateLabOrderInput,
  UpdateLabStageInput,
} from '../../application/ports/LabRepository'
import type { LabOrder } from '../../domain/entities/LabOrder'
import {
  assertReadyToStartProduction,
  canTransitionLabOrderStage,
  createLabOrderDraft,
  hasProductionPlan,
  isReworkProductionOrder,
  requiresLabPlan,
  resolveAutomaticLabOrderStage,
  resolveLabOrderProductType,
  validatePlanForCase,
} from '../../domain/entities/LabOrder'
import { adjustInstallationForRework, removeTrayFromDeliveryLots } from '../../domain/services/ReworkCaseAdjustments'
import {
  asObject,
  asText,
  asNumber,
  buildCasePrintFallback,
  mapSupabaseCaseRow,
  mapSupabaseLabRow,
  nextRequestRevisionFromCodes,
} from './supabaseLabMappers'

function caseCode(caseItem: Pick<Case, 'treatmentCode' | 'id'>) {
  return caseItem.treatmentCode ?? caseItem.id
}

function normalizePatientOptions(
  patients: Array<Record<string, unknown>>,
  dentistsById: Map<string, string>,
  clinicsById: Map<string, string>,
) {
  return patients.map((row) => ({
    id: asText(row.id),
    shortId: undefined,
    name: asText(row.name, '-'),
    birthDate: asText(row.birth_date) || undefined,
    clinicId: asText(row.clinic_id) || undefined,
    dentistId: asText(row.primary_dentist_id) || undefined,
    clinicName: asText(row.clinic_id) ? clinicsById.get(asText(row.clinic_id)) : undefined,
    dentistName: asText(row.primary_dentist_id) ? dentistsById.get(asText(row.primary_dentist_id)) : undefined,
  })) satisfies LabPatientOption[]
}

function getGuideAutomationLeadDays() {
  try {
    const settings = loadSystemSettings()
    return {
      enabled: settings.guideAutomation?.enabled !== false,
      leadDays: Math.max(0, Math.trunc(settings.guideAutomation?.leadDays ?? 10)),
    }
  } catch {
    return { enabled: true, leadDays: 10 }
  }
}

export class SupabaseLabRepository implements LabRepository {
  private readonly currentUser: User | null

  constructor(currentUser: User | null) {
    this.currentUser = currentUser
  }

  private ensureClient() {
    if (!supabase) {
      return err('Supabase não configurado.')
    }
    return ok(supabase)
  }

  private async findCaseRow(caseId: string) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const { data, error } = await clientResult.data
      .from('cases')
      .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, scan_id, status, data, deleted_at')
      .eq('id', caseId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error || !data) return err(error?.message ?? 'Caso não encontrado.')
    return ok(data as Record<string, unknown>)
  }

  private async findOrderRow(id: string) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const { data, error } = await clientResult.data
      .from('lab_items')
      .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error || !data) return err(error?.message ?? 'Item LAB não encontrado.')
    return ok(data as Record<string, unknown>)
  }

  private async listCaseOrderCodes(caseId: string) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const { data, error } = await clientResult.data
      .from('lab_items')
      .select('id, data')
      .eq('case_id', caseId)
      .is('deleted_at', null)
    if (error) return err(error.message)
    const requestCodes = ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => asText(asObject(row.data).requestCode))
      .filter(Boolean)
    return ok(requestCodes)
  }

  private async ensureInitialReplenishmentSeed(
    source: {
      caseId?: string
      trayNumber: number
      status: LabOrder['status']
      productType?: LabOrder['productType']
      productId?: LabOrder['productId']
      priority?: LabOrder['priority']
      data: Record<string, unknown>
    },
  ) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data
    if (!source.caseId) return ok(null)
    if (asText(source.data.requestKind, 'producao') !== 'producao') return ok(null)
    if (source.status !== 'em_producao') return ok(null)

    const [caseRes, rowsRes] = await Promise.all([
      client.from('cases').select('id, clinic_id, data').eq('id', source.caseId).maybeSingle(),
      client.from('lab_items').select('id, tray_number, data').eq('case_id', source.caseId).is('deleted_at', null),
    ])
    if (caseRes.error || !caseRes.data) {
      return err(caseRes.error?.message ?? 'Caso vinculado não encontrado.')
    }
    if (rowsRes.error) {
      return err(rowsRes.error.message)
    }

    const caseData = asObject(caseRes.data.data)
    const caseRows = (rowsRes.data ?? []) as Array<Record<string, unknown>>
    const alreadySeeded = caseRows.some((row) => {
      const rowData = asObject(row.data)
      return (
        asText(rowData.requestKind, 'producao') === 'reposicao_programada' &&
        asNumber(row.tray_number, asNumber(rowData.trayNumber, -1)) === source.trayNumber
      )
    })
    if (alreadySeeded) return ok(null)

    const today = nowIsoDate()
    const trays = Array.isArray(caseData.trays) ? (caseData.trays as Array<Record<string, unknown>>) : []
    const trayFromCase = trays.find((tray) => asNumber(tray.trayNumber, -1) === source.trayNumber)
    const expectedReplacementDate = asText(
      trayFromCase?.dueDate,
      asText(source.data.expectedReplacementDate, asText(source.data.dueDate, today)),
    )
    const baseCode = asText(caseData.treatmentCode, asText(caseRes.data.id, source.caseId))
    const nextRevision = nextRequestRevisionFromCodes(
      baseCode,
      caseRows
        .map((row) => asText(asObject(row.data).requestCode))
        .filter(Boolean),
    )
    const nowIso = nowIsoDateTime()
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
      notes: `Reposição inicial gerada no início da confeccao da placa #${source.trayNumber}.`,
    }

    const { error } = await client.from('lab_items').insert({
      clinic_id: asText(source.data.clinicId, asText(caseRes.data.clinic_id)) || null,
      case_id: source.caseId,
      tray_number: source.trayNumber,
      status: 'aguardando_iniciar',
      priority: source.priority ?? (asText(source.data.priority, 'Medio') as LabOrder['priority']),
      notes: asText(seedData.notes) || null,
      product_type: resolvedProductType,
      product_id: resolvedProductType,
      data: seedData,
      updated_at: nowIso,
    })
    if (error) return err(error.message)
    return ok(null)
  }

  private async maybeInsertAutomatedReplenishments(cases: Case[], items: LabOrder[]) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const automation = getGuideAutomationLeadDays()
    if (!automation.enabled) return ok(false)

    const today = nowIsoDate()
    const requestCodes = items.map((item) => item.requestCode).filter((code): code is string => Boolean(code))
    const inserts: Array<Record<string, unknown>> = []

    cases.forEach((caseItem) => {
      if (caseItem.contract?.status !== 'aprovado') return
      const trays = caseItem.trays ?? []
      const hasDelivered = trays.some((tray) => tray.state === 'entregue')
      const hasPending = trays.some((tray) => tray.state === 'pendente')
      if (!hasDelivered || !hasPending) return

      trays
        .filter((tray) => tray.state === 'pendente' && Boolean(tray.dueDate))
        .forEach((tray) => {
          const expected = tray.dueDate as string
          const plannedDate = new Date(`${expected}T00:00:00`)
          plannedDate.setDate(plannedDate.getDate() - automation.leadDays)
          const plannedDateIso = plannedDate.toISOString().slice(0, 10)
          if (plannedDateIso > today) return

          const exists = items.some(
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
          const nowIso = nowIsoDateTime()
          const resolvedProductType = normalizeProductType(caseItem.productId ?? caseItem.productType)
          const notes = `Solicitação automática de reposição programada (${caseItem.id}_${tray.trayNumber}_${expected}).`

          inserts.push({
            clinic_id: caseItem.clinicId ?? null,
            case_id: caseItem.id,
            tray_number: tray.trayNumber,
            status: 'aguardando_iniciar',
            priority: 'Medio',
            notes,
            product_type: resolvedProductType,
            product_id: resolvedProductType,
            data: {
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
              plannedDate: plannedDateIso,
              dueDate: expected,
              priority: 'Medio',
              notes,
              status: 'aguardando_iniciar',
            },
            updated_at: nowIso,
          })
        })
    })

    if (!inserts.length) return ok(false)
    const { error } = await clientResult.data.from('lab_items').insert(inserts)
    if (error) return err(error.message)
    return ok(true)
  }

  async loadOverview(): Promise<Result<LabOverview, string>> {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data

    const [casesRes, labRes] = await Promise.all([
      client
        .from('cases')
        .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, scan_id, status, data, deleted_at')
        .is('deleted_at', null),
      client
        .from('lab_items')
        .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
        .is('deleted_at', null),
    ])
    if (casesRes.error) return err(casesRes.error.message)
    if (labRes.error) return err(labRes.error.message)

    const caseRows = (casesRes.data ?? []) as Array<Record<string, unknown>>
    const labRows = (labRes.data ?? []) as Array<Record<string, unknown>>
    const relatedPatientIds = new Set<string>()
    const relatedDentistIds = new Set<string>()
    const relatedClinicIds = new Set<string>()
    const relatedScanIds = new Set<string>()

    caseRows.forEach((row) => {
      const patientId = asText(row.patient_id)
      const dentistId = asText(row.dentist_id)
      const requesterId = asText(row.requested_by_dentist_id)
      const clinicId = asText(row.clinic_id)
      const scanId = asText(row.scan_id)
      if (patientId) relatedPatientIds.add(patientId)
      if (dentistId) relatedDentistIds.add(dentistId)
      if (requesterId) relatedDentistIds.add(requesterId)
      if (clinicId) relatedClinicIds.add(clinicId)
      if (scanId) relatedScanIds.add(scanId)
      const caseData = asObject(row.data)
      const sourceScanId = asText(caseData.sourceScanId)
      if (sourceScanId) relatedScanIds.add(sourceScanId)
    })

    const [patientsRes, dentistsRes, clinicsRes, scansRes] = await Promise.all([
      relatedPatientIds.size
        ? client.from('patients').select('id, name, birth_date, clinic_id, primary_dentist_id').in('id', [...relatedPatientIds]).is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
      relatedDentistIds.size
        ? client.from('dentists').select('id, name, gender').in('id', [...relatedDentistIds]).is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
      relatedClinicIds.size
        ? client.from('clinics').select('id, trade_name').in('id', [...relatedClinicIds]).is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
      relatedScanIds.size
        ? client.from('scans').select('id, data').in('id', [...relatedScanIds]).is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (patientsRes.error) return err(patientsRes.error.message)
    if (dentistsRes.error) return err(dentistsRes.error.message)
    if (clinicsRes.error) return err(clinicsRes.error.message)
    if (scansRes.error) return err(scansRes.error.message)

    const dentists = ((dentistsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: asText(row.id),
      name: asText(row.name, '-'),
      gender: (asText(row.gender) || undefined) as 'masculino' | 'feminino' | undefined,
    }))
    const dentistsById = new Map(dentists.map((row) => [row.id, row.name]))
    const clinics = ((clinicsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: asText(row.id),
      tradeName: asText(row.trade_name, '-'),
    }))
    const clinicsById = new Map(clinics.map((row) => [row.id, row.tradeName]))
    const patientOptions = normalizePatientOptions((patientsRes.data ?? []) as Array<Record<string, unknown>>, dentistsById, clinicsById)
    const scanDataById = new Map(
      ((scansRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [asText(row.id), asObject(row.data)]),
    )

    const casePrintFallbackByCaseId: LabOverview['casePrintFallbackByCaseId'] = {}
    const cases = caseRows.map((row) => {
      const sourceScanData = scanDataById.get(asText(asObject(row.data).sourceScanId, asText(row.scan_id))) ?? {}
      const treatmentCodeFromScan = asText(sourceScanData.serviceOrderCode)
      const mapped = mapSupabaseCaseRow(row, sourceScanData, treatmentCodeFromScan)
      casePrintFallbackByCaseId[mapped.id] = buildCasePrintFallback(row, sourceScanData)
      return mapped
    })
    let items = labRows.map(mapSupabaseLabRow)

    const inserted = await this.maybeInsertAutomatedReplenishments(cases, items)
    if (!inserted.ok) return inserted
    if (inserted.data) {
      const refreshRes = await client
        .from('lab_items')
        .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
        .is('deleted_at', null)
      if (refreshRes.error) return err(refreshRes.error.message)
      items = ((refreshRes.data ?? []) as Array<Record<string, unknown>>).map(mapSupabaseLabRow)
    }

    return ok({
      items: items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      cases,
      patientOptions,
      dentists,
      clinics,
      casePrintFallbackByCaseId,
    })
  }

  async listOrders() {
    const overview = await this.loadOverview()
    if (!overview.ok) return overview
    return ok(overview.data.items)
  }

  async findById(id: string) {
    const rowResult = await this.findOrderRow(id)
    if (!rowResult.ok) return null
    return mapSupabaseLabRow(rowResult.data)
  }

  async createOrder(input: RegisterLabOrderInput) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data

    let linkedCase: Case | null = null
    if (input.caseId) {
      const found = await this.findCaseRow(input.caseId)
      if (!found.ok) return found
      linkedCase = mapSupabaseCaseRow(found.data, {}, '')
      const contractStatus = asText(asObject(asObject(found.data.data).contract).status, 'pendente')
      if (contractStatus !== 'aprovado') {
        return err('Contrato não aprovado. Não é possível gerar OS para o laboratório.')
      }
    }

    const normalizedDraft = createLabOrderDraft({
      ...input,
      requestKind: input.requestKind ?? 'producao',
      plannedDate: input.plannedDate ?? nowIsoDate(),
      dueDate: input.dueDate,
    })
    if (linkedCase) {
      const invalidPlan = validatePlanForCase(linkedCase, normalizedDraft)
      if (invalidPlan) return err(invalidPlan)
    }

    const resolvedProductType = resolveLabOrderProductType(normalizedDraft, linkedCase)
    const resolvedStatus = requiresLabPlan(normalizedDraft, linkedCase)
      ? resolveAutomaticLabOrderStage(normalizedDraft.status, normalizedDraft, linkedCase)
      : normalizedDraft.status
    const nowIso = nowIsoDateTime()
    let requestCode = normalizedDraft.requestCode
    if (input.caseId && linkedCase) {
      const codes = await this.listCaseOrderCodes(input.caseId)
      if (!codes.ok) return codes
      const baseCode = caseCode(linkedCase)
      const hasBase = codes.data.includes(baseCode)
      requestCode =
        requestCode && requestCode.trim().length > 0
          ? requestCode
          : (normalizedDraft.requestKind ?? 'producao') === 'producao' && !hasBase
            ? baseCode
            : `${baseCode}/${nextRequestRevisionFromCodes(baseCode, codes.data)}`
    }

    const nextData = {
      requestCode,
      requestKind: normalizedDraft.requestKind ?? 'producao',
      expectedReplacementDate: normalizedDraft.expectedReplacementDate ?? normalizedDraft.dueDate,
      productType: resolvedProductType,
      productId: normalizeProductType(input.productId ?? input.productType ?? linkedCase?.productId ?? linkedCase?.productType),
      requestedProductId: input.requestedProductId ?? linkedCase?.requestedProductId,
      requestedProductLabel: input.requestedProductLabel ?? linkedCase?.requestedProductLabel,
      arch: normalizedDraft.arch,
      plannedUpperQty: normalizedDraft.plannedUpperQty ?? 0,
      plannedLowerQty: normalizedDraft.plannedLowerQty ?? 0,
      planningDefinedAt: hasProductionPlan(normalizedDraft) ? nowIso : undefined,
      trayNumber: normalizedDraft.trayNumber,
      patientName: normalizedDraft.patientName,
      patientId: normalizedDraft.patientId,
      dentistId: normalizedDraft.dentistId,
      clinicId: normalizedDraft.clinicId,
      plannedDate: normalizedDraft.plannedDate,
      dueDate: normalizedDraft.dueDate,
      priority: normalizedDraft.priority,
      notes: normalizedDraft.notes,
      status: resolvedStatus,
    }

    const { data, error } = await client
      .from('lab_items')
      .insert({
        clinic_id: input.clinicId ?? linkedCase?.clinicId ?? null,
        case_id: input.caseId ?? null,
        tray_number: input.trayNumber,
        status: resolvedStatus,
        priority: input.priority,
        notes: input.notes ?? null,
        product_type: resolvedProductType,
        product_id: resolvedProductType,
        data: nextData,
        updated_at: nowIso,
      })
      .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
      .maybeSingle()
    if (error || !data) return err(error?.message ?? 'Não foi possível criar a OS.')

    if (resolvedStatus === 'em_producao') {
      const seeded = await this.ensureInitialReplenishmentSeed({
        caseId: input.caseId,
        trayNumber: input.trayNumber,
        status: resolvedStatus,
        productType: resolvedProductType,
        productId: resolvedProductType,
        priority: input.priority,
        data: nextData,
      })
      if (!seeded.ok) return seeded
    }

    const order = mapSupabaseLabRow(data as Record<string, unknown>)
    if (order.caseId && (order.requestKind ?? 'producao') === 'producao') {
      logger.business(BUSINESS_EVENTS.LAB_SENT, 'Caso enviado para o LAB.', {
        labOrderId: order.id,
        caseId: order.caseId,
        requestCode: order.requestCode ?? order.id,
        trayNumber: order.trayNumber,
        productType: order.productType,
        status: order.status,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
    }
    return ok({ order })
  }

  async updateOrder(id: string, input: UpdateLabOrderInput) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data
    const rowResult = await this.findOrderRow(id)
    if (!rowResult.ok) return rowResult
    const current = rowResult.data
    const currentData = asObject(current.data)

    let linkedCase: Case | null = null
    const nextCaseId = asText(input.caseId, asText(current.case_id))
    if (nextCaseId) {
      const found = await this.findCaseRow(nextCaseId)
      if (!found.ok) return found
      linkedCase = mapSupabaseCaseRow(found.data, {}, '')
      const contractStatus = asText(asObject(asObject(found.data.data).contract).status, 'pendente')
      if (contractStatus !== 'aprovado') return err('Caso vinculado inválido ou sem contrato aprovado.')
    }

    const plannedUpperQty = input.plannedUpperQty ?? asNumber(currentData.plannedUpperQty, 0)
    const plannedLowerQty = input.plannedLowerQty ?? asNumber(currentData.plannedLowerQty, 0)
    const nextProductType = normalizeProductType(
      input.productType ?? input.productId ?? current.product_type ?? current.product_id ?? currentData.productType ?? currentData.productId,
    )
    if (linkedCase) {
      const invalidPlan = validatePlanForCase(linkedCase, { plannedUpperQty, plannedLowerQty } as LabOrder)
      if (invalidPlan) return err(invalidPlan)
    }

    const currentStatus = asText(current.status, 'aguardando_iniciar') as LabOrder['status']
    const requestedStatus = (input.status ?? currentStatus) as LabOrder['status']
    const shouldAutoResolveStatus =
      input.status !== undefined
      || input.plannedUpperQty !== undefined
      || input.plannedLowerQty !== undefined
      || input.productType !== undefined
      || input.productId !== undefined
      || input.arch !== undefined
    const autoStatus = requiresLabPlan({
      productType: nextProductType,
      productId: nextProductType,
      plannedUpperQty,
      plannedLowerQty,
    } as LabOrder, linkedCase)
      ? resolveAutomaticLabOrderStage(requestedStatus, {
        productType: nextProductType,
        productId: nextProductType,
        plannedUpperQty,
        plannedLowerQty,
      } as LabOrder, linkedCase)
      : requestedStatus
    const nextStatus = currentStatus === 'aguardando_iniciar' && shouldAutoResolveStatus ? autoStatus : requestedStatus
    if (!canTransitionLabOrderStage(currentStatus, nextStatus)) {
      return err('Transição de status inválida para este item.')
    }
    if (nextStatus === 'em_producao') {
      try {
        assertReadyToStartProduction({
          arch: asText(input.arch, asText(currentData.arch, 'ambos')) as LabOrder['arch'],
          productType: nextProductType,
          productId: nextProductType,
          plannedUpperQty,
          plannedLowerQty,
        } as LabOrder, linkedCase)
      } catch (cause) {
        return err(cause instanceof Error ? cause.message : 'Não foi possível iniciar produção.')
      }
    }

    const nowIso = nowIsoDateTime()
    const nextData = {
      ...currentData,
      productType: nextProductType,
      productId: normalizeProductType(input.productId ?? input.productType ?? current.product_id ?? current.product_type ?? currentData.productId ?? currentData.productType),
      arch: input.arch ?? asText(currentData.arch, 'ambos'),
      plannedUpperQty,
      plannedLowerQty,
      planningDefinedAt: hasProductionPlan({ plannedUpperQty, plannedLowerQty } as LabOrder)
        ? asText(currentData.planningDefinedAt) || nowIso
        : undefined,
      trayNumber: input.trayNumber ?? asNumber(current.tray_number, asNumber(currentData.trayNumber, 1)),
      patientName: input.patientName ?? asText(currentData.patientName, '-'),
      patientId: input.patientId ?? (asText(currentData.patientId) || undefined),
      dentistId: input.dentistId ?? (asText(currentData.dentistId) || undefined),
      clinicId: input.clinicId ?? (asText(currentData.clinicId) || undefined),
      dueDate: input.dueDate ? toIsoDate(input.dueDate) : asText(currentData.dueDate, nowIso.slice(0, 10)),
      plannedDate: input.plannedDate ? toIsoDate(input.plannedDate) : asText(currentData.plannedDate, nowIso.slice(0, 10)),
      priority: input.priority ?? asText(current.priority, asText(currentData.priority, 'Medio')),
      notes: input.notes ?? (asText(current.notes, asText(currentData.notes, '')) || undefined),
      deliveredToProfessionalAt: input.deliveredToProfessionalAt ?? (asText(currentData.deliveredToProfessionalAt) || undefined),
      status: nextStatus,
    }

    const { data, error } = await client
      .from('lab_items')
      .update({
        tray_number: nextData.trayNumber,
        status: nextStatus,
        priority: nextData.priority,
        notes: nextData.notes ?? null,
        clinic_id: asText(nextData.clinicId) || null,
        product_type: nextProductType,
        product_id: nextProductType,
        data: nextData,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
      .maybeSingle()
    if (error || !data) return err(error?.message ?? 'Não foi possível atualizar a OS.')

    if (nextStatus === 'em_producao') {
      const seeded = await this.ensureInitialReplenishmentSeed({
        caseId: asText(current.case_id) || undefined,
        trayNumber: nextData.trayNumber,
        status: nextStatus,
        productType: nextProductType,
        productId: nextProductType,
        priority: nextData.priority as LabOrder['priority'],
        data: nextData,
      })
      if (!seeded.ok) return seeded
    }

    return ok({ order: mapSupabaseLabRow(data as Record<string, unknown>) })
  }

  async moveOrderToStage(input: UpdateLabStageInput) {
    const rowResult = await this.findOrderRow(input.id)
    if (!rowResult.ok) return rowResult
    const current = rowResult.data
    const currentData = asObject(current.data)
    const linkedCase = asText(current.case_id) ? (await this.findCaseRow(asText(current.case_id))) : null
    const mappedCase = linkedCase && linkedCase.ok ? mapSupabaseCaseRow(linkedCase.data, {}, '') : null
    if (!canTransitionLabOrderStage(asText(current.status, 'aguardando_iniciar') as LabOrder['status'], input.nextStage)) {
      return err('Transição de status inválida para este item.')
    }
    if (input.nextStage === 'em_producao') {
      try {
        assertReadyToStartProduction({
          arch: asText(currentData.arch, 'ambos') as LabOrder['arch'],
          productType: normalizeProductType(current.product_type ?? current.product_id ?? currentData.productType ?? currentData.productId),
          productId: normalizeProductType(current.product_id ?? current.product_type ?? currentData.productId ?? currentData.productType),
          plannedUpperQty: asNumber(currentData.plannedUpperQty, 0),
          plannedLowerQty: asNumber(currentData.plannedLowerQty, 0),
        } as LabOrder, mappedCase)
      } catch (cause) {
        return err(cause instanceof Error ? cause.message : 'Não foi possível iniciar produção.')
      }
    }
    return this.updateOrder(input.id, { status: input.nextStage })
  }

  async deleteOrder(id: string) {
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const nowIso = nowIsoDateTime()
    const { data, error } = await clientResult.data
      .from('lab_items')
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
    if (error) return err(error.message)
    if (!data || data.length === 0) return err('OS não excluida. Verifique permissoes.')
    return ok(null)
  }

  async createAdvanceOrder(input: CreateAdvanceLabOrderInput) {
    const rowResult = await this.findOrderRow(input.sourceLabItemId)
    if (!rowResult.ok) return rowResult
    const source = rowResult.data
    const sourceData = asObject(source.data)
    const sourceCaseId = asText(source.case_id)
    if (!sourceCaseId) return err('OS sem caso vinculado.')
    const linkedCaseRow = await this.findCaseRow(sourceCaseId)
    if (!linkedCaseRow.ok) return linkedCaseRow
    const linkedCase = mapSupabaseCaseRow(linkedCaseRow.data, {}, '')
    if (linkedCase.contract?.status !== 'aprovado') {
      return err('Contrato não aprovado para gerar reposição.')
    }

    const plannedUpperQty = Math.max(0, Math.trunc(input.plannedUpperQty))
    const plannedLowerQty = Math.max(0, Math.trunc(input.plannedLowerQty))
    if (plannedUpperQty + plannedLowerQty <= 0) return err('Informe quantidade maior que zero para gerar reposição.')
    const invalidPlan = validatePlanForCase(linkedCase, { plannedUpperQty, plannedLowerQty } as LabOrder)
    if (invalidPlan) return err(invalidPlan)
    const pendingTrays = linkedCase.trays.filter((tray) => tray.state === 'pendente').map((tray) => tray.trayNumber).sort((a, b) => a - b)
    const nextTrayNumber = pendingTrays[0]
    if (!nextTrayNumber) return err('Não há placas pendentes para gerar reposição.')

    const codes = await this.listCaseOrderCodes(sourceCaseId)
    if (!codes.ok) return codes
    const baseCode = caseCode(linkedCase)
    const sourceRequestCode = asText(sourceData.requestCode)
    const sourceIsRevision = Boolean(sourceRequestCode && new RegExp(`^${baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`).test(sourceRequestCode))
    const requestCode = asText(sourceData.requestKind, 'producao') === 'reposicao_programada' && sourceIsRevision
      ? sourceRequestCode
      : `${baseCode}/${nextRequestRevisionFromCodes(baseCode, codes.data)}`

    const nowIso = nowIsoDateTime()
    const today = nowIso.slice(0, 10)
    const dueDate = input.dueDate ?? asText(sourceData.expectedReplacementDate, asText(sourceData.dueDate, today))
    const resolvedProductType = normalizeProductType(
      source.product_id ?? source.product_type ?? sourceData.productId ?? sourceData.productType,
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

    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data
    const { data, error } = await client
      .from('lab_items')
      .insert({
        clinic_id: asText(sourceData.clinicId, asText(linkedCaseRow.data.clinic_id)) || null,
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
      .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
      .maybeSingle()
    if (error || !data) return err(error?.message ?? 'Não foi possível criar a reposição.')

    if (asText(sourceData.requestKind, 'producao') === 'reposicao_programada') {
      await client.from('lab_items').update({ deleted_at: nowIso, updated_at: nowIso }).eq('id', input.sourceLabItemId)
    }

    return ok({ order: mapSupabaseLabRow(data as Record<string, unknown>) })
  }

  async registerShipment(input: RegisterShipmentInput): Promise<Result<RegisterShipmentOutput, string>> {
    const orderResult = await this.findOrderRow(input.labOrderId)
    if (!orderResult.ok) return orderResult
    const current = orderResult.data
    const order = mapSupabaseLabRow(current)
    const deliveredToDoctorAt = toIsoDate(input.deliveredToDoctorAt)

    if (!order.caseId) {
      const updated = await this.updateOrder(order.id, {
        deliveredToProfessionalAt: deliveredToDoctorAt,
        notes: input.note ?? order.notes,
      })
      if (!updated.ok) return updated
      logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
        labOrderId: order.id,
        deliveredToDoctorAt,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
      return ok({ order: updated.data.order, deliveredUpperQty: 0, deliveredLowerQty: 0 })
    }

    const caseResult = await this.findCaseRow(order.caseId)
    if (!caseResult.ok) return caseResult
    const caseItem = mapSupabaseCaseRow(caseResult.data, {}, '')
    const productType = resolveLabOrderProductType(order, caseItem)
    const isRework = (order.requestKind ?? 'producao') === 'reconfeccao' || isReworkProductionOrder(order)
    const isAligner = isAlignerProductType(productType)

    if (!isRework && !isAligner) {
      const updated = await this.updateOrder(order.id, {
        deliveredToProfessionalAt: deliveredToDoctorAt,
        notes: input.note ?? order.notes,
      })
      if (!updated.ok) return updated
      const nextData = { ...caseItem, status: 'em_entrega', phase: 'em_producao', updatedAt: nowIsoDateTime() }
      const clientResult = this.ensureClient()
      if (!clientResult.ok) return clientResult
      const { error } = await clientResult.data
        .from('cases')
        .update({ data: nextData, status: 'em_entrega', updated_at: nowIsoDateTime() })
        .eq('id', caseItem.id)
      if (error) return err(error.message)
      logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
        labOrderId: order.id,
        caseId: caseItem.id,
        deliveredToDoctorAt,
        deliveredUpperQty: 0,
        deliveredLowerQty: 0,
      }, this.currentUser ? {
        id: this.currentUser.id,
        role: this.currentUser.role,
      } : undefined)
      return ok({ order: updated.data.order, deliveredUpperQty: 0, deliveredLowerQty: 0 })
    }

    const ops: Array<{ arch: 'superior' | 'inferior'; fromTray: number; toTray: number }> = []
    if (isRework) {
      if (order.arch === 'superior' || order.arch === 'ambos') ops.push({ arch: 'superior', fromTray: order.trayNumber, toTray: order.trayNumber })
      if (order.arch === 'inferior' || order.arch === 'ambos') ops.push({ arch: 'inferior', fromTray: order.trayNumber, toTray: order.trayNumber })
    } else {
      const upperQty = Math.max(0, Math.trunc(input.upperQty))
      const lowerQty = Math.max(0, Math.trunc(input.lowerQty))
      if (upperQty > 0) ops.push({ arch: 'superior', fromTray: Math.max(1, order.trayNumber), toTray: Math.max(1, order.trayNumber) + upperQty - 1 })
      if (lowerQty > 0) ops.push({ arch: 'inferior', fromTray: Math.max(1, order.trayNumber), toTray: Math.max(1, order.trayNumber) + lowerQty - 1 })
    }
    if (!ops.length) return err('Nenhum lote valido para registrar.')

    const nextLots = [...(caseItem.deliveryLots ?? [])]
    const nextTrays = (caseItem.trays ?? []).map((tray) => ({ ...tray }))
    ops.forEach((op) => {
      nextLots.push({
        id: createEntityId('lot'),
        arch: op.arch,
        fromTray: op.fromTray,
        toTray: op.toTray,
        quantity: op.toTray - op.fromTray + 1,
        deliveredToDoctorAt,
        note: input.note?.trim() || undefined,
        createdAt: nowIsoDateTime(),
      })
      for (let trayNumber = op.fromTray; trayNumber <= op.toTray; trayNumber += 1) {
        const tray = nextTrays.find((item) => item.trayNumber === trayNumber)
        if (tray) {
          tray.state = 'entregue'
          tray.deliveredAt = deliveredToDoctorAt
        }
      }
    })

    const nextData = {
      ...caseItem,
      deliveryLots: nextLots,
      trays: nextTrays,
      status: 'em_entrega',
      phase: 'em_producao',
      updatedAt: nowIsoDateTime(),
    }
    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const { error } = await clientResult.data
      .from('cases')
      .update({ data: nextData, status: 'em_entrega', updated_at: nowIsoDateTime() })
      .eq('id', caseItem.id)
    if (error) return err(error.message)

    const deliveredUpperQty = ops.filter((op) => op.arch === 'superior').reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
    const deliveredLowerQty = ops.filter((op) => op.arch === 'inferior').reduce((total, op) => total + (op.toTray - op.fromTray + 1), 0)
    logger.business(BUSINESS_EVENTS.LAB_DELIVERED, 'Entrega LAB registrada.', {
      labOrderId: order.id,
      caseId: caseItem.id,
      deliveredToDoctorAt,
      deliveredUpperQty,
      deliveredLowerQty,
    }, this.currentUser ? {
      id: this.currentUser.id,
      role: this.currentUser.role,
    } : undefined)

    return ok({
      order,
      deliveredUpperQty,
      deliveredLowerQty,
    })
  }

  async registerRework(input: RegisterReworkInput): Promise<Result<RegisterReworkOutput, string>> {
    const caseResult = await this.findCaseRow(input.caseId)
    if (!caseResult.ok) return caseResult
    const caseItem = mapSupabaseCaseRow(caseResult.data, {}, '')
    const tray = caseItem.trays.find((item) => item.trayNumber === input.trayNumber)
    if (!tray) return err('Placa não encontrada no caso.')

    const clientResult = this.ensureClient()
    if (!clientResult.ok) return clientResult
    const client = clientResult.data
    const { data: linkedLabRows, error: linkedLabError } = await client
      .from('lab_items')
      .select('id, clinic_id, case_id, tray_number, status, priority, notes, product_type, product_id, created_at, updated_at, data')
      .eq('case_id', input.caseId)
      .is('deleted_at', null)
    if (linkedLabError) return err(linkedLabError.message)
    const linkedLabItems = ((linkedLabRows ?? []) as Array<Record<string, unknown>>).map(mapSupabaseLabRow)

    const hasOpenRework = linkedLabItems.some(
      (item) => item.trayNumber === input.trayNumber && item.requestKind === 'reconfeccao' && item.status !== 'prontas',
    )
    const hasOpenReworkProduction = linkedLabItems.some(
      (item) =>
        item.trayNumber === input.trayNumber &&
        isReworkProductionOrder(item) &&
        item.status !== 'prontas',
    )

    const nextTrays = caseItem.trays.map((item) =>
      item.trayNumber === input.trayNumber ? { ...item, state: 'rework' as const, notes: input.reason.trim() || undefined } : item,
    )
    const nextData = {
      ...caseItem,
      trays: nextTrays,
      deliveryLots: removeTrayFromDeliveryLots(caseItem.deliveryLots ?? [], input.trayNumber, input.arch),
      installation: adjustInstallationForRework(caseItem.installation, input.trayNumber, input.arch),
      updatedAt: nowIsoDateTime(),
    }
    const { error: caseError } = await client
      .from('cases')
      .update({ data: nextData, updated_at: nowIsoDateTime() })
      .eq('id', input.caseId)
    if (caseError) return err(caseError.message)

    const dueDate = tray.dueDate ?? nowIsoDate()
    let createdReworkOrder: LabOrder | undefined
    let createdProductionOrder: LabOrder | undefined

    if (!hasOpenRework) {
      const created = await this.createOrder({
        caseId: input.caseId,
        productType: caseItem.productType ?? 'alinhador_12m',
        productId: caseItem.productId ?? caseItem.productType ?? 'alinhador_12m',
        requestKind: 'reconfeccao',
        arch: input.arch,
        plannedUpperQty: 0,
        plannedLowerQty: 0,
        patientName: caseItem.patientName,
        trayNumber: input.trayNumber,
        plannedDate: nowIsoDate(),
        dueDate,
        status: 'aguardando_iniciar',
        priority: 'Urgente',
        notes: input.reason.trim(),
        reworkOfCaseId: input.caseId,
        reworkOfTrayNumber: input.trayNumber,
      })
      if (!created.ok) return created
      createdReworkOrder = created.data.order
    }
    if (!hasOpenReworkProduction) {
      const created = await this.createOrder({
        caseId: input.caseId,
        productType: caseItem.productType ?? 'alinhador_12m',
        productId: caseItem.productId ?? caseItem.productType ?? 'alinhador_12m',
        requestKind: 'producao',
        arch: input.arch,
        plannedUpperQty: 0,
        plannedLowerQty: 0,
        patientName: caseItem.patientName,
        trayNumber: input.trayNumber,
        plannedDate: nowIsoDate(),
        dueDate,
        status: 'aguardando_iniciar',
        priority: 'Urgente',
        notes: `OS de produção para reconfecção da placa #${input.trayNumber}. Motivo: ${input.reason.trim()}`,
        reworkOfCaseId: input.caseId,
        reworkOfTrayNumber: input.trayNumber,
      })
      if (!created.ok) return created
      createdProductionOrder = created.data.order
    }

    logger.business(BUSINESS_EVENTS.LAB_REWORK_REGISTERED, 'Reconfecção registrada.', {
      caseId: input.caseId,
      trayNumber: input.trayNumber,
      arch: input.arch,
      reworkOrderId: createdReworkOrder?.id,
      productionOrderId: createdProductionOrder?.id,
    }, this.currentUser ? {
      id: this.currentUser.id,
      role: this.currentUser.role,
    } : undefined)

    return ok({
      caseId: input.caseId,
      trayNumber: input.trayNumber,
      createdReworkOrder,
      createdProductionOrder,
    })
  }
}

export function createSupabaseLabRepository(currentUser: User | null) {
  return new SupabaseLabRepository(currentUser)
}
