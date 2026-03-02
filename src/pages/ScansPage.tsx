import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useToast } from '../app/ToastProvider'
import CreateCaseFromScanModal from '../components/scans/CreateCaseFromScanModal'
import ScanDetailsModal from '../components/scans/ScanDetailsModal'
import ScanModal from '../components/scans/ScanModal'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import { can } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import {
  addScanAttachment,
  approveScan,
  clearScanAttachmentError,
  createCaseFromScan,
  createScan,
  deleteScan,
  markScanAttachmentError,
  rejectScan,
  updateScan,
} from '../data/scanRepo'
import { updatePatient } from '../repo/patientRepo'
import { createCaseFromScanSupabase, createScanSupabase, deleteScanSupabase, updateScanStatusSupabase } from '../repo/profileRepo'
import AppShell from '../layouts/AppShell'
import type { Scan, ScanAttachment } from '../types/Scan'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { listScansForUser } from '../auth/scope'
import { buildScanAttachmentPath, createSignedUrl, uploadToStorage, validateScanAttachmentFile } from '../repo/storageRepo'
import { supabase } from '../lib/supabaseClient'
import { parsePlanningTrayCounts } from '../lib/archformParser'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'

function archTone(arch: Scan['arch']) {
  if (arch === 'ambos') return 'info' as const
  return 'neutral' as const
}

function statusTone(status: Scan['status']) {
  if (status === 'aprovado') return 'success' as const
  if (status === 'reprovado') return 'danger' as const
  if (status === 'convertido') return 'info' as const
  return 'neutral' as const
}

function scanCompleteness(scan: Scan) {
  const ok = scan.attachments.filter((item) => (item.status ?? 'ok') === 'ok')
  const fotos = ok.filter((item) => item.kind === 'foto_intra' || item.kind === 'foto_extra').length
  const rxTypes = new Set(ok.filter((item) => item.rxType).map((item) => item.rxType))
  const stlSup = ok.some((item) => item.kind === 'scan3d' && item.arch === 'superior')
  const stlInf = ok.some((item) => item.kind === 'scan3d' && item.arch === 'inferior')
  return {
    photos: fotos,
    rx: rxTypes.size,
    stlSup: stlSup ? 'ok' : 'falta',
    stlInf: stlInf ? 'ok' : 'falta',
  }
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

function toCaseScanFiles(attachments: ScanAttachment[]) {
  return normalizeScanAttachments(attachments).map((att) => ({
    id: att.id,
    name: att.name,
    kind: att.kind,
    slotId: att.slotId,
    rxType: att.rxType,
    arch: att.arch,
    isLocal: att.isLocal,
    url: att.url,
    filePath: att.filePath,
    status: att.status,
    attachedAt: att.attachedAt,
    note: att.note,
    flaggedAt: att.flaggedAt,
    flaggedReason: att.flaggedReason,
    createdAt: att.createdAt,
  }))
}

export default function ScansPage() {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const canRead = can(currentUser, 'scans.read')
  const canWrite = can(currentUser, 'scans.write')
  const canApprove = can(currentUser, 'scans.approve')
  const canDelete = can(currentUser, 'scans.delete') && currentUser?.role === 'master_admin'
  const canCreateCase = can(currentUser, 'cases.write')
  const isSupabaseMode = DATA_MODE === 'supabase'
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'todos' | Scan['status']>('todos')
  const [archFilter, setArchFilter] = useState<'todos' | Scan['arch']>('todos')
  const [purposeFilter, setPurposeFilter] = useState('todos')
  const [details, setDetails] = useState<Scan | null>(null)
  const [createCaseTarget, setCreateCaseTarget] = useState<Scan | null>(null)
  const [supabaseScans, setSupabaseScans] = useState<Scan[]>([])
  const [supabaseCases, setSupabaseCases] = useState<Array<{ id: string; shortId?: string; treatmentCode?: string }>>([])
  const [supabasePatients, setSupabasePatients] = useState<Array<{ id: string; shortId?: string; name: string; primaryDentistId?: string; clinicId?: string }>>([])
  const [supabaseDentists, setSupabaseDentists] = useState<Array<{ id: string; name: string; gender?: 'masculino' | 'feminino'; clinicId?: string }>>([])
  const [supabaseClinics, setSupabaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) return
    ;(async () => {
      const [scansRes, casesRes, patientsRes, dentistsRes, clinicsRes] = await Promise.all([
        supabase.from('scans').select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, created_at, updated_at, deleted_at, data').is('deleted_at', null),
        supabase.from('cases').select('id, short_id, deleted_at, data').is('deleted_at', null),
        supabase.from('patients').select('id, short_id, name, primary_dentist_id, clinic_id, deleted_at').is('deleted_at', null),
        supabase.from('dentists').select('id, name, gender, clinic_id, deleted_at').is('deleted_at', null),
        supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null),
      ])
      if (!active) return

      const patients = ((patientsRes.data ?? []) as Array<{
        id: string
        short_id?: string
        name: string
        primary_dentist_id?: string
        clinic_id?: string
      }>).map((row) => ({
        id: row.id,
        shortId: row.short_id ?? undefined,
        name: row.name ?? '-',
        primaryDentistId: row.primary_dentist_id ?? undefined,
        clinicId: row.clinic_id ?? undefined,
      }))
      setSupabasePatients(patients)
      const patientsById = new Map(patients.map((item) => [item.id, item.name]))

      setSupabaseDentists(((dentistsRes.data ?? []) as Array<{ id: string; name: string; gender?: string; clinic_id?: string }>).map((row) => ({
        id: row.id,
        name: row.name ?? '-',
        gender: row.gender === 'feminino' ? 'feminino' : 'masculino',
        clinicId: row.clinic_id ?? undefined,
      })))

      setSupabaseClinics(((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => ({
        id: row.id,
        tradeName: row.trade_name ?? '-',
      })))

      setSupabaseCases(((casesRes.data ?? []) as Array<{ id: string; short_id?: string; data?: Record<string, unknown> }>).map((row) => ({
        id: row.id,
        shortId: row.short_id ?? undefined,
        treatmentCode: (row.data?.treatmentCode as string | undefined) ?? undefined,
      })))

      const scansMapped = ((scansRes.data ?? []) as Array<{
        id: string
        clinic_id?: string
        patient_id?: string
        dentist_id?: string
        requested_by_dentist_id?: string
        created_at?: string
        updated_at?: string
        data?: Record<string, unknown>
      }>).map((row) => {
        const data = row.data ?? {}
        return {
          id: row.id,
          shortId: data.shortId as string | undefined,
          clinicId: row.clinic_id ?? undefined,
          patientId: row.patient_id ?? undefined,
          dentistId: row.dentist_id ?? undefined,
          requestedByDentistId: row.requested_by_dentist_id ?? undefined,
          patientName: (data.patientName as string | undefined) ?? (row.patient_id ? patientsById.get(row.patient_id) ?? '-' : '-'),
          purposeProductId: data.purposeProductId as string | undefined,
          purposeProductType: data.purposeProductType as string | undefined,
          purposeLabel: data.purposeLabel as string | undefined,
          serviceOrderCode: data.serviceOrderCode as string | undefined,
          scanDate: (data.scanDate as string | undefined) ?? (row.created_at ?? new Date().toISOString()).slice(0, 10),
          arch: (data.arch as Scan['arch'] | undefined) ?? 'ambos',
          complaint: data.complaint as string | undefined,
          dentistGuidance: data.dentistGuidance as string | undefined,
          notes: data.notes as string | undefined,
          planningDetectedUpperTrays: data.planningDetectedUpperTrays as number | undefined,
          planningDetectedLowerTrays: data.planningDetectedLowerTrays as number | undefined,
          planningDetectedAt: data.planningDetectedAt as string | undefined,
          planningDetectedSource: data.planningDetectedSource as Scan['planningDetectedSource'] | undefined,
          attachments: (Array.isArray(data.attachments) ? data.attachments : []) as ScanAttachment[],
          status: (data.status as Scan['status'] | undefined) ?? 'pendente',
          linkedCaseId: data.linkedCaseId as string | undefined,
          createdAt: (data.createdAt as string | undefined) ?? row.created_at ?? new Date().toISOString(),
          updatedAt: (data.updatedAt as string | undefined) ?? row.updated_at ?? row.created_at ?? new Date().toISOString(),
        } satisfies Scan
      })
      setSupabaseScans(scansMapped)
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseRefreshKey, supabaseSyncTick])

  const scans = useMemo(() => (canRead ? (isSupabaseMode ? supabaseScans : listScansForUser(db, currentUser)) : []), [canRead, isSupabaseMode, supabaseScans, db, currentUser])
  const purposeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          scans
            .map((scan) => scan.purposeLabel?.trim() || (scan.purposeProductType ? scan.purposeProductType : 'Alinhador'))
            .filter((item) => item.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [scans],
  )
  const caseLookupSource = useMemo(
    () => (isSupabaseMode ? supabaseCases : db.cases.map((item) => ({ id: item.id, shortId: item.shortId, treatmentCode: item.treatmentCode }))),
    [isSupabaseMode, supabaseCases, db.cases],
  )
  const caseShortById = useMemo(
    () => new Map(caseLookupSource.map((item) => [item.id, item.shortId])),
    [caseLookupSource],
  )
  const caseById = useMemo(
    () => new Map(caseLookupSource.map((item) => [item.id, item])),
    [caseLookupSource],
  )
  const patientLookupSource = useMemo(
    () => (isSupabaseMode ? supabasePatients : db.patients.map((item) => ({ id: item.id, shortId: item.shortId, name: item.name, primaryDentistId: item.primaryDentistId, clinicId: item.clinicId }))),
    [isSupabaseMode, supabasePatients, db.patients],
  )
  const patientsById = useMemo(
    () => new Map(patientLookupSource.map((item) => [item.id, item.name])),
    [patientLookupSource],
  )
  const filteredScans = useMemo(() => {
    const query = search.trim().toLowerCase()
    return scans.filter((scan) => {
      const patientName = (scan.patientId ? patientsById.get(scan.patientId) ?? scan.patientName : scan.patientName).toLowerCase()
      const patientShortId = scan.patientId ? (patientLookupSource.find((item) => item.id === scan.patientId)?.shortId ?? '') : ''
      const caseShortId = scan.linkedCaseId ? (caseShortById.get(scan.linkedCaseId) ?? '') : ''
      const serviceOrder = (scan.serviceOrderCode ?? '').toLowerCase()
      const purposeLabel = (scan.purposeLabel ?? scan.purposeProductType ?? 'Alinhador').toLowerCase()
      const matchesQuery =
        query.length === 0 ||
        patientName.includes(query) ||
        patientShortId.toLowerCase().includes(query) ||
        caseShortId.toLowerCase().includes(query) ||
        (scan.shortId ?? '').toLowerCase().includes(query) ||
        serviceOrder.includes(query) ||
        purposeLabel.includes(query)
      const matchesStatus = statusFilter === 'todos' || scan.status === statusFilter
      const matchesArch = archFilter === 'todos' || scan.arch === archFilter
      const matchesPurpose =
        purposeFilter === 'todos' ||
        (scan.purposeLabel?.trim() || (scan.purposeProductType ? scan.purposeProductType : 'Alinhador')) === purposeFilter
      return matchesQuery && matchesStatus && matchesArch && matchesPurpose
    })
  }, [archFilter, caseShortById, patientLookupSource, patientsById, scans, search, statusFilter, purposeFilter])
  const dentists = useMemo(
    () => (isSupabaseMode ? supabaseDentists : db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt)),
    [isSupabaseMode, supabaseDentists, db.dentists],
  )
  const clinics = useMemo(
    () => (isSupabaseMode ? supabaseClinics : db.clinics.filter((item) => !item.deletedAt)),
    [isSupabaseMode, supabaseClinics, db.clinics],
  )
  const clinicsForModal = useMemo(
    () => clinics.map((item) => ({ id: item.id, name: item.tradeName })),
    [clinics],
  )

  const handleApprove = async (id: string) => {
    if (isSupabaseMode) {
      const result = await updateScanStatusSupabase(id, 'aprovado')
      if (!result.ok) return addToast({ type: 'error', title: result.error })
      setSupabaseRefreshKey((current) => current + 1)
      addToast({ type: 'success', title: 'Scan aprovado' })
      return
    }
    approveScan(id)
    addToast({ type: 'success', title: 'Scan aprovado' })
  }

  const handleReject = async (id: string) => {
    if (isSupabaseMode) {
      const result = await updateScanStatusSupabase(id, 'reprovado')
      if (!result.ok) return addToast({ type: 'error', title: result.error })
      setSupabaseRefreshKey((current) => current + 1)
      addToast({ type: 'info', title: 'Scan reprovado' })
      return
    }
    rejectScan(id)
    addToast({ type: 'info', title: 'Scan reprovado' })
  }

  const handleDelete = async (scan: Scan) => {
    if (!canDelete) return
    const confirmed = window.confirm(
      `Confirma excluir permanentemente este exame de ${scan.patientName}? Esta acao sera registrada no historico do paciente.`,
    )
    if (!confirmed) return
    if (isSupabaseMode) {
      const result = await deleteScanSupabase(scan.id)
      if (!result.ok) return addToast({ type: 'error', title: result.error })
      if (details?.id === scan.id) {
        setDetails(null)
      }
      setSupabaseRefreshKey((current) => current + 1)
      addToast({ type: 'success', title: 'Escaneamento excluido' })
      return
    }
    deleteScan(scan.id)
    if (details?.id === scan.id) {
      setDetails(null)
    }
    addToast({ type: 'success', title: 'Escaneamento excluido' })
  }
  const addAttachment = async (
    scanId: string,
    payload: {
      file: File
      kind: ScanAttachment['kind']
      slotId?: string
      rxType?: ScanAttachment['rxType']
      arch?: ScanAttachment['arch']
      attachedAt: string
      note: string
    },
  ) => {
    if (!canWrite) {
      addToast({ type: 'error', title: 'Sem permissao para adicionar anexos' })
      return
    }
    const validation = validateScanAttachmentFile(payload.file, payload.kind)
    if (!validation.ok) {
      addToast({ type: 'error', title: validation.error })
      return
    }
    const targetScan = scans.find((item) => item.id === scanId)
    let filePath: string | undefined
    let url: string | undefined
    let isLocal = true

    if (DATA_MODE === 'supabase') {
      const patientClinicId = targetScan?.patientId
        ? patientLookupSource.find((item) => item.id === targetScan.patientId)?.clinicId
        : undefined
      const clinicId = targetScan?.clinicId || patientClinicId || currentUser?.linkedClinicId
      if (!clinicId) {
        addToast({ type: 'error', title: 'Nao foi possivel determinar a clinica para upload.' })
        return
      }
      filePath = buildScanAttachmentPath({
        clinicId,
        scanId,
        patientId: targetScan?.patientId,
        kind: payload.kind,
        fileName: payload.file.name,
      })
      const upload = await uploadToStorage(filePath, payload.file)
      if (!upload.ok) {
        addToast({ type: 'error', title: upload.error })
        return
      }
      const signed = await createSignedUrl(filePath, 300)
      url = signed.ok ? signed.url : undefined
      isLocal = false
    } else {
      url = URL.createObjectURL(payload.file)
    }

    const now = new Date().toISOString()
    const nextAttachment: ScanAttachment = {
      id: `scan_file_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: payload.file.name,
      kind: payload.kind,
      slotId: payload.slotId,
      rxType: payload.rxType,
      arch: payload.arch,
      mime: payload.file.type,
      size: payload.file.size,
      url,
      filePath,
      isLocal,
      note: payload.note,
      status: 'ok',
      attachedAt: payload.attachedAt,
      createdAt: now,
    }

    let nextScan: Scan
    if (isSupabaseMode && supabase) {
      if (!targetScan) return
      nextScan = {
        ...targetScan,
        attachments: normalizeScanAttachments([...targetScan.attachments, nextAttachment]),
        updatedAt: now,
      }
    } else {
      const result: Scan | null = await addScanAttachment(scanId, {
        file: payload.file,
        name: payload.file.name,
        kind: payload.kind,
        slotId: payload.slotId,
        rxType: payload.rxType,
        arch: payload.arch,
        mime: payload.file.type,
        size: payload.file.size,
        url,
        filePath,
        isLocal,
        note: payload.note,
        attachedAt: payload.attachedAt,
      })
      if (!result) return
      nextScan = result
    }

    let detectedSource: Scan['planningDetectedSource'] | undefined
    if (payload.kind === 'projeto') {
      const detected = await parsePlanningTrayCounts(payload.file)
      if (detected) {
        detectedSource = detected.source
        nextScan = {
          ...nextScan,
          planningDetectedUpperTrays: detected.upper ?? nextScan.planningDetectedUpperTrays,
          planningDetectedLowerTrays: detected.lower ?? nextScan.planningDetectedLowerTrays,
          planningDetectedAt: new Date().toISOString(),
          planningDetectedSource: detected.source,
        }
      } else if (payload.file.name.toLowerCase().endsWith('.archform')) {
        const fallbackUpper = nextScan.arch !== 'inferior' ? 15 : undefined
        const fallbackLower = nextScan.arch !== 'superior' ? 15 : undefined
        nextScan = {
          ...nextScan,
          planningDetectedUpperTrays: nextScan.planningDetectedUpperTrays ?? fallbackUpper,
          planningDetectedLowerTrays: nextScan.planningDetectedLowerTrays ?? fallbackLower,
          planningDetectedAt: new Date().toISOString(),
        }
      }
    }

    if (isSupabaseMode && supabase) {
      const nextData = {
        patientName: nextScan.patientName,
        serviceOrderCode: nextScan.serviceOrderCode,
        purposeProductId: nextScan.purposeProductId,
        purposeProductType: nextScan.purposeProductType,
        purposeLabel: nextScan.purposeLabel,
        scanDate: nextScan.scanDate,
        arch: nextScan.arch,
        complaint: nextScan.complaint,
        dentistGuidance: nextScan.dentistGuidance,
        notes: nextScan.notes,
        planningDetectedUpperTrays: nextScan.planningDetectedUpperTrays,
        planningDetectedLowerTrays: nextScan.planningDetectedLowerTrays,
        planningDetectedAt: nextScan.planningDetectedAt,
        planningDetectedSource: nextScan.planningDetectedSource,
        attachments: nextScan.attachments,
        status: nextScan.status,
        linkedCaseId: nextScan.linkedCaseId,
        createdAt: nextScan.createdAt,
        updatedAt: now,
      }
      const { error } = await supabase
        .from('scans')
        .update({ data: nextData, updated_at: now })
        .eq('id', scanId)
      if (error) {
        addToast({ type: 'error', title: `Falha ao salvar anexo: ${error.message}` })
        return
      }
      if (nextScan.linkedCaseId) {
        const { data: caseCurrent, error: caseReadError } = await supabase
          .from('cases')
          .select('id, data')
          .eq('id', nextScan.linkedCaseId)
          .maybeSingle()
        if (!caseReadError && caseCurrent) {
          const caseData = (caseCurrent.data && typeof caseCurrent.data === 'object')
            ? (caseCurrent.data as Record<string, unknown>)
            : {}
          const { error: caseUpdateError } = await supabase
            .from('cases')
            .update({
              data: {
                ...caseData,
                scanFiles: toCaseScanFiles(nextScan.attachments),
                updatedAt: now,
              },
              updated_at: now,
            })
            .eq('id', nextScan.linkedCaseId)
          if (caseUpdateError) {
            addToast({ type: 'error', title: `Falha ao sincronizar arquivos do caso: ${caseUpdateError.message}` })
            return
          }
        }
      }
      setSupabaseRefreshKey((current) => current + 1)
    } else if (payload.kind === 'projeto' && detectedSource) {
      const saved = updateScan(scanId, {
        planningDetectedUpperTrays: nextScan.planningDetectedUpperTrays,
        planningDetectedLowerTrays: nextScan.planningDetectedLowerTrays,
        planningDetectedAt: nextScan.planningDetectedAt,
        planningDetectedSource: nextScan.planningDetectedSource,
        attachments: nextScan.attachments,
      })
      if (saved) nextScan = saved
    }

    setDetails((current) => (current && current.id === scanId ? nextScan : current))
    addToast({ type: 'success', title: 'Novo anexo adicionado ao historico' })
  }

  const flagAttachmentError = (scanId: string, attachmentId: string, reason: string) => {
    if (!canWrite) return
    const result = markScanAttachmentError(scanId, attachmentId, reason)
    if (!result) return
    setDetails((current) => (current && current.id === scanId ? result : current))
    addToast({ type: 'info', title: 'Anexo marcado como erro' })
  }

  const clearAttachmentError = (scanId: string, attachmentId: string) => {
    if (!canWrite) return
    const result = clearScanAttachmentError(scanId, attachmentId)
    if (!result) return
    setDetails((current) => (current && current.id === scanId ? result : current))
    addToast({ type: 'success', title: 'Erro removido do anexo' })
  }

  return (
    <AppShell breadcrumb={['Início', 'Exames']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Exames (Scans)</h1>
          <p className="mt-2 text-sm text-slate-500">Escaneamentos digitais e origem dos tratamentos.</p>
        </div>
        {canWrite ? <Button onClick={() => setCreateOpen(true)}>Novo Exame</Button> : null}
      </section>

      <section className="mt-6">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 p-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por codigo, paciente, O.S ou finalidade"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'todos' | Scan['status'])} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                <option value="todos">Status: Todos</option>
                <option value="pendente">Pendente</option>
                <option value="aprovado">Aprovado</option>
                <option value="reprovado">Reprovado</option>
                <option value="convertido">Convertido</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select value={archFilter} onChange={(event) => setArchFilter(event.target.value as 'todos' | Scan['arch'])} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                  <option value="todos">Arcada: Todas</option>
                  <option value="superior">Superior</option>
                  <option value="inferior">Inferior</option>
                  <option value="ambos">Ambos</option>
                </select>
                <select value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                  <option value="todos">Finalidade: Todas</option>
                  {purposeOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">O.S</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Paciente</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Finalidade</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Data</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Arcada</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Completude</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredScans.map((scan) => {
                  const comp = scanCompleteness(scan)
                  const linkedCaseCode = scan.linkedCaseId ? caseById.get(scan.linkedCaseId)?.treatmentCode : undefined
                  const serviceOrderCode = scan.serviceOrderCode ?? linkedCaseCode ?? '-'
                  return (
                    <tr key={scan.id} className="bg-white">
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">{serviceOrderCode}</td>
                      <td className="px-4 py-4 text-sm font-medium text-slate-900">
                        {scan.patientId ? (patientsById.get(scan.patientId) ?? scan.patientName) : scan.patientName}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">{scan.purposeLabel ?? scan.purposeProductType ?? 'Alinhador'}</td>
                      <td className="px-4 py-4 text-sm text-slate-700">{new Date(`${scan.scanDate}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-4">
                        <Badge tone={archTone(scan.arch)}>{scan.arch}</Badge>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone={statusTone(scan.status)}>{scan.status}</Badge>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        Fotos {comp.photos}/11 • RX {comp.rx}/3
                        <br />
                        STL sup: {comp.stlSup} • STL inf: {comp.stlInf}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {scan.status === 'pendente' ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setDetails(scan)}>
                                Ver
                              </Button>
                              {canApprove ? (
                                <>
                                  <Button size="sm" onClick={() => handleApprove(scan.id)}>
                                    Aprovar
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => handleReject(scan.id)}>
                                    Reprovar
                                  </Button>
                                </>
                              ) : null}
                              {canDelete ? (
                                <Button size="sm" variant="secondary" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(scan)}>
                                  Excluir
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          {scan.status === 'aprovado' ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setDetails(scan)}>
                                Ver
                              </Button>
                              {canCreateCase ? (
                                <Button size="sm" onClick={() => setCreateCaseTarget(scan)}>
                                  Criar Caso
                                </Button>
                              ) : null}
                              {canDelete ? (
                                <Button size="sm" variant="secondary" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(scan)}>
                                  Excluir
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          {scan.status === 'reprovado' ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setDetails(scan)}>
                                Ver
                              </Button>
                              {canDelete ? (
                                <Button size="sm" variant="secondary" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(scan)}>
                                  Excluir
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          {scan.status === 'convertido' ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setDetails(scan)}>
                                Ver
                              </Button>
                              {scan.linkedCaseId ? (
                                <Link to={`/app/cases/${scan.linkedCaseId}`} className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white">
                                  Abrir Caso
                                </Link>
                              ) : null}
                              {canDelete ? (
                                <Button size="sm" variant="secondary" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(scan)}>
                                  Excluir
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filteredScans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum exame encontrado com os filtros atuais.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <ScanModal
        open={createOpen}
        mode="create"
        patients={patientLookupSource}
        dentists={dentists.map((item) => ({ id: item.id, name: item.name, gender: item.gender, clinicId: item.clinicId }))}
        clinics={clinicsForModal}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (payload, options) => {
          if (!canWrite) {
            addToast({ type: 'error', title: 'Sem permissao para criar exames' })
            return false
          }
          if (isSupabaseMode) {
            const created = await createScanSupabase(payload)
            if (!created.ok) {
              addToast({ type: 'error', title: created.error })
              return false
            }
            setSupabaseRefreshKey((current) => current + 1)
            addToast({ type: 'success', title: 'Exame salvo' })
            return true
          }
          await createScan(payload)
          if (options?.setPrimaryDentist && payload.patientId && payload.dentistId) {
            const patient = db.patients.find((item) => item.id === payload.patientId)
            if (patient && !patient.primaryDentistId) {
              updatePatient(patient.id, { primaryDentistId: payload.dentistId })
            }
          }
          addToast({ type: 'success', title: 'Exame salvo' })
          return true
        }}
      />

      <ScanDetailsModal
        open={Boolean(details)}
        scan={details}
        onClose={() => setDetails(null)}
        onApprove={(id) => {
          if (!canApprove) return
          handleApprove(id)
          setDetails((current) => (current ? { ...current, status: 'aprovado' } : current))
        }}
        onReject={(id) => {
          if (!canApprove) return
          handleReject(id)
          setDetails((current) => (current ? { ...current, status: 'reprovado' } : current))
        }}
        onCreateCase={(scan) => setCreateCaseTarget(scan)}
        onAddAttachment={addAttachment}
        onFlagAttachmentError={flagAttachmentError}
        onClearAttachmentError={clearAttachmentError}
      />

      <CreateCaseFromScanModal
        open={Boolean(createCaseTarget)}
        scan={createCaseTarget}
        onClose={() => setCreateCaseTarget(null)}
        onConfirm={(payload) => {
          if (!createCaseTarget) return
          if (!canCreateCase) {
            addToast({ type: 'error', title: 'Sem permissao para criar caso' })
            return
          }
          if (isSupabaseMode) {
            void (async () => {
              const result = await createCaseFromScanSupabase(createCaseTarget, payload)
              if (!result.ok) {
                addToast({ type: 'error', title: 'Nao foi possivel criar o caso', message: result.error })
                return
              }
              setSupabaseRefreshKey((current) => current + 1)
              addToast({ type: 'success', title: 'Caso criado a partir do scan' })
              navigate('/app/cases')
            })()
            return
          }
          const result = createCaseFromScan(createCaseTarget.id, payload)
          if (!result.ok) {
            addToast({ type: 'error', title: 'Nao foi possivel criar o caso', message: result.error })
            return
          }
          addToast({ type: 'success', title: 'Caso criado a partir do scan' })
          navigate(`/app/cases/${result.caseId}`)
        }}
      />
    </AppShell>
  )
}
