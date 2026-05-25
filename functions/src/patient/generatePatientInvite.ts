import { randomInt, randomUUID } from 'crypto'
import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../shared/admin'

type GenerateInviteInput = {
  patientId: string
  caseId: string
}

const inviteCodeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const allowedRoles = ['master_admin', 'dentist_admin', 'receptionist']

function generateCode(): string {
  return Array.from({ length: 6 }, () => inviteCodeChars[randomInt(inviteCodeChars.length)]).join('')
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode()
    const existing = await db.collection('patient_invites')
      .where('code', '==', code)
      .where('status', '==', 'pending')
      .limit(1)
      .get()

    if (existing.empty) return code
  }

  throw new functions.https.HttpsError(
    'resource-exhausted',
    'Nao foi possivel gerar um codigo unico. Tente novamente.',
  )
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const generatePatientInvite = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: GenerateInviteInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const callerRole = asString(context.auth.token.role)
    const callerClinicId = asString(context.auth.token.clinicId)

    if (!allowedRoles.includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Perfil nao autorizado.')
    }

    const patientId = asString(data.patientId)
    const caseId = asString(data.caseId)

    if (!patientId || !caseId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'patientId e caseId sao obrigatorios.',
      )
    }

    const [patientSnap, caseSnap] = await Promise.all([
      db.collection('patients').doc(patientId).get(),
      db.collection('cases').doc(caseId).get(),
    ])

    if (!patientSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Paciente nao encontrado.')
    }

    if (!caseSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Caso nao encontrado.')
    }

    const patient = patientSnap.data()
    const caseItem = caseSnap.data()

    if (!patient || !caseItem) {
      throw new functions.https.HttpsError('not-found', 'Dados do convite nao encontrados.')
    }

    const patientClinicId = asString(patient.clinic_id ?? patient.clinicId)
    const caseClinicId = asString(caseItem.clinic_id ?? caseItem.clinicId)
    const casePatientId = asString(caseItem.patient_id ?? caseItem.patientId)

    if (casePatientId && casePatientId !== patientId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Caso nao pertence ao paciente informado.',
      )
    }

    if (patientClinicId && caseClinicId && patientClinicId !== caseClinicId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Paciente e caso pertencem a clinicas diferentes.',
      )
    }

    if (callerRole !== 'master_admin' && patientClinicId !== callerClinicId) {
      throw new functions.https.HttpsError('permission-denied', 'Paciente de outra clinica.')
    }

    const inviteId = randomUUID()
    const code = await generateUniqueCode()
    const linkToken = randomUUID()
    const now = Timestamp.now()
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 72 * 60 * 60 * 1000)
    const dentistId = asString(patient.dentist_id ?? patient.primaryDentistId ?? caseItem.dentist_id ?? caseItem.dentistId)

    const batch = db.batch()
    const activeInviteId = asString(patient.active_invite_id)

    if (activeInviteId) {
      batch.update(db.collection('patient_invites').doc(activeInviteId), {
        status: 'expired',
      })
    }

    batch.set(db.collection('patient_invites').doc(inviteId), {
      id: inviteId,
      code,
      link_token: linkToken,
      patient_id: patientId,
      clinic_id: patientClinicId,
      dentist_id: dentistId,
      case_id: caseId,
      created_by_uid: context.auth.uid,
      created_at: now,
      expires_at: expiresAt,
      status: 'pending',
    })

    batch.update(patientSnap.ref, {
      active_invite_id: inviteId,
      portal_enabled: true,
    })

    await batch.commit()

    const appUrl = process.env.APP_URL ?? 'https://app.orthoscan.com.br'
    return {
      inviteId,
      code,
      link: `${appUrl}/acesso/pacientes/convite/${linkToken}`,
      expiresAt: expiresAt.toDate().toISOString(),
    }
  })
