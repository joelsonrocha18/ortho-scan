import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../app/ToastProvider'
import Button from '../components/Button'
import Card from '../components/Card'
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
import {
  createPatient,
  createPatientFirebase,
  getPatient,
  getPatientFirebase,
  restorePatient,
  restorePatientFirebase,
  softDeletePatient,
  softDeletePatientFirebase,
  updatePatient,
  updatePatientFirebase,
} from '../repo/patientRepo'
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
import { listScansFirebase, updateScan, updateScanFirebase } from '../data/scanRepo'
import { listCasesFirebase, updateCase, updateCaseFirebase } from '../data/caseRepo'
import { buildPatientPortalWhatsappHref, buildPatientPortalWhatsappMessage, resolvePatientPortalAccessCode } from '../lib/accessLinks'
import { getCurrentUser } from '../lib/auth'
import { loadSystemSettings } from '../lib/systemSettings'
import { isWhatsappServiceReady, sendWhatsappServiceMessage } from '../lib/whatsappService'
import DocumentsList from '../components/documents/DocumentsList'
import { createSignedUrl, validatePatientDocFile } from '../repo/storageRepo'
import { DATA_MODE } from '../data/dataMode'
import { patientCode } from '../lib/entityCode'
import { listDentistsFirebase } from '../data/dentistRepo'
import { listClinicsFirebase } from '../repo/clinicRepo'

type PatientForm = {
  firstName: string
  lastName: string
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
    complement: string
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
  firstName: '',
  lastName: '',
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
    complement: '',
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

function safeText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function splitFullName(fullName: string, firstName?: string, lastName?: string) {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  if (first || last) return { firstName: first, lastName: last }
  const raw = fullName.trim()
  if (!raw) return { firstName: '', lastName: '' }
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'patients.write')
  const canDelete = can(currentUser, 'patients.delete')
  const canDeleteByRole = currentUser?.role === 'master_admin' || currentUser?.role === 'dentist_admin'
  const canDeletePatient = canDelete && canDeleteByRole
  const isExternalUser = currentUser?.role === 'dentist_client' || currentUser?.role === 'clinic_client'
  const canDocsWrite = can(currentUser, 'docs.write')
  const canDocsAdmin = currentUser?.role === 'master_admin' || currentUser?.role === 'dentist_admin' || currentUser?.role === 'receptionist'
  const isFirebaseMode = DATA_MODE === 'firebase'
  const isNew = params.id === 'new'
  const localExisting = useMemo(() => (!isNew && params.id ? getPatient(params.id) : null), [isNew, params.id])
  const [firebaseExisting, setFirebaseExisting] = useState<Patient | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const existing = isFirebaseMode ? firebaseExisting : localExisting
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
  const [cepStatus, setCepStatus] = useState('')
  const [cepError, setCepError] = useState('')

  const [firebaseDentists, setFirebaseDentists] = useState<Array<{
    id: string
    name: string
    gender?: 'masculino' | 'feminino'
    whatsapp?: string
    clinicId?: string
  }>>([])
  const [firebaseClinics, setFirebaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const [firebasePatientScans, setFirebasePatientScans] = useState<Scan[]>([])
  const [firebasePatientCases, setFirebasePatientCases] = useState<Case[]>([])
  const dentists = useMemo(
    () =>
      isFirebaseMode
        ? firebaseDentists
        : db.dentists.filter((item) => item.type === 'dentista' && !item.deletedAt),
    [db.dentists, firebaseDentists, isFirebaseMode],
  )
  const clinics = useMemo(
    () => (isFirebaseMode ? firebaseClinics : db.clinics.filter((item) => !item.deletedAt)),
    [db.clinics, firebaseClinics, isFirebaseMode],
  )
  const [docs, setDocs] = useState<PatientDocument[]>([])

  useEffect(() => {
    if (!isFirebaseMode) return
    let active = true
    void (async () => {
      const [clinicsRows, dentistsRows] = await Promise.all([
        listClinicsFirebase({ includeDeleted: false }),
        listDentistsFirebase({ includeDeleted: false, includeInactive: false }),
      ])
      if (!active) return
      setFirebaseClinics(
        clinicsRows.map((row) => ({
          id: row.id,
          tradeName: row.tradeName,
        })),
      )
      setFirebaseDentists(
        dentistsRows
          .filter((row) => row.type === 'dentista')
          .map((row) => ({
            id: row.id,
            name: row.name,
            gender: row.gender === 'feminino' ? 'feminino' : 'masculino',
            whatsapp: row.whatsapp,
            clinicId: row.clinicId,
          })),
      )
    })().catch((error) => {
      console.error('Falha ao carregar vínculos do Firebase.', error)
      if (!active) return
      setFirebaseClinics([])
      setFirebaseDentists([])
    })
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  useEffect(() => {
    if (!isFirebaseMode || isNew || !params.id) {
      setFirebaseExisting(null)
      if (!isFirebaseMode) setLoadingExisting(false)
      return
    }
    let active = true
    setLoadingExisting(true)
    void (async () => {
      const patient = await getPatientFirebase(params.id!)
      if (!active) return
      setFirebaseExisting(patient)
      setLoadingExisting(false)
    })().catch((error) => {
      console.error('Falha ao carregar paciente do Firebase.', error)
      if (!active) return
      setFirebaseExisting(null)
      setLoadingExisting(false)
    })
    return () => {
      active = false
    }
  }, [isFirebaseMode, isNew, params.id])

  const scans = useMemo(() => {
    if (!existing) return []
    if (isFirebaseMode) return firebasePatientScans
    const name = safeText(existing.name).toLowerCase()
    return db.scans.filter(
      (scan) =>
        (scan.patientId && scan.patientId === existing.id) ||
        (!scan.patientId && scan.patientName.toLowerCase() === name),
    )
  }, [db.scans, existing, firebasePatientScans, isFirebaseMode])

  const cases = useMemo(() => {
    if (!existing) return []
    if (isFirebaseMode) return firebasePatientCases
    const name = safeText(existing.name).toLowerCase()
    return db.cases.filter(
      (caseItem) =>
        (caseItem.patientId && caseItem.patientId === existing.id) ||
        (!caseItem.patientId && caseItem.patientName.toLowerCase() === name),
      )
  }, [db.cases, existing, firebasePatientCases, isFirebaseMode])
  const latestCaseForPortalShare = useMemo(() => {
    const activeCases = cases.filter((item) => item.status !== 'finalizado')
    const source = activeCases.length > 0 ? activeCases : cases
    return [...source].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }, [cases])
  const patientPortalAccessCode = useMemo(
    () => resolvePatientPortalAccessCode(latestCaseForPortalShare),
    [latestCaseForPortalShare],
  )
  const patientPortalDisplayName = existing?.name ?? `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
  const patientPortalWhatsappMessage = useMemo(
    () =>
      buildPatientPortalWhatsappMessage({
        patientName: patientPortalDisplayName,
        accessCode: patientPortalAccessCode,
      }),
    [patientPortalAccessCode, patientPortalDisplayName],
  )
  const patientPortalWhatsappHref = useMemo(
    () =>
      buildPatientPortalWhatsappHref({
        patientName: patientPortalDisplayName,
        whatsapp: form.whatsapp,
        accessCode: patientPortalAccessCode,
      }),
    [form.whatsapp, patientPortalAccessCode, patientPortalDisplayName],
  )
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
    const nameParts = splitFullName(safeText(existing.name), safeText(existing.firstName), safeText(existing.lastName))
    setForm({
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      cpf: safeText(existing.cpf),
      birthDate: safeText(existing.birthDate),
      gender: existing.gender ?? 'outro',
      phone: safeText(existing.phone),
      whatsapp: safeText(existing.whatsapp),
      email: safeText(existing.email),
      address: {
        cep: safeText(existing.address?.cep),
        street: safeText(existing.address?.street),
        number: safeText(existing.address?.number),
        complement: safeText(existing.address?.complement),
        district: safeText(existing.address?.district),
        city: safeText(existing.address?.city),
        state: safeText(existing.address?.state),
      },
      primaryDentistId: safeText(existing.primaryDentistId),
      clinicId: safeText(existing.clinicId),
      notes: safeText(existing.notes),
    })
  }, [existing, isNew])

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
    if (!isFirebaseMode || !existing) {
      setFirebasePatientScans([])
      setFirebasePatientCases([])
      return
    }
    let active = true
    void (async () => {
      const [allScans, allCases] = await Promise.all([
        listScansFirebase(),
        listCasesFirebase(),
      ])
      if (!active) return
      const name = safeText(existing.name).toLowerCase()
      setFirebasePatientScans(
        allScans
          .filter((scan) => (scan.patientId && scan.patientId === existing.id) || (!scan.patientId && scan.patientName.toLowerCase() === name))
          .sort((a, b) => b.scanDate.localeCompare(a.scanDate)),
      )
      setFirebasePatientCases(
        allCases.filter((caseItem) => (caseItem.patientId && caseItem.patientId === existing.id) || (!caseItem.patientId && caseItem.patientName.toLowerCase() === name)),
      )
    })().catch((error) => {
      console.error('Falha ao carregar histórico do paciente no Firebase.', error)
      if (!active) return
      setFirebasePatientScans([])
      setFirebasePatientCases([])
    })
    return () => {
      active = false
    }
  }, [existing, isFirebaseMode])

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
          if (item.filePath) {
            const signed = await createSignedUrl(item.filePath, 300)
            return signed.ok ? ([item.previewKey, signed.url] as const) : null
          }
          return item.url ? ([item.previewKey, item.url] as const) : null
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

  if (DATA_MODE === 'local' && !isNew && existing && !scopedPatients.some((item) => item.id === existing.id)) {
    return (
      <AppShell breadcrumb={['Início', 'Pacientes']}>
        <Card className="ui-surface-panel">
          <h1 className="text-xl font-semibold text-slate-900">Sem acesso</h1>
          <p className="mt-2 text-sm text-slate-500">Seu perfil não permite visualizar este paciente.</p>
          <Link to="/app/patients" className="mt-3 inline-flex text-sm font-semibold text-brand-700">
            Voltar para pacientes
          </Link>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && loadingExisting) {
    return (
      <AppShell breadcrumb={['Início', 'Pacientes']}>
        <Card className="ui-surface-panel">
          <h1 className="text-xl font-semibold text-slate-900">Carregando paciente...</h1>
        </Card>
      </AppShell>
    )
  }

  if (!isNew && !existing && !loadingExisting) {
    return (
      <AppShell breadcrumb={['Início', 'Pacientes']}>
        <Card className="ui-surface-panel">
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
  const canSharePatientPortalAccess = Boolean(existing && patientPortalWhatsappHref)

  const savePatient = async () => {
    if (!canWrite) {
      setError('Sem permissão para editar pacientes.')
      return
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Nome e sobrenome são obrigatórios.')
      return
    }
    if (!form.birthDate) {
      setError('Data de nascimento é obrigatória.')
      return
    }
    if (form.phone.trim() && !isValidFixedPhone(form.phone)) {
      setError('Telefone fixo inválido.')
      return
    }
    if (form.whatsapp.trim() && !isValidMobilePhone(form.whatsapp)) {
      setError('Celular/WhatsApp inválido.')
      return
    }

    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
    const payload: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> = {
      name: fullName,
      firstName: form.firstName.trim() || undefined,
      lastName: form.lastName.trim() || undefined,
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
        complement: form.address.complement.trim() || undefined,
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
        setError('Perfil externo sem clínica vinculada. Contate o administrador.')
        return
      }
      payload.clinicId = currentUser.linkedClinicId
    }

    if (isFirebaseMode) {
      if (isNew) {
        const result = await createPatientFirebase(payload)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setError('')
        navigate('/app/patients', { replace: true })
        return
      }
      if (!existing) return
      const result = await updatePatientFirebase(existing.id, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError('')
      navigate('/app/patients', { replace: true })
      return
    }

    if (isNew) {
      const result = createPatient(payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError('')
      navigate('/app/patients', { replace: true })
      return
    }

    if (!existing) return
    const result = updatePatient(existing.id, payload)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    navigate('/app/patients', { replace: true })
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!canDeletePatient) {
      setError('Somente administrador master ou administrador dentista podem excluir paciente.')
      return
    }
    const confirmed = window.confirm('Tem certeza que deseja excluir este paciente?')
    if (!confirmed) return
    if (isFirebaseMode) {
      const result = await softDeletePatientFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
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
    if (isFirebaseMode) {
      const result = await restorePatientFirebase(existing.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFirebaseExisting((current) => (current ? { ...current, deletedAt: undefined } : current))
      return
    }
    restorePatient(existing.id)
  }

  const handleLinkByName = async () => {
    if (!existing) return
    if (!canWrite) return
    if (isFirebaseMode) {
      const name = existing.name.toLowerCase()
      const scansToUpdate = firebasePatientScans.filter((scan) => !scan.patientId && scan.patientName.toLowerCase() === name)
      const casesToUpdate = firebasePatientCases.filter((caseItem) => !caseItem.patientId && caseItem.patientName.toLowerCase() === name)
      await Promise.all([
        ...scansToUpdate.map((scan) => updateScanFirebase(scan.id, { patientId: existing.id })),
        ...casesToUpdate.map((caseItem) => updateCaseFirebase(caseItem.id, { patientId: existing.id })),
      ])
      setFirebasePatientScans((current) => current.map((scan) => ({ ...scan, patientId: existing.id })))
      setFirebasePatientCases((current) => current.map((caseItem) => ({ ...caseItem, patientId: existing.id })))
      if (scansToUpdate.length || casesToUpdate.length) {
        setError('')
      }
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
      setError('Sem permissão para anexar documentos.')
      return
    }
    if (!docForm.title.trim()) {
      setError('Informe o título do documento.')
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
      setError('Sem permissão para editar documentos.')
      return
    }
    if (!docForm.title.trim()) {
      setError('Informe o título do documento.')
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
    const ok = window.confirm(`Excluir o documento "${doc.title}"? Essa ação não pode ser desfeita.`)
    if (!ok) return
    const result = await deletePatientDoc(doc.id)
    if (!result.ok) setError(result.error)
    if (existing) {
      const items = await listPatientDocs(existing.id)
      setDocs(items)
    }
  }

  const sharePatientPortalAccess = async () => {
    if (!patientPortalWhatsappHref) return

    const settings = loadSystemSettings()
    if (isWhatsappServiceReady(settings.whatsappService) && patientPortalWhatsappMessage) {
      const result = await sendWhatsappServiceMessage(
        { whatsappService: settings.whatsappService },
        {
          to: form.whatsapp,
          message: patientPortalWhatsappMessage,
          kind: 'patient_portal_access',
          metadata: { patientId: existing?.id ?? '', accessCode: patientPortalAccessCode },
        },
      )
      if (result.ok) {
        addToast({ type: 'success', title: 'Acesso enviado pelo WhatsApp' })
        return
      }
      addToast({ type: 'error', title: 'Serviço WhatsApp indisponível', message: result.error })
    }

    window.open(patientPortalWhatsappHref, '_blank', 'noopener,noreferrer')
  }

  return (
    <AppShell breadcrumb={['Início', 'Pacientes', isNew ? 'Novo' : existing?.name ?? 'Detalhe']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'Novo paciente' : existing?.name}
          </h1>
          {!isNew && existing ? <p className="ui-copy-muted mt-1 text-xs font-semibold">{patientCode(existing.id, existing.shortId)}</p> : null}
          {existing?.deletedAt ? <p className="mt-2 text-sm text-red-600">Paciente excluído.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isNew ? (
            <Button
              variant="secondary"
              disabled={!canSharePatientPortalAccess}
              onClick={
                canSharePatientPortalAccess
                  ? sharePatientPortalAccess
                  : undefined
              }
            >
              Encaminhar acesso
            </Button>
          ) : null}
          <Link
            to="/app/patients"
            className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-200"
          >
            Voltar
          </Link>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="ui-surface-panel">
          <h2 className="text-lg font-semibold text-slate-900">Cadastro</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="ui-label mb-1 block text-sm">Nome *</label>
              <Input value={form.firstName} onChange={(event) => setForm((c) => ({ ...c, firstName: event.target.value }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Sobrenome *</label>
              <Input value={form.lastName} onChange={(event) => setForm((c) => ({ ...c, lastName: event.target.value }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">CPF</label>
              <Input value={form.cpf} onChange={(event) => setForm((c) => ({ ...c, cpf: formatCpf(event.target.value) }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Data nascimento *</label>
              <Input type="date" value={form.birthDate} onChange={(event) => setForm((c) => ({ ...c, birthDate: event.target.value }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Sexo</label>
              <select
                value={form.gender}
                onChange={(event) => setForm((c) => ({ ...c, gender: event.target.value as PatientForm['gender'] }))}
                className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm"
              >
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Telefone fixo</label>
              <Input value={form.phone} onChange={(event) => setForm((c) => ({ ...c, phone: formatFixedPhone(event.target.value) }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Celular (WhatsApp)</label>
              <Input value={form.whatsapp} onChange={(event) => setForm((c) => ({ ...c, whatsapp: formatMobilePhone(event.target.value) }))} />
              <WhatsappLink value={form.whatsapp} className="mt-2 text-xs font-semibold" />
            </div>
            <div className="sm:col-span-2">
              <label className="ui-label mb-1 block text-sm">Email</label>
              <Input type="email" value={form.email} onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">CEP</label>
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
              <label className="ui-label mb-1 block text-sm">Rua</label>
              <Input value={form.address.street} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, street: event.target.value } }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Número</label>
              <Input value={form.address.number} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, number: event.target.value } }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Complemento</label>
              <Input value={form.address.complement} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, complement: event.target.value } }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Bairro</label>
              <Input value={form.address.district} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, district: event.target.value } }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">Cidade</label>
              <Input value={form.address.city} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, city: event.target.value } }))} />
            </div>
            <div>
              <label className="ui-label mb-1 block text-sm">UF</label>
              <Input value={form.address.state} onChange={(event) => setForm((c) => ({ ...c, address: { ...c.address, state: event.target.value.toUpperCase().slice(0, 2) } }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="ui-label mb-1 block text-sm">Observações</label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
                className="ui-input-strong w-full rounded-lg px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
        </Card>

        <Card className="ui-surface-panel">
          <h2 className="text-lg font-semibold text-slate-900">Vínculos</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="ui-label mb-1 block text-sm">Clínica</label>
              <select
                value={form.clinicId}
                onChange={(event) => setForm((c) => ({ ...c, clinicId: event.target.value }))}
                disabled={isExternalUser}
                className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm"
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
                  Abrir clínica
                </Link>
              ) : null}
            </div>

            <div>
              <label className="ui-label mb-1 block text-sm">Dentista responsável</label>
              <select
                value={form.primaryDentistId}
                onChange={(event) => setForm((c) => ({ ...c, primaryDentistId: event.target.value }))}
                disabled={isExternalUser}
                className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm"
              >
                <option value="">Não definido</option>
                {dentists.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.gender === 'feminino' ? 'Dra.' : 'Dr.'} {dentist.name}
                  </option>
                ))}
              </select>
              {selectedDentist ? (
                <div className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm">
                  <p>
                    <span className="ui-label">Responsável:</span>{' '}
                    <span className="ui-value">{dentistPrefix} {selectedDentist.name}</span>
                  </p>
                  {dentistWhatsappValid ? <WhatsappLink value={selectedDentist?.whatsapp} className="text-xs font-semibold" /> : null}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="ui-surface-panel">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Orthocam</h2>
            <p className="ui-copy-muted text-xs">Fotos e arquivos registrados em linhas separadas por data.</p>
          </div>

          <div className="mt-4 space-y-4">
            {orthocamMediaByDate.map(([dateKey, items]) => (
              <div key={dateKey} className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">
                    {new Date(`${dateKey}T00:00:00`).toLocaleDateString('pt-BR')}
                  </p>
                  <span className="ui-copy-muted text-xs font-semibold">{items.length} arquivo(s)</span>
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
                        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                          {item.canPreview && previewUrl ? (
                            <img src={previewUrl} alt={item.title} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="ui-copy-muted flex h-24 items-center justify-center px-2 text-center text-[11px] font-semibold">
                              Arquivo sem miniatura
                            </div>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-900">{item.title}</p>
                        <p className="ui-copy-muted truncate text-[11px]">{item.subtitle}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {orthocamMediaByDate.length === 0 ? (
              <p className="ui-copy-muted text-sm">Nenhum registro Orthocam para este paciente.</p>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="ui-surface-panel">
          <h2 className="text-lg font-semibold text-slate-900">Histórico - Auditoria</h2>
          <div className="mt-3 space-y-2">
            {relatedAuditEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm">
                <p className="font-medium text-slate-900">{event.action}</p>
                <p className="ui-copy-muted text-xs">{new Date(event.at).toLocaleString('pt-BR')}</p>
                {event.message ? <p className="mt-1 text-sm text-[#1A202C]">{event.message}</p> : null}
              </div>
            ))}
            {relatedAuditEvents.length === 0 ? <p className="ui-copy-muted text-sm">Nenhum evento de auditoria vinculado.</p> : null}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="ui-surface-panel">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Histórico de exames</h2>
            {existing && canWrite ? (
              <Button variant="secondary" size="sm" onClick={handleLinkByName}>
                Vincular automaticamente
              </Button>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            {scans.map((scan) => (
              <div key={scan.id} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {new Date(`${scan.scanDate}T00:00:00`).toLocaleDateString('pt-BR')} - {scan.arch}
                    </p>
                    <p className="text-xs">
                      <span className="ui-label">Status:</span> <span className="ui-value">{scan.status}</span>
                    </p>
                  </div>
                  <Link to="/app/scans" className="text-xs font-semibold text-brand-700">
                    Ver
                  </Link>
                </div>
              </div>
            ))}
            {scans.length === 0 ? <p className="ui-copy-muted text-sm">Nenhum exame vinculado.</p> : null}
          </div>
        </Card>

        <Card className="ui-surface-panel">
          <h2 className="text-lg font-semibold text-slate-900">Histórico - Casos</h2>
          <div className="mt-3 space-y-2">
            {cases.map((caseItem) => (
              <div key={caseItem.id} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{caseItem.treatmentCode ?? caseItem.id}</p>
                    <p className="text-xs">
                      <span className="ui-label">Status:</span> <span className="ui-value">{caseItem.status}</span>
                    </p>
                  </div>
                  <Link to={`/app/cases/${caseItem.id}`} className="text-xs font-semibold text-brand-700">
                    Abrir
                  </Link>
                </div>
              </div>
            ))}
            {cases.length === 0 ? <p className="ui-copy-muted text-sm">Nenhum caso vinculado.</p> : null}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="ui-surface-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Documentos do paciente</h2>
              <p className="ui-copy-muted mt-1 text-sm">Envios e registros de documentos.</p>
            </div>
            {canDocsWrite ? <Button onClick={() => setDocModalOpen(true)}>Adicionar documento</Button> : null}
          </div>
          <div className="mt-4">
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
            {docs.length === 0 ? <p className="ui-copy-muted mt-3 text-sm">Nenhum documento anexado.</p> : null}
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
          <Card className="ui-surface-panel w-full max-w-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Adicionar documento</h2>
                <p className="ui-copy-muted mt-1 text-sm">Envio ou captura de documentos.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDocModalOpen(false)}>
                Fechar
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="ui-label mb-1 block text-sm">Título</label>
                <Input value={docForm.title} onChange={(event) => setDocForm((c) => ({ ...c, title: event.target.value }))} />
              </div>
              <div>
                <label className="ui-label mb-1 block text-sm">Categoria</label>
                <select
                  value={docForm.category}
                  onChange={(event) => setDocForm((c) => ({ ...c, category: event.target.value as PatientDocument['category'] }))}
                  className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm"
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
                <label className="ui-label mb-1 block text-sm">Data</label>
                <Input type="date" value={docForm.date} onChange={(event) => setDocForm((c) => ({ ...c, date: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="ui-label mb-1 block text-sm">Observação</label>
                <textarea
                  rows={3}
                  value={docForm.note}
                  onChange={(event) => setDocForm((c) => ({ ...c, note: event.target.value }))}
                  className="ui-input-strong w-full rounded-lg px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="ui-label mb-1 block text-sm">Arquivo</label>
                <FilePickerWithCamera
                  accept={acceptDocs}
                  onFileSelected={(file) => setDocForm((c) => ({ ...c, file }))}
                />
                {docForm.file ? <p className="ui-copy-muted mt-2 text-xs">{docForm.file.name}</p> : null}
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
          <Card className="ui-surface-panel w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{lightbox.title || 'Visualizacao de imagem'}</h2>
                <p className="ui-copy-muted mt-1 text-xs">Imagem vinculada ao prontuario do paciente.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLightbox({ open: false, title: '', url: '' })}>
                Fechar
              </Button>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <img src={lightbox.url} alt={lightbox.title || 'Documento'} className="max-h-[75vh] w-full object-contain" />
            </div>
          </Card>
        </div>
      ) : null}

      {docEditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="ui-surface-panel w-full max-w-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Editar documento</h2>
                <p className="ui-copy-muted mt-1 text-sm">Atualize título, categoria, data e observação.</p>
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
                <label className="ui-label mb-1 block text-sm">Título</label>
                <Input value={docForm.title} onChange={(event) => setDocForm((c) => ({ ...c, title: event.target.value }))} />
              </div>
              <div>
                <label className="ui-label mb-1 block text-sm">Categoria</label>
                <select
                  value={docForm.category}
                  onChange={(event) => setDocForm((c) => ({ ...c, category: event.target.value as PatientDocument['category'] }))}
                  className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm"
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
                <label className="ui-label mb-1 block text-sm">Data</label>
                <Input type="date" value={docForm.date} onChange={(event) => setDocForm((c) => ({ ...c, date: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="ui-label mb-1 block text-sm">Observação</label>
                <textarea
                  rows={3}
                  value={docForm.note}
                  onChange={(event) => setDocForm((c) => ({ ...c, note: event.target.value }))}
                  className="ui-input-strong w-full rounded-lg px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
                <p className="ui-copy-muted mt-2 text-xs">Troca de arquivo ainda não suportada neste modo.</p>
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

    </AppShell>
  )
}

