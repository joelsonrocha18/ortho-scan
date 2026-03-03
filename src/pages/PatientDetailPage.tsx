import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import AiEditableModal from '../components/ai/AiEditableModal'
import FilePickerWithCamera from '../components/files/FilePickerWithCamera'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import type { Patient } from '../types/Patient'
import type { PatientDocument } from '../types/PatientDocument'
import type { Scan } from '../types/Scan'
import type { Case } from '../types/Case'
import { useDb } from '../lib/useDb'
import { can } from '../auth/permissions'
import { listPatientsForUser } from '../auth/scope'
import { createPatient, getPatient, restorePatient, softDeletePatient, updatePatient } from '../repo/patientRepo'
import {
  addPatientDoc,
  deletePatientDoc,
  listPatientDocs,
  markPatientDocAsError,
  resolvePatientDocUrl,
  restoreDocStatus,
  updatePatientDoc,
} from '../repo/patientDocsRepo'
import { fetchCep, isValidCep, normalizeCep } from '../lib/cep'
import { formatFixedPhone, formatMobilePhone, isValidFixedPhone, isValidMobilePhone } from '../lib/phone'
import { updateScan } from '../data/scanRepo'
import { updateCase } from '../data/caseRepo'
import { getCurrentUser } from '../lib/auth'
import DocumentsList from '../components/documents/DocumentsList'
import { createSignedUrl, validatePatientDocFile } from '../repo/storageRepo'
import { DATA_MODE } from '../data/dataMode'
import { supabase } from '../lib/supabaseClient'
import { patientCode } from '../lib/entityCode'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { runAiEndpoint as runAiRequest } from '../repo/aiRepo'
import { useAiModuleEnabled } from '../lib/useAiModuleEnabled'

type PatientForm = {
  name: string
  cpf: string
  birthDate: string
  gender: 'masculino' | 'feminino' | 'outro'
  phone: string
  whatsapp: string
  email: string
  address: {
    cep: string
    street: string
    number: string
    district: string
    city: string
    state: string
  }
  primaryDentistId: string
  clinicId: string
  notes: string
}

type DocumentForm = {
  title: string
  category: PatientDocument['category']
  note: string
  date: string
  file: File | null
}

const emptyForm: PatientForm = {
  name: '',
  cpf: '',
  birthDate: '',
  gender: 'outro',
  phone: '',
  whatsapp: '',
  email: '',
  address: {
    cep: '',
    street: '',
    number: '',
    district: '',
    city: '',
    state: '',
  },
  primaryDentistId: '',
  clinicId: '',
  notes: '',
}

const emptyDocForm: DocumentForm = {
  title: '',
  category: 'outro',
  note: '',
  date: new Date().toISOString().slice(0, 10),
  file: null,
}

function fileExt(name: string | undefined) {
  const value = (name ?? '').toLowerCase()
  const idx = value.lastIndexOf('.')
  return idx >= 0 ? value.slice(idx) : ''
}

function isImageDoc(doc: PatientDocument) {
  const mt = (doc.mimeType ?? '').toLowerCase()
  const ext = fileExt(doc.fileName)
  return mt.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.heic', '.webp'].includes(ext)
}

function isPdfDoc(doc: PatientDocument) {
  const mt = (doc.mimeType ?? '').toLowerCase()
  const ext = fileExt(doc.fileName)
  return mt.includes('pdf') || ext === '.pdf'
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  const p1 = digits.slice(0, 3)
  const p2 = digits.slice(3, 6)
  const p3 = digits.slice(6, 9)
  const p4 = digits.slice(9, 11)
  let out = p1
  if (p2) out += `.${p2}`
  if (p3) out += `.${p3}`
  if (p4) out += `-${p4}`
  return out
}

function normalizeWhatsapp(value: string) {
  return value.replace(/\D/g, '')
}

function isImageFile(name?: string, mime?: string) {
  const fileName = (name ?? '').toLowerCase()
  const contentType = (mime ?? '').toLowerCase()
  if (contentType.startsWith('image/')) return true
  return ['.jpg', '.jpeg', '.png', '.heic', '.webp'].some((ext) => fileName.endsWith(ext))
}

type OrthocamMediaItem = {
  id: string
  previewKey: string
  source: 'scan' | 'document'
  date: string
  dateKey: string
  title: string
  subtitle: string
  url?: string
  filePath?: string
  canPreview: boolean
}

type StructuredPatientDocSlot = {
  id: string
  label: string
  category: PatientDocument['category']
  accept: string
}

const STRUCTURED_PATIENT_DOC_SECTIONS: Array<{ title: string; slots: StructuredPatientDocSlot[] }> = [
  {
    title: 'Scan 3D',
    slots: [
      { id: 'scan3d_superior', label: 'Superior (.stl, .obj, .ply)', category: 'exame', accept: '.stl,.obj,.ply,model/stl,application/sla,application/octet-stream' },
      { id: 'scan3d_inferior', label: 'Inferior (.stl, .obj, .ply)', category: 'exame', accept: '.stl,.obj,.ply,model/stl,application/sla,application/octet-stream' },
      { id: 'scan3d_mordida', label: 'Mordida (.stl, .obj, .ply)', category: 'exame', accept: '.stl,.obj,.ply,model/stl,application/sla,application/octet-stream' },
    ],
  },
  {
    title: 'Fotos Intraorais',
    slots: [
      { id: 'foto_intra_frontal', label: 'Intraoral - Frontal', category: 'foto', accept: 'image/*' },
      { id: 'foto_intra_lateral_direita', label: 'Intraoral - Lateral direita', category: 'foto', accept: 'image/*' },
      { id: 'foto_intra_lateral_esquerda', label: 'Intraoral - Lateral esquerda', category: 'foto', accept: 'image/*' },
      { id: 'foto_intra_oclusal_superior', label: 'Intraoral - Oclusal superior', category: 'foto', accept: 'image/*' },
      { id: 'foto_intra_oclusal_inferior', label: 'Intraoral - Oclusal inferior', category: 'foto', accept: 'image/*' },
    ],
  },
  {
    title: 'Fotos Extraorais',
    slots: [
      { id: 'foto_extra_face_frontal', label: 'Extraoral - Face frontal', category: 'foto', accept: 'image/*' },
      { id: 'foto_extra_face_lateral_direita', label: 'Extraoral - Face lateral direita', category: 'foto', accept: 'image/*' },
      { id: 'foto_extra_face_lateral_esquerda', label: 'Extraoral - Face lateral esquerda', category: 'foto', accept: 'image/*' },
      { id: 'foto_extra_diagonal_direita_3_4', label: 'Extraoral - Diagonal direita (3/4)', category: 'foto', accept: 'image/*' },
      { id: 'foto_extra_diagonal_esquerda_3_4', label: 'Extraoral - Diagonal esquerda (3/4)', category: 'foto', accept: 'image/*' },
      { id: 'foto_extra_sorriso_frontal', label: 'Extraoral - Sorriso frontal', category: 'foto', accept: 'image/*' },
    ],
  },
  {
    title: 'Radiografias',
    slots: [
      { id: 'rx_panoramica', label: 'Panoramica', category: 'exame', accept: '.pdf,.jpg,.jpeg,.png,image/*,application/pdf' },
      { id: 'rx_teleradiografia', label: 'Teleradiografia', category: 'exame', accept: '.pdf,.jpg,.jpeg,.png,image/*,application/pdf' },
      { id: 'rx_tomografia', label: 'Tomografia / DICOM', category: 'exame', accept: '.zip,.dcm,.pdf,.jpg,.jpeg,.png,image/*,application/pdf,application/zip' },
    ],
  },
  {
    title: 'Planejamento',
    slots: [
      { id: 'planejamento', label: 'Planejamento', category: 'exame', accept: '.pdf,.zip,.stl,.obj,.ply,application/pdf,application/zip' },
    ],
  },
]

function structuredSlotTag(slotId: string) {
  return `[slot:${slotId}]`
}

function safeText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function hasStructuredSlotTag(note: unknown, slotId: string) {
  return safeText(note).includes(structuredSlotTag(slotId))
}

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'patients.write')
  const canDelete = can(currentUser, 'patients.delete')
  const aiClinicaEnabled = useAiModuleEnabled('clinica')
  const canAiClinica = can(currentUser, 'ai.clinica') && aiClinicaEnabled
  const canDeleteByRole = currentUser?.role === 'master_admin' || currentUser?.role === 'dentist_admin'
  const canDeletePatient = canDelete && canDeleteByRole
  const isExternalUser = currentUser?.role === 'dentist_client' || currentUser?.role === 'clinic_client'
  const canDocsWrite = can(currentUser, 'docs.write')
  const canDocsAdmin = currentUser?.role === 'master_admin' || currentUser?.role === 'dentist_admin' || currentUser?.role === 'receptionist'
  const isSupabaseMode = DATA_MODE === 'supabase'
  const supabaseSyncTick = useSupabaseSyncTick()
  const isNew = params.id === 'new'
  const localExisting = useMemo(() => (!isNew && params.id ? getPatient(params.id) : null), [isNew, params.id])
  const [supabaseExisting, setSupabaseExisting] = useState<Patient | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const existing = isSupabaseMode ? supabaseExisting : localExisting
  const scopedPatients = useMemo(() => listPatientsForUser(db, currentUser), [db, currentUser])

  const [form, setForm] = useState<PatientForm>(emptyForm)
  const [error, setError] = useState('')
  const [docModalOpen, setDocModalOpen] = useState(false)
  const [docForm, setDocForm] = useState<DocumentForm>(emptyDocForm)
  const [docEditOpen, setDocEditOpen] = useState(false)
  const [docEditId, setDocEditId] = useState<string>('')
  const [docPreviewUrls, setDocPreviewUrls] = useState<Record<string, string>>({})
  const [orthocamPreviewUrls, setOrthocamPreviewUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ open: boolean; title: string; url: string }>({ open: false, title: '', url: '' })
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiModalTitle, setAiModalTitle] = useState('')
  const [aiDraft, setAiDraft] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')

  const [supabaseDentists, setSupabaseDentists] = useState<Array<{
    id: string
    name: string
    gender?: 'masculino' | 'feminino'
    whatsapp?: string
    clinicId?: string
  }>>([])
  const [supabaseClinics, setSupabaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const [supabasePatientScans, setSupabasePatientScans] = useState<Scan[]>([])
  const [supabasePatientCases, setSupabasePatientCases] = useState<Case[]>([])
  const dentists = useMemo(
    () =>
      isSupabaseMode
        ? supabaseDentists
        : db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt),
    [db.dentists, isSupabaseMode, supabaseDentists],
  )
  const clinics = useMemo(
    () => (isSupabaseMode ? supabaseClinics : db.clinics.filter((item) => !item.deletedAt)),
    [db.clinics, isSupabaseMode, supabaseClinics],
  )
  const [docs, setDocs] = useState<PatientDocument[]>([])
  const [slotUploadBusy, setSlotUploadBusy] = useState('')

  useEffect(() => {
    if (!isSupabaseMode || !supabase) return
    let active = true
    void (async () => {
      const [clinicsRes, dentistsRes] = await Promise.all([
        supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null),
        supabase.from('dentists').select('id, name, gender, whatsapp, clinic_id, deleted_at').is('deleted_at', null),
      ])
      if (!active) return
      setSupabaseClinics(
        ((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => ({
          id: row.id,
          tradeName: row.trade_name ?? '-',
        })),
      )
      setSupabaseDentists(
        ((dentistsRes.data ?? []) as Array<{ id: string; name?: string; gender?: string; whatsapp?: string; clinic_id?: string }>).map((row) => ({
          id: row.id,
          name: row.name ?? '-',
          gender: row.gender === 'feminino' ? 'feminino' : 'masculino',
          whatsapp: row.whatsapp ?? undefined,
          clinicId: row.clinic_id ?? undefined,
        })),
      )
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode || !supabase || isNew || !params.id) {
      setSupabaseExisting(null)
      setLoadingExisting(false)
      return
    }
    let active = true
    setLoadingExisting(true)
    void (async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('id, short_id, name, cpf, phone, whatsapp, clinic_id, primary_dentist_id, birth_date, gender, email, address, notes, deleted_at, created_at, updated_at')
        .eq('id', params.id)
        .maybeSingle()
      if (!active) return
      if (error || !data) {
        setSupabaseExisting(null)
        setLoadingExisting(false)
        return
      }
      const address = data.address && typeof data.address === 'object'
        ? (data.address as Record<string, unknown>)
        : {}
      const mapped: Patient = {
        id: String(data.id),
        shortId: (data.short_id as string | null) ?? undefined,
        name: String(data.name ?? ''),
        cpf: (data.cpf as string | null) ?? undefined,
        phone: (data.phone as string | null) ?? undefined,
        whatsapp: (data.whatsapp as string | null) ?? undefined,
        email: (data.email as string | null) ?? undefined,
        birthDate: (data.birth_date as string | null) ?? undefined,
        gender: ((data.gender as string | null) as Patient['gender']) ?? 'outro',
        clinicId: (data.clinic_id as string | null) ?? undefined,
        primaryDentistId: (data.primary_dentist_id as string | null) ?? undefined,
        address: {
          cep: (address.cep as string | undefined) ?? undefined,
          street: (address.street as string | undefined) ?? undefined,
          number: (address.number as string | undefined) ?? undefined,
          district: (address.district as string | undefined) ?? undefined,
          city: (address.city as string | undefined) ?? undefined,
          state: (address.state as string | undefined) ?? undefined,
        },
        notes: (data.notes as string | null) ?? undefined,
        createdAt: (data.created_at as string | undefined) ?? new Date().toISOString(),
        updatedAt: (data.updated_at as string | undefined) ?? new Date().toISOString(),
        deletedAt: (data.deleted_at as string | null) ?? undefined,
      }
      setSupabaseExisting(mapped)
      setLoadingExisting(false)
    })()
    return () => {
      active = false
    }
  }, [isNew, isSupabaseMode, params.id, supabaseSyncTick])

  const scans = useMemo(() => {
    if (!existing) return []
    if (isSupabaseMode) return supabasePatientScans
    const name = existing.name.toLowerCase()
    return db.scans.filter(
      (scan) =>
        (scan.patientId && scan.patientId === existing.id) ||
        (!scan.patientId && scan.patientName.toLowerCase() === name),
    )
  }, [db.scans, existing, isSupabaseMode, supabasePatientScans])

  const cases = useMemo(() => {
    if (!existing) return []
    if (isSupabaseMode) return supabasePatientCases
    const name = existing.name.toLowerCase()
    return db.cases.filter(
      (caseItem) =>
        (caseItem.patientId && caseItem.patientId === existing.id) ||
        (!caseItem.patientId && caseItem.patientName.toLowerCase() === name),
    )
  }, [db.cases, existing, isSupabaseMode, supabasePatientCases])
  const relatedAuditEvents = useMemo(() => {
    if (!existing) return []
    const scanIds = new Set(scans.map((item) => item.id))
    const caseIds = new Set(cases.map((item) => item.id))
    const labIds = new Set(
      db.labItems
        .filter((item) => item.caseId && caseIds.has(item.caseId))
        .map((item) => item.id),
    )
    return (db.auditLogs ?? [])
      .filter((log) => {
        if (log.entity === 'patient' && log.entityId === existing.id) return true
        if (log.entity === 'scan' && scanIds.has(log.entityId)) return true
        if (log.entity === 'case' && caseIds.has(log.entityId)) return true
        if (log.entity === 'lab' && labIds.has(log.entityId)) return true
        return false
      })
      .slice(0, 20)
  }, [cases, db.auditLogs, db.labItems, existing, scans])

  const orthocamMedia = useMemo<OrthocamMediaItem[]>(() => {
    const scanItems: OrthocamMediaItem[] = scans.flatMap((scan) =>
      (scan.attachments ?? [])
        .filter((att) => att.kind !== 'scan3d')
        .map((att) => {
          const dateValue = att.attachedAt ?? att.createdAt ?? `${scan.scanDate}T00:00:00`
          const dateKey = String(dateValue).slice(0, 10)
          return {
            id: att.id,
            previewKey: `scan_${att.id}`,
            source: 'scan',
            date: dateValue,
            dateKey,
            title: att.name,
            subtitle: `${scan.serviceOrderCode ?? scan.id} • ${att.kind}`,
            url: att.url,
            filePath: att.filePath,
            canPreview: isImageFile(att.name, att.mime),
          }
        }),
    )

    const docItems: OrthocamMediaItem[] = docs
      .filter((doc) => doc.category === 'foto' || doc.category === 'exame')
      .map((doc) => ({
        id: doc.id,
        previewKey: `doc_${doc.id}`,
        source: 'document',
        date: doc.createdAt,
        dateKey: doc.createdAt.slice(0, 10),
        title: doc.title,
        subtitle: `${doc.category} • ${doc.fileName}`,
        url: docPreviewUrls[doc.id] ?? doc.url,
        filePath: doc.filePath,
        canPreview: isImageFile(doc.fileName, doc.mimeType),
      }))

    return [...scanItems, ...docItems].sort((a, b) => b.date.localeCompare(a.date))
  }, [docs, docPreviewUrls, scans])

  const orthocamMediaByDate = useMemo(() => {
    const groups = new Map<string, OrthocamMediaItem[]>()
    orthocamMedia.forEach((item) => {
      const bucket = groups.get(item.dateKey) ?? []
      bucket.push(item)
      groups.set(item.dateKey, bucket)
    })
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [orthocamMedia])

  useEffect(() => {
    if (!existing) {
      setForm(emptyForm)
      return
    }
    setForm({
      name: existing.name,
      cpf: existing.cpf ?? '',
      birthDate: existing.birthDate ?? '',
      gender: existing.gender ?? 'outro',
      phone: existing.phone ?? '',
      whatsapp: existing.whatsapp ?? '',
      email: existing.email ?? '',
      address: {
        cep: existing.address?.cep ?? '',
        street: existing.address?.street ?? '',
        number: existing.address?.number ?? '',
        district: existing.address?.district ?? '',
        city: existing.address?.city ?? '',
        state: existing.address?.state ?? '',
      },
      primaryDentistId: existing.primaryDentistId ?? '',
      clinicId: existing.clinicId ?? '',
      notes: existing.notes ?? '',
    })
  }, [existing])

  useEffect(() => {
    let active = true
    if (!existing) {
      setDocs([])
      return
    }
    listPatientDocs(existing.id).then((items) => {
      if (!active) return
      setDocs(items)
    })
    return () => {
      active = false
    }
  }, [existing, db.patientDocuments, db.clinics, db.scans])

  useEffect(() => {
    if (!isSupabaseMode || !supabase || !existing) {
      setSupabasePatientScans([])
      setSupabasePatientCases([])
      return
    }
    let active = true
    void (async () => {
      const [scansByPatientRes, scansByNameRes, casesByPatientRes, casesByNameRes] = await Promise.all([
        supabase
          .from('scans')
          .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, created_at, updated_at, data')
          .eq('patient_id', existing.id)
          .is('deleted_at', null),
        supabase
          .from('scans')
          .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, created_at, updated_at, data')
          .is('patient_id', null)
          .eq('data->>patientName', existing.name)
          .is('deleted_at', null),
        supabase
          .from('cases')
          .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, status, created_at, updated_at, data')
          .eq('patient_id', existing.id)
          .is('deleted_at', null),
        supabase
          .from('cases')
          .select('id, clinic_id, patient_id, dentist_id, requested_by_dentist_id, status, created_at, updated_at, data')
          .is('patient_id', null)
          .eq('data->>patientName', existing.name)
          .is('deleted_at', null),
      ])
      if (!active) return

      const scansRaw = [
        ...((scansByPatientRes.data ?? []) as Array<Record<string, unknown>>),
        ...((scansByNameRes.data ?? []) as Array<Record<string, unknown>>),
      ]
      const scansMap = new Map<string, Scan>()
      scansRaw.forEach((row) => {
        const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {}
        scansMap.set(String(row.id), {
          id: String(row.id),
          clinicId: (row.clinic_id as string | undefined) ?? undefined,
          patientId: (row.patient_id as string | undefined) ?? undefined,
          dentistId: (row.dentist_id as string | undefined) ?? undefined,
          requestedByDentistId: (row.requested_by_dentist_id as string | undefined) ?? undefined,
          patientName: String(data.patientName ?? existing.name),
          purposeProductId: data.purposeProductId as string | undefined,
          purposeProductType: data.purposeProductType as string | undefined,
          purposeLabel: data.purposeLabel as string | undefined,
          serviceOrderCode: data.serviceOrderCode as string | undefined,
          scanDate: String(data.scanDate ?? String(row.created_at ?? '').slice(0, 10)),
          arch: (data.arch as Scan['arch'] | undefined) ?? 'ambos',
          complaint: data.complaint as string | undefined,
          dentistGuidance: data.dentistGuidance as string | undefined,
          notes: data.notes as string | undefined,
          planningDetectedUpperTrays: data.planningDetectedUpperTrays as number | undefined,
          planningDetectedLowerTrays: data.planningDetectedLowerTrays as number | undefined,
          planningDetectedAt: data.planningDetectedAt as string | undefined,
          planningDetectedSource: data.planningDetectedSource as Scan['planningDetectedSource'] | undefined,
          attachments: (Array.isArray(data.attachments) ? data.attachments : []) as Scan['attachments'],
          status: (data.status as Scan['status'] | undefined) ?? 'pendente',
          linkedCaseId: data.linkedCaseId as string | undefined,
          createdAt: String(data.createdAt ?? row.created_at ?? new Date().toISOString()),
          updatedAt: String(data.updatedAt ?? row.updated_at ?? new Date().toISOString()),
        })
      })
      setSupabasePatientScans(Array.from(scansMap.values()).sort((a, b) => b.scanDate.localeCompare(a.scanDate)))

      const casesRaw = [
        ...((casesByPatientRes.data ?? []) as Array<Record<string, unknown>>),
        ...((casesByNameRes.data ?? []) as Array<Record<string, unknown>>),
      ]
      const casesMap = new Map<string, Case>()
      casesRaw.forEach((row) => {
        const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {}
        casesMap.set(String(row.id), {
          id: String(row.id),
          productType: data.productType as Case['productType'],
          productId: data.productId as Case['productId'],
          treatmentCode: data.treatmentCode as string | undefined,
          treatmentOrigin: (data.treatmentOrigin as Case['treatmentOrigin']) ?? 'externo',
          patientName: String(data.patientName ?? existing.name),
          patientId: (row.patient_id as string | undefined) ?? undefined,
          dentistId: (row.dentist_id as string | undefined) ?? undefined,
          requestedByDentistId: (row.requested_by_dentist_id as string | undefined) ?? undefined,
          clinicId: (row.clinic_id as string | undefined) ?? undefined,
          scanDate: String(data.scanDate ?? String(row.created_at ?? '').slice(0, 10)),
          totalTrays: Number(data.totalTrays ?? 0),
          changeEveryDays: Number(data.changeEveryDays ?? 0),
          totalTraysUpper: data.totalTraysUpper as number | undefined,
          totalTraysLower: data.totalTraysLower as number | undefined,
          attachmentBondingTray: Boolean(data.attachmentBondingTray),
          status: (data.status as Case['status']) ?? (row.status as Case['status']) ?? 'planejamento',
          phase: (data.phase as Case['phase']) ?? 'planejamento',
          budget: data.budget as Case['budget'],
          contract: data.contract as Case['contract'],
          deliveryLots: (data.deliveryLots as Case['deliveryLots']) ?? [],
          installation: data.installation as Case['installation'],
          trays: (data.trays as Case['trays']) ?? [],
          attachments: (data.attachments as Case['attachments']) ?? [],
          sourceScanId: data.sourceScanId as string | undefined,
          arch: (data.arch as Case['arch']) ?? 'ambos',
          complaint: data.complaint as string | undefined,
          dentistGuidance: data.dentistGuidance as string | undefined,
          scanFiles: data.scanFiles as Case['scanFiles'],
          createdAt: String(data.createdAt ?? row.created_at ?? new Date().toISOString()),
          updatedAt: String(data.updatedAt ?? row.updated_at ?? new Date().toISOString()),
        })
      })
      setSupabasePatientCases(Array.from(casesMap.values()))
    })()
    return () => {
      active = false
    }
  }, [existing, isSupabaseMode, supabaseSyncTick])

  useEffect(() => {
    let active = true
    if (docs.length === 0) {
      setDocPreviewUrls({})
      return
    }

    const previewableDocs = docs.filter((doc) => isImageDoc(doc) || isPdfDoc(doc))
    if (previewableDocs.length === 0) {
      setDocPreviewUrls({})
      return
    }

    void (async () => {
      const entries = await Promise.all(
        previewableDocs.map(async (doc) => {
          if (doc.url) return [doc.id, doc.url] as const
          const resolved = await resolvePatientDocUrl(doc)
          return resolved.ok ? ([doc.id, resolved.url] as const) : null
        }),
      )
      if (!active) return
      const next: Record<string, string> = {}
      entries.forEach((item) => {
        if (!item) return
        next[item[0]] = item[1]
      })
      setDocPreviewUrls(next)
    })()

    return () => {
      active = false
    }
  }, [docs])

  useEffect(() => {
    let active = true
    if (orthocamMedia.length === 0) {
      setOrthocamPreviewUrls({})
      return
    }

    void (async () => {
      const entries = await Promise.all(
        orthocamMedia.map(async (item) => {
          if (item.url) return [item.previewKey, item.url] as const
          if (!item.filePath) return null
          const signed = await createSignedUrl(item.filePath, 300)
          return signed.ok ? ([item.previewKey, signed.url] as const) : null
        }),
      )
      if (!active) return
      const next: Record<string, string> = {}
      entries.forEach((entry) => {
        if (!entry) return
        next[entry[0]] = entry[1]
      })
      setOrthocamPreviewUrls(next)
    })()

    return () => {
      active = false
    }
  }, [orthocamMedia])

  useEffect(() => {
    const cep = normalizeCep(form.address.cep)
    if (!isValidCep(cep)) {
      setCepStatus('')
      setCepError('')
      return
    }

    let active = true
    fetchCep(cep)
      .then((data) => {
        if (!active) return
        setForm((current) => ({
          ...current,
          address: {
            ...current.address,
            street: data.street || current.address.street,
            district: data.district || current.address.district,
            city: data.city || current.address.city,
            state: data.state || current.address.state,
          },
        }))
        setCepStatus('Endereço preenchido automaticamente.')
        setCepError('')
      })
      .catch((err: Error) => {
        if (!active) return
        setCepStatus('')
        setCepError(err.message || 'CEP não encontrado.')
      })

    return () => {
      active = false
    }
  }, [form.address.cep])

  if (!isSupabaseMode && !isNew && existing && !scopedPatients.some((item) => item.id === existing.id)) {
    return (
      <AppShell breadcrumb={['Inicio', 'Pacientes']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Sem acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Seu perfil nao permite visualizar este paciente.</p>
          <Link to="/app/patients" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para pacientes
          </Link>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && loadingExisting) {
    return (
      <AppShell breadcrumb={['Inicio', 'Pacientes']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Carregando paciente...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing && !loadingExisting) {
    return (
      <AppShell breadcrumb={['Inicio', 'Pacientes']}>
        <Card>
          <h1 className="text-xl font-semibold text-slate-900">Paciente não encontrado</h1>
          <Link to="/app/patients" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para pacientes
          </Link>
        </Card>
      </AppShell>
    )
  }

  const selectedDentist = dentists.find((item) => item.id === form.primaryDentistId)
  const dentistPrefix = selectedDentist?.gender === 'feminino' ? 'Dra.' : selectedDentist ? 'Dr.' : ''
  const dentistWhatsappDigits = normalizeWhatsapp(selectedDentist?.whatsapp ?? '')
  const dentistWhatsappValid = dentistWhatsappDigits.length === 10 || dentistWhatsappDigits.length === 11

  const savePatient = async () => {
    if (!canWrite) {
      setError('Sem permissao para editar pacientes.')
      return
    }
    if (!form.name.trim()) {
      setError('Nome e obrigatorio.')
      return
    }
    if (!form.birthDate) {
      setError('Data de nascimento e obrigatoria.')
      return
    }
    if (form.phone.trim() && !isValidFixedPhone(form.phone)) {
      setError('Telefone fixo invalido.')
      return
    }
    if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) {
      setError('Celular/WhatsApp invalido.')
      return
    }

    const payload: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> = {
      name: form.name.trim(),
      cpf: form.cpf.trim() || undefined,
      birthDate: form.birthDate,
      gender: form.gender,
      phone: form.phone.trim() || undefined,
      whatsapp: form.whatsapp.trim() || undefined,
      email: form.email.trim() || undefined,
      address: {
        cep: form.address.cep.trim() || undefined,
        street: form.address.street.trim() || undefined,
        number: form.address.number.trim() || undefined,
        district: form.address.district.trim() || undefined,
        city: form.address.city.trim() || undefined,
        state: form.address.state.trim() || undefined,
      },
      primaryDentistId: form.primaryDentistId || undefined,
      clinicId: form.clinicId || undefined,
      notes: form.notes.trim() || undefined,
    }

    if (currentUser?.role === 'dentist_client') {
      if (!currentUser.linkedDentistId) {
        setError('Perfil externo sem dentista vinculado. Contate o administrador.')
        return
      }
      payload.primaryDentistId = currentUser.linkedDentistId
      payload.clinicId = currentUser.linkedClinicId || payload.clinicId
    }
    if (currentUser?.role === 'clinic_client') {
      if (!currentUser.linkedClinicId) {
        setError('Perfil externo sem clinica vinculada. Contate o administrador.')
        return
      }
      payload.clinicId = currentUser.linkedClinicId
    }

    if (isSupabaseMode && supabase) {
      const supabasePayload = {
        name: payload.name,
        cpf: payload.cpf ?? null,
        phone: payload.phone ?? null,
        whatsapp: payload.whatsapp ?? null,
        clinic_id: payload.clinicId ?? null,
        primary_dentist_id: payload.primaryDentistId ?? null,
        birth_date: payload.birthDate,
        gender: payload.gender ?? null,
        email: payload.email ?? null,
        address: payload.address ?? null,
        notes: payload.notes ?? null,
      }
      if (isNew) {
        const { data, error: createError } = await supabase
          .from('patients')
          .insert(supabasePayload)
          .select('id')
          .single()
        if (createError || !data?.id) {
          setError(createError?.message ?? 'Falha ao criar paciente.')
          return
        }
        navigate(`/app/patients/${data.id as string}`, { replace: true })
        return
      }
      if (!existing) return
      const { error: updateError } = await supabase
        .from('patients')
        .update({ ...supabasePayload, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setError('')
      return
    }

    if (isNew) {
      const result = createPatient(payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      navigate(`/app/patients/${result.patient.id}`, { replace: true })
      return
    }

    if (!existing) return
    const result = updatePatient(existing.id, payload)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDeletePatient) {
      setError('Somente Master Admin ou Dentista Admin podem excluir paciente.')
      return
    }
    const confirmed = window.confirm('Tem certeza que deseja excluir este paciente?')
    if (!confirmed) return
    if (isSupabaseMode && supabase) {
      const { error: deleteError } = await supabase
        .from('patients')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (deleteError) {
        setError(deleteError.message)
        return
      }
    } else {
      const result = softDeletePatient(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
    }
    setError('')
    navigate('/app/patients', { replace: true })
  }

  const handleRestore = async () => {
    if (!existing) return
    if (!canDeletePatient) return
    if (isSupabaseMode && supabase) {
      const { error: restoreError } = await supabase
        .from('patients')
        .update({ deleted_at: null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (restoreError) {
        setError(restoreError.message)
        return
      }
      setSupabaseExisting((current) => (current ? { ...current, deletedAt: undefined } : current))
      return
    }
    restorePatient(existing.id)
  }

  const handleLinkByName = async () => {
    if (!existing) return
    if (!canWrite) return
    if (isSupabaseMode && supabase) {
      const now = new Date().toISOString()
      const [scanRes, caseRes] = await Promise.all([
        supabase
          .from('scans')
          .update({ patient_id: existing.id, updated_at: now })
          .is('patient_id', null)
          .eq('data->>patientName', existing.name)
          .is('deleted_at', null),
        supabase
          .from('cases')
          .update({ patient_id: existing.id, updated_at: now })
          .is('patient_id', null)
          .eq('data->>patientName', existing.name)
          .is('deleted_at', null),
      ])
      if (scanRes.error || caseRes.error) {
        setError(scanRes.error?.message ?? caseRes.error?.message ?? 'Falha ao vincular registros.')
        return
      }
      setError('')
      setSupabasePatientScans((current) => current.map((scan) => ({ ...scan, patientId: existing.id })))
      setSupabasePatientCases((current) => current.map((caseItem) => ({ ...caseItem, patientId: existing.id })))
      return
    }
    const name = existing.name.toLowerCase()
    const scansToUpdate = db.scans.filter((scan) => !scan.patientId && scan.patientName.toLowerCase() === name)
    const casesToUpdate = db.cases.filter((caseItem) => !caseItem.patientId && caseItem.patientName.toLowerCase() === name)
    scansToUpdate.forEach((scan) => updateScan(scan.id, { patientId: existing.id }))
    casesToUpdate.forEach((caseItem) => updateCase(caseItem.id, { patientId: existing.id }))
    if (scansToUpdate.length || casesToUpdate.length) {
      setError('')
    }
  }

  const submitDoc = async () => {
    if (!existing) return
    if (!canDocsWrite) {
      setError('Sem permissao para anexar documentos.')
      return
    }
    if (!docForm.title.trim()) {
      setError('Informe o titulo do documento.')
      return
    }
    if (docForm.file) {
      const valid = validatePatientDocFile(docForm.file)
      if (!valid.ok) {
        setError(valid.error)
        return
      }
    }
    const result = await addPatientDoc({
      patientId: existing.id,
      clinicId: existing.clinicId ?? (form.clinicId || undefined),
      title: docForm.title,
      category: docForm.category,
      note: docForm.note,
      createdAt: docForm.date,
      file: docForm.file ?? undefined,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDocForm({ ...emptyDocForm, date: new Date().toISOString().slice(0, 10) })
    setDocModalOpen(false)
    setError('')
    const items = await listPatientDocs(existing.id)
    setDocs(items)
  }

  const structuredDocsBySlot = useMemo(() => {
    const map = new Map<string, PatientDocument>()
    STRUCTURED_PATIENT_DOC_SECTIONS.flatMap((section) => section.slots).forEach((slot) => {
      const found = docs
        .filter((doc) => hasStructuredSlotTag(doc.note, slot.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      if (found) map.set(slot.id, found)
    })
    return map
  }, [docs])

  const uploadStructuredSlot = async (slot: StructuredPatientDocSlot, file: File) => {
    if (!existing) {
      setError('Salve o cadastro do paciente antes de anexar arquivos.')
      return
    }
    if (!canDocsWrite) {
      setError('Sem permissao para anexar documentos.')
      return
    }
    const valid = validatePatientDocFile(file)
    if (!valid.ok) {
      setError(valid.error)
      return
    }
    setSlotUploadBusy(slot.id)
    const existingTaggedNote = safeText(structuredDocsBySlot.get(slot.id)?.note)
    const mergedNote = `${existingTaggedNote.replace(structuredSlotTag(slot.id), '').trim()}\n${structuredSlotTag(slot.id)}`
      .trim()
    const result = await addPatientDoc({
      patientId: existing.id,
      clinicId: existing.clinicId ?? (form.clinicId || undefined),
      title: slot.label,
      category: slot.category,
      note: mergedNote,
      createdAt: new Date().toISOString().slice(0, 10),
      file,
    })
    setSlotUploadBusy('')
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    const items = await listPatientDocs(existing.id)
    setDocs(items)
  }

  const acceptDocs =
    '.pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*'

  const openDoc = async (doc: PatientDocument) => {
    const resolved = await resolvePatientDocUrl(doc)
    if (!resolved.ok) return
    if (isImageDoc(doc)) {
      setLightbox({ open: true, title: doc.title, url: resolved.url })
      return
    }
    window.open(resolved.url, '_blank', 'noreferrer')
  }

  const openOrthocamItem = (item: OrthocamMediaItem) => {
    const resolvedUrl = orthocamPreviewUrls[item.previewKey]
    if (!resolvedUrl) return
    if (item.canPreview) {
      setLightbox({ open: true, title: item.title, url: resolvedUrl })
      return
    }
    window.open(resolvedUrl, '_blank', 'noreferrer')
  }

  const downloadDoc = async (doc: PatientDocument) => {
    const resolved = await resolvePatientDocUrl(doc)
    if (!resolved.ok) return
    const anchor = document.createElement('a')
    anchor.href = resolved.url
    anchor.download = doc.fileName || 'arquivo'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const beginEditDoc = (doc: PatientDocument) => {
    setDocEditId(doc.id)
    setDocForm({
      title: doc.title,
      category: doc.category,
      note: doc.note ?? '',
      date: doc.createdAt.slice(0, 10),
      file: null,
    })
    setDocEditOpen(true)
  }

  const submitDocEdit = async () => {
    if (!docEditId) return
    if (!canDocsAdmin) {
      setError('Sem permissao para editar documentos.')
      return
    }
    if (!docForm.title.trim()) {
      setError('Informe o titulo do documento.')
      return
    }

    const result = await updatePatientDoc(docEditId, {
      title: docForm.title,
      category: docForm.category,
      note: docForm.note,
      createdAt: docForm.date ? new Date(docForm.date).toISOString() : undefined,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    setDocEditOpen(false)
    setDocEditId('')
    setDocForm({ ...emptyDocForm, date: new Date().toISOString().slice(0, 10) })
    if (existing) {
      const items = await listPatientDocs(existing.id)
      setDocs(items)
    }
  }

  const deleteDoc = async (doc: PatientDocument) => {
    if (!canDocsAdmin) return
    const ok = window.confirm(`Excluir o documento "${doc.title}"? Essa acao nao pode ser desfeita.`)
    if (!ok) return
    const result = await deletePatientDoc(doc.id)
    if (!result.ok) setError(result.error)
    if (existing) {
      const items = await listPatientDocs(existing.id)
      setDocs(items)
    }
  }

  const runClinicaAi = async (endpoint: '/clinica/resumo' | '/clinica/plano' | '/clinica/evolucao', title: string) => {
    if (!canAiClinica || !existing) return
    const inputText = [
      `Paciente: ${existing.name}`,
      `Nascimento: ${existing.birthDate ?? '-'}`,
      `Observacoes: ${form.notes || '-'}`,
      `Scans vinculados: ${scans.length}`,
      `Casos vinculados: ${cases.length}`,
    ].join('\n')
    setAiLoading(true)
    setAiModalTitle(title)
    const result = await runAiRequest(endpoint, {
      clinicId: form.clinicId || existing.clinicId,
      inputText,
      metadata: {
        patientId: existing.id,
        primaryDentistId: existing.primaryDentistId,
        scans: scans.map((item) => ({ id: item.id, scanDate: item.scanDate, status: item.status, arch: item.arch })).slice(0, 8),
        cases: cases.map((item) => ({ id: item.id, treatmentCode: item.treatmentCode, status: item.status, phase: item.phase })).slice(0, 8),
      },
    })
    setAiLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setAiDraft(result.output)
    setAiModalOpen(true)
    setError('')
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Pacientes', isNew ? 'Novo' : existing?.name ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Novo paciente' : existing?.name}
          </h1>
          {!isNew && existing ? <p className="mt-1 text-xs font-semibold text-slate-500">{patientCode(existing.id, existing.shortId)}</p> : null}
          {existing?.deletedAt ? <p className="mt-2 text-sm text-red-600">Paciente excluido (soft delete).</p> : null}
        </div>
        <Link
          to="/app/patients"
          className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
        >
          Voltar
        </Link>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Cadastro</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome *</label>
              <Input value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CPF</label>
              <Input value={form.cpf} onChange={(event) => setForm((c) => ({ ...c, cpf: formatCpf(event.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data nascimento *</label>
              <Input type="date" value={form.birthDate} onChange={(event) => setForm((c) => ({ ...c, birthDate: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Sexo</label>
              <select
                value={form.gender}
                onChange={(event) => setForm((c) => ({ ...c, gender: event.target.value as PatientForm['gender'] }))}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Telefone fixo</label>
              <Input value={form.phone} onChange={(event) => setForm((c) => ({ ...c, phone: formatFixedPhone(event.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Celular (WhatsApp)</label>
              <Input value={form.whatsapp} onChange={(event) => setForm((c) => ({ ...c, whatsapp: formatMobilePhone(event.target.value) }))} />
              <WhatsappLink value={form.whatsapp} className="mt-2 text-xs font-semibold" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <Input type="email" value={form.email} onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CEP</label>
              <Input
                value={form.address.cep}
                onChange={(event) =>
                  setForm((c) => ({ ...c, address: { ...c.address, cep: normalizeCep(event.target.value) } }))
                }
              />
              {cepStatus ? <p className="mt-1 text-xs text-emerald-700">{cepStatus}</p> : null}
              {cepError ? <p className="mt-1 text-xs text-amber-700">{cepError}</p> : null}
            </div>
            <div className="sm:col-span-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Rua</label>
              <Input value={form.address.street} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, street: event.target.value } }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Numero</label>
              <Input value={form.address.number} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, number: event.target.value } }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Bairro</label>
              <Input value={form.address.district} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, district: event.target.value } }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cidade</label>
              <Input value={form.address.city} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, city: event.target.value } }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">UF</label>
              <Input value={form.address.state} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, state: event.target.value.toUpperCase().slice(0, 2) } }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Observacoes</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Vinculos</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Clinica</label>
              <select
                value={form.clinicId}
                onChange={(event) => setForm((c) => ({ ...c, clinicId: event.target.value }))}
                disabled={isExternalUser}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Nenhuma</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.tradeName}
                  </option>
                ))}
              </select>
              {form.clinicId ? (
                <Link to={`/app/clinics/${form.clinicId}`} className="mt-2 inline-flex text-xs font-semibold text-brand-700">
                  Abrir clinica
                </Link>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dentista responsavel</label>
              <select
                value={form.primaryDentistId}
                onChange={(event) => setForm((c) => ({ ...c, primaryDentistId: event.target.value }))}
                disabled={isExternalUser}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">Nao definido</option>
                {dentists.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.gender === 'feminino' ? 'Dra.' : 'Dr.'} {dentist.name}
                  </option>
                ))}
              </select>
              {selectedDentist ? (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>
                    Responsavel: {dentistPrefix} {selectedDentist.name}
                  </p>
                  {dentistWhatsappValid ? <WhatsappLink value={selectedDentist?.whatsapp} className="text-xs font-semibold" /> : null}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </section>

      {canAiClinica && !isNew && existing ? (
        <section className="mt-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Assistente IA - Prontuário</h2>
                <p className="mt-1 text-sm text-slate-500">Gera texto editável. Revise antes de salvar no prontuário.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void runClinicaAi('/clinica/resumo', 'Resumo com IA')} disabled={aiLoading}>
                  Resumo com IA
                </Button>
                <Button variant="secondary" onClick={() => void runClinicaAi('/clinica/plano', 'Plano com IA')} disabled={aiLoading}>
                  Plano com IA
                </Button>
                <Button variant="secondary" onClick={() => void runClinicaAi('/clinica/evolucao', 'Evolução com IA')} disabled={aiLoading}>
                  Evolução com IA
                </Button>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mt-6">
        <Card>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Orthocam</h2>
            <p className="text-xs text-slate-500">Fotos e arquivos registrados em linhas separadas por data.</p>
          </div>

          <div className="mt-4 space-y-4">
            {orthocamMediaByDate.map(([dateKey, items]) => (
              <div key={dateKey} className="rounded-xl border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">
                    {new Date(`${dateKey}T00:00:00`).toLocaleDateString('pt-BR')}
                  </p>
                  <span className="text-xs text-slate-500">{items.length} arquivo(s)</span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {items.map((item) => {
                    const previewUrl = orthocamPreviewUrls[item.previewKey]
                    return (
                      <button
                        key={item.previewKey}
                        type="button"
                        className="text-left"
                        onClick={() => openOrthocamItem(item)}
                        disabled={!previewUrl}
                      >
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          {item.canPreview && previewUrl ? (
                            <img src={previewUrl} alt={item.title} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="flex h-24 items-center justify-center px-2 text-center text-[11px] font-semibold text-slate-500">
                              Arquivo sem miniatura
                            </div>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{item.title}</p>
                        <p className="truncate text-[11px] text-slate-500">{item.subtitle}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {orthocamMediaByDate.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum registro Orthocam para este paciente.</p>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Historico - Auditoria</h2>
          <div className="mt-3 space-y-2">
            {relatedAuditEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <p className="font-medium text-slate-900">{event.action}</p>
                <p className="text-xs text-slate-500">{new Date(event.at).toLocaleString('pt-BR')}</p>
                {event.message ? <p className="mt-1 text-sm text-slate-700">{event.message}</p> : null}
              </div>
            ))}
            {relatedAuditEvents.length === 0 ? <p className="text-sm text-slate-500">Nenhum evento de auditoria vinculado.</p> : null}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Historico - Scans</h2>
            {existing && canWrite ? (
              <Button variant="secondary" size="sm" onClick={handleLinkByName}>
                Vincular automaticamente
              </Button>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            {scans.map((scan) => (
              <div key={scan.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {new Date(`${scan.scanDate}T00:00:00`).toLocaleDateString('pt-BR')} - {scan.arch}
                    </p>
                    <p className="text-xs text-slate-500">Status: {scan.status}</p>
                  </div>
                  <Link to="/app/scans" className="text-xs font-semibold text-brand-700">
                    Ver
                  </Link>
                </div>
              </div>
            ))}
            {scans.length === 0 ? <p className="text-sm text-slate-500">Nenhum scan vinculado.</p> : null}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Historico - Casos</h2>
          <div className="mt-3 space-y-2">
            {cases.map((caseItem) => (
              <div key={caseItem.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{caseItem.treatmentCode ?? caseItem.id}</p>
                    <p className="text-xs text-slate-500">Status: {caseItem.status}</p>
                  </div>
                  <Link to={`/app/cases/${caseItem.id}`} className="text-xs font-semibold text-brand-700">
                    Abrir
                  </Link>
                </div>
              </div>
            ))}
            {cases.length === 0 ? <p className="text-sm text-slate-500">Nenhum caso vinculado.</p> : null}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Documentos do paciente</h2>
              <p className="mt-1 text-sm text-slate-500">Uploads e registros de documentos.</p>
            </div>
            {canDocsWrite ? <Button onClick={() => setDocModalOpen(true)}>Adicionar documento</Button> : null}
          </div>
          <div className="mt-4">
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-900">Anexos de exame (pos-cadastro)</p>
                <p className="text-xs text-slate-500">Permite anexar arquivos depois de gerar o exame, no mesmo formato operacional.</p>
              </div>
              <div className="space-y-3">
                {STRUCTURED_PATIENT_DOC_SECTIONS.map((section) => (
                  <div key={section.title} className="rounded-lg border border-slate-200 bg-white p-3">
                    <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {section.slots.map((slot) => {
                        const slotDoc = structuredDocsBySlot.get(slot.id)
                        const statusOk = Boolean(slotDoc)
                        return (
                          <div key={slot.id} className="rounded-lg border border-slate-200 p-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-700">{slot.label}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusOk ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                {statusOk ? 'OK' : 'Falta'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <FilePickerWithCamera
                                accept={slot.accept}
                                onFileSelected={(file) => void uploadStructuredSlot(slot, file)}
                              />
                              {slotDoc ? (
                                <Button variant="secondary" size="sm" onClick={() => void openDoc(slotDoc)}>
                                  Ver
                                </Button>
                              ) : null}
                            </div>
                            {slotUploadBusy === slot.id ? <p className="mt-1 text-[11px] text-slate-500">Enviando...</p> : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DocumentsList
              items={docs}
              imagePreviewUrls={docPreviewUrls}
              canEdit={canDocsAdmin}
              canDelete={canDocsAdmin}
              canFlagError={canDocsWrite}
              onOpen={openDoc}
              onDownload={downloadDoc}
              onEdit={beginEditDoc}
              onDelete={deleteDoc}
              onRestore={async (doc) => {
                if (!canDocsWrite) return
                await restoreDocStatus(doc.id)
                if (existing) {
                  const items = await listPatientDocs(existing.id)
                  setDocs(items)
                }
              }}
              onMarkError={async (doc) => {
                if (!canDocsWrite) return
                const reason = window.prompt('Motivo do erro:')
                if (!reason?.trim()) return
                await markPatientDocAsError(doc.id, reason)
                if (existing) {
                  const items = await listPatientDocs(existing.id)
                  setDocs(items)
                }
              }}
            />
            {docs.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nenhum documento anexado.</p> : null}
          </div>
        </Card>
      </section>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <section className="mt-6 flex flex-wrap gap-2">
        {canWrite ? <Button onClick={savePatient}>Salvar</Button> : null}
        {existing && !existing.deletedAt && canDeletePatient ? (
          <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={handleDelete}>
            Excluir
          </Button>
        ) : null}
        {existing?.deletedAt && canDeletePatient ? (
          <Button variant="secondary" onClick={handleRestore}>
            Restaurar
          </Button>
        ) : null}
      </section>

      {docModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Adicionar documento</h2>
                <p className="mt-1 text-sm text-slate-500">Upload ou captura de documentos.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDocModalOpen(false)}>
                Fechar
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Titulo</label>
                <Input value={docForm.title} onChange={(event) => setDocForm((c) => ({ ...c, title: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Categoria</label>
                <select
                  value={docForm.category}
                  onChange={(event) => setDocForm((c) => ({ ...c, category: event.target.value as PatientDocument['category'] }))}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="identificacao">Identificacao</option>
                  <option value="contrato">Contrato</option>
                  <option value="consentimento">Consentimento</option>
                  <option value="exame">Exame</option>
                  <option value="foto">Foto</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Data</label>
                <Input type="date" value={docForm.date} onChange={(event) => setDocForm((c) => ({ ...c, date: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Observacao</label>
                <textarea
                  rows={3}
                  value={docForm.note}
                  onChange={(event) => setDocForm((c) => ({ ...c, note: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Arquivo</label>
                <FilePickerWithCamera
                  accept={acceptDocs}
                  onFileSelected={(file) => setDocForm((c) => ({ ...c, file }))}
                />
                {docForm.file ? <p className="mt-2 text-xs text-slate-500">{docForm.file.name}</p> : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDocModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={submitDoc}>Salvar documento</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {lightbox.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 px-4" onClick={() => setLightbox({ open: false, title: '', url: '' })}>
          <Card className="w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{lightbox.title || 'Visualizacao de imagem'}</h2>
                <p className="mt-1 text-xs text-slate-500">Imagem vinculada ao prontuario do paciente.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLightbox({ open: false, title: '', url: '' })}>
                Fechar
              </Button>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img src={lightbox.url} alt={lightbox.title || 'Documento'} className="max-h-[75vh] w-full object-contain" />
            </div>
          </Card>
        </div>
      ) : null}

      {docEditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Editar documento</h2>
                <p className="mt-1 text-sm text-slate-500">Atualize titulo, categoria, data e observacao.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDocEditOpen(false)
                  setDocEditId('')
                  setDocForm({ ...emptyDocForm, date: new Date().toISOString().slice(0, 10) })
                }}
              >
                Fechar
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Titulo</label>
                <Input value={docForm.title} onChange={(event) => setDocForm((c) => ({ ...c, title: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Categoria</label>
                <select
                  value={docForm.category}
                  onChange={(event) => setDocForm((c) => ({ ...c, category: event.target.value as PatientDocument['category'] }))}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="identificacao">Identificacao</option>
                  <option value="contrato">Contrato</option>
                  <option value="consentimento">Consentimento</option>
                  <option value="exame">Exame</option>
                  <option value="foto">Foto</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Data</label>
                <Input type="date" value={docForm.date} onChange={(event) => setDocForm((c) => ({ ...c, date: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Observacao</label>
                <textarea
                  rows={3}
                  value={docForm.note}
                  onChange={(event) => setDocForm((c) => ({ ...c, note: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
                <p className="mt-2 text-xs text-slate-500">Troca de arquivo ainda nao suportada neste modo.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDocEditOpen(false)
                  setDocEditId('')
                  setDocForm({ ...emptyDocForm, date: new Date().toISOString().slice(0, 10) })
                }}
              >
                Cancelar
              </Button>
              <Button onClick={submitDocEdit}>Salvar alteracoes</Button>
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
          setForm((current) => ({ ...current, notes: `${current.notes.trim()}\n\n${aiDraft.trim()}`.trim() }))
          setAiModalOpen(false)
        }}
        saveLabel="Salvar no prontuário"
      />
    </AppShell>
  )
}
