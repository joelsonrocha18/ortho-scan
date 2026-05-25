import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import { auth, db } from '../shared/admin'

type ValidateInviteInput = {
  linkToken?: string
  code?: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const validateAndLinkPatientInvite = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: ValidateInviteInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Faca login com Google ou Apple primeiro.',
      )
    }

    const uid = context.auth.uid
    const linkToken = asString(data.linkToken)
    const code = asString(data.code).toUpperCase()

    if (!linkToken && !code) {
      throw new functions.https.HttpsError('invalid-argument', 'Informe o link ou o codigo.')
    }

    const inviteQuery = linkToken
      ? await db.collection('patient_invites')
        .where('link_token', '==', linkToken)
        .where('status', '==', 'pending')
        .limit(1)
        .get()
      : await db.collection('patient_invites')
        .where('code', '==', code)
        .where('status', '==', 'pending')
        .limit(1)
        .get()

    if (inviteQuery.empty) {
      throw new functions.https.HttpsError('not-found', 'Convite invalido ou expirado.')
    }

    const inviteDoc = inviteQuery.docs[0]
    const invite = inviteDoc.data()
    const now = Timestamp.now()
    const expiresAt = invite.expires_at as Timestamp | undefined

    if (!expiresAt || expiresAt.toMillis() < now.toMillis()) {
      await inviteDoc.ref.update({ status: 'expired' })
      throw new functions.https.HttpsError('deadline-exceeded', 'Convite expirado.')
    }

    await auth.setCustomUserClaims(uid, {
      role: 'patient',
      patientId: invite.patient_id,
      clinicId: invite.clinic_id,
      dentistId: invite.dentist_id,
    })

    const batch = db.batch()

    batch.set(db.collection('patient_profiles').doc(uid), {
      uid,
      patient_id: invite.patient_id,
      clinic_id: invite.clinic_id,
      dentist_id: invite.dentist_id,
      case_ids: [invite.case_id],
      display_name: context.auth.token.name ?? '',
      photo_url: context.auth.token.picture ?? '',
      created_at: now,
      last_login_at: now,
    })

    batch.update(inviteDoc.ref, {
      status: 'used',
      used_at: now,
      firebase_uid: uid,
    })

    batch.update(db.collection('patients').doc(invite.patient_id), {
      portal_uid: uid,
      active_invite_id: null,
    })

    await batch.commit()

    return {
      success: true,
      patientId: invite.patient_id,
      caseId: invite.case_id,
    }
  })
