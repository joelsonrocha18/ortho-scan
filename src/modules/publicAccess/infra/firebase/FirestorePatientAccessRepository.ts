import { doc, getDoc, setDoc } from 'firebase/firestore'
import { err, ok, type Result } from '../../../../shared/errors'
import { nowIsoDateTime } from '../../../../shared/utils/date'
import { createEntityId } from '../../../../shared/utils/id'
import { db as firestoreDb } from '../../../../lib/firebaseClient'
import { listCasesFirebase } from '../../../../data/caseRepo'
import { getPatientFirebase, listPatientsFirebase } from '../../../../repo/patientRepo'
import { getCaseAlignerChangeSummary } from '../../../../lib/alignerChange'
import type { Case } from '../../../../types/Case'
import type { Patient } from '../../../../types/Patient'
import {
  buildPatientAccessPreview,
  normalizeCpfInput,
  validatePatientIdentityInput,
  validatePatientPortalPhotoInput,
  validatePatientPortalAccessInput,
} from '../../domain/services/PatientAccessService'
import {
  buildPatientPortalSnapshot,
  isMatchingPatientAccessCode,
  resolvePatientPortalAccessCode,
} from '../../domain/services/PatientPortalService'
import type {
  PatientAccessIdentityInput,
  PatientAccessPreview,
  PatientAccessRepository,
  PatientMagicLinkReceipt,
  PatientPortalAccessInput,
} from '../../application/ports/PatientAccessRepository'
import type {
  PatientPortalPhotoUploadInput,
  PatientPortalPhotoUploadReceipt,
  PatientPortalSession,
  PatientPortalSnapshot,
} from '../../domain/models/PatientPortal'
import { addPatientDoc } from '../../../../repo/patientDocsRepo'

function getFirestoreDb() {
  if (!firestoreDb) throw new Error('Firebase não configurado.')
  return firestoreDb
}

async function findPatientByIdentity(input: PatientAccessIdentityInput): Promise<Patient | null> {
  const validated = validatePatientIdentityInput(input)
  const patients = await listPatientsFirebase({ includeDeleted: false })
  return (
    patients.find(
      (item) => normalizeCpfInput(item.cpf ?? '') === validated.cpf && (item.birthDate ?? '') === validated.birthDate,
    ) ?? null
  )
}

async function resolveLatestCase(patientId: string): Promise<Case | null> {
  const cases = await listCasesFirebase()
  return (
    cases
      .filter((item) => item.patientId === patientId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  )
}

async function resolveCaseByAccessCode(patientId: string, accessCode: string) {
  const cases = await listCasesFirebase()
  return (
    cases
      .filter((item) => item.patientId === patientId)
      .find((item) => isMatchingPatientAccessCode(item, accessCode)) ?? null
  )
}

function toTreatmentStatus(caseItem?: Case | null) {
  if (!caseItem) return 'Cadastro localizado'
  if (caseItem.lifecycleStatus === 'delivered') return 'Entregue'
  if (caseItem.lifecycleStatus === 'in_use') return 'Em uso'
  if (caseItem.lifecycleStatus === 'rework') return 'Reconfecção'
  if (caseItem.lifecycleStatus === 'in_production') return 'Em produção'
  if (caseItem.lifecycleStatus === 'shipped') return 'Despachado'
  if (caseItem.lifecycleStatus === 'qc') return 'Controle de qualidade'
  return caseItem.status.replaceAll('_', ' ')
}

async function buildPreviewFromPatient(patient: Patient, caseItemOverride?: Case | null): Promise<PatientAccessPreview> {
  const caseItem = caseItemOverride ?? (await resolveLatestCase(patient.id))
  const changeSummary = caseItem ? getCaseAlignerChangeSummary(caseItem) : null
  return buildPatientAccessPreview({
    patientId: patient.id,
    patientName: patient.name,
    cpf: patient.cpf,
    birthDate: patient.birthDate ?? '',
    activeCaseCode: caseItem?.treatmentCode ?? caseItem?.id,
    treatmentStatus: toTreatmentStatus(caseItem),
    nextChangeDate: changeSummary?.nextDueDate,
    patientEmail: patient.email,
  })
}

async function readTokenRecord(token: string) {
  const snapshot = await getDoc(doc(getFirestoreDb(), 'patient_access_tokens', token))
  if (!snapshot.exists()) return null
  const data = snapshot.data() as Record<string, unknown>
  const expiresAt = String(data.expires_at ?? data.expiresAt ?? '')
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return null
  return {
    patientId: String(data.patient_id ?? data.patientId ?? ''),
    caseId: (data.case_id ?? data.caseId) as string | undefined,
  }
}

async function persistToken(patientId: string, caseId?: string) {
  const token = createEntityId('pat')
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  await setDoc(doc(getFirestoreDb(), 'patient_access_tokens', token), {
    patient_id: patientId,
    patientId,
    case_id: caseId ?? null,
    caseId: caseId ?? null,
    expires_at: expiresAt,
    expiresAt,
    created_at: nowIsoDateTime(),
    createdAt: nowIsoDateTime(),
  })
  return token
}

export class FirestorePatientAccessRepository implements PatientAccessRepository {
  async validateIdentity(input: PatientAccessIdentityInput): Promise<Result<PatientAccessPreview, string>> {
    const patient = await findPatientByIdentity(input)
    if (!patient) return err('Não encontramos um paciente com os dados informados.')
    return ok(await buildPreviewFromPatient(patient))
  }

  async requestMagicLink(input: PatientAccessIdentityInput): Promise<Result<PatientMagicLinkReceipt, string>> {
    const patient = await findPatientByIdentity(input)
    if (!patient) return err('Não encontramos um paciente com os dados informados.')
    if (!patient.email?.trim()) {
      return err('Este paciente ainda não possui email cadastrado para receber link mágico.')
    }
    const token = await persistToken(patient.id)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return ok({
      deliveryChannel: 'debug',
      destinationHint: patient.email,
      magicLinkUrl: `${origin}/acesso/pacientes/portal?token=${encodeURIComponent(token)}`,
    })
  }

  async resolveMagicLink(token: string): Promise<Result<PatientAccessPreview, string>> {
    const record = await readTokenRecord(token)
    if (!record?.patientId) return err('Link do paciente expirado ou inválido.')
    const patient = await getPatientFirebase(record.patientId)
    if (!patient) return err('Paciente não encontrado para este link.')
    return ok(await buildPreviewFromPatient(patient))
  }

  async startPortalSession(input: PatientPortalAccessInput): Promise<Result<PatientPortalSession, string>> {
    const validated = validatePatientPortalAccessInput(input)
    const patient = await findPatientByIdentity(validated)
    if (!patient) return err('Não encontramos um paciente com os dados informados.')
    const caseItem = await resolveCaseByAccessCode(patient.id, validated.accessCode)
    if (!caseItem) return err('Código do tratamento não localizado para este paciente.')
    const token = await persistToken(patient.id, caseItem.id)
    const preview = await buildPreviewFromPatient(patient, caseItem)
    const accessCode = resolvePatientPortalAccessCode(caseItem) || caseItem.id
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return ok({
      token,
      accessCode,
      portalUrl: `${origin}/acesso/pacientes/portal?token=${encodeURIComponent(token)}&accessCode=${encodeURIComponent(accessCode)}`,
      preview: {
        patientId: preview.patientId,
        patientName: preview.patientName,
        activeCaseCode: preview.activeCaseCode,
        treatmentStatus: preview.treatmentStatus,
        clinicName: preview.clinicName,
        dentistName: preview.dentistName,
      },
    })
  }

  async resolvePortalSession(input: { token: string; accessCode?: string }): Promise<Result<PatientPortalSnapshot, string>> {
    const record = await readTokenRecord(input.token)
    if (!record?.patientId) return err('Sessão do paciente expirada ou inválida.')
    const patient = await getPatientFirebase(record.patientId)
    if (!patient) return err('Paciente não encontrado para esta sessão.')
    const caseItem = input.accessCode
      ? await resolveCaseByAccessCode(patient.id, input.accessCode)
      : await resolveLatestCase(patient.id)
    const documents = await import('../../../../repo/patientDocsRepo').then((module) => module.listPatientDocs(patient.id))
    return ok(
      buildPatientPortalSnapshot({
        patient,
        caseItem,
        documents,
      }),
    )
  }

  async uploadPortalPhoto(input: PatientPortalPhotoUploadInput): Promise<Result<PatientPortalPhotoUploadReceipt, string>> {
    const record = await readTokenRecord(input.token)
    if (!record?.patientId) return err('Sessão do paciente expirada ou inválida.')
    const validated = validatePatientPortalPhotoInput(input)
    const patient = await getPatientFirebase(record.patientId)
    if (!patient) return err('Paciente não encontrado.')
    const caseItem = input.accessCode
      ? await resolveCaseByAccessCode(patient.id, input.accessCode)
      : await resolveLatestCase(patient.id)
    if (!caseItem) return err('Código do tratamento não localizado para este paciente.')
    const title = `Foto do alinhador #${validated.trayNumber}`
    const result = await addPatientDoc({
      patientId: patient.id,
      caseId: caseItem.id,
      clinicId: patient.clinicId ?? caseItem.clinicId,
      title,
      category: 'foto',
      note: validated.note,
      file: validated.file,
    })
    if (!result.ok) return err(result.error)
    return ok({
      documentId: result.doc.id,
      trayNumber: validated.trayNumber,
      capturedAt: validated.capturedAt,
      title,
    })
  }
}

export function createFirestorePatientAccessRepository() {
  return new FirestorePatientAccessRepository()
}
