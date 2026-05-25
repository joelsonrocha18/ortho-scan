import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../../lib/firebaseClient'

export type ApproveSetupInput = {
  caseId: string
  dentistId: string
  approved: boolean
  adjustmentNotes?: string
}

function getFirestoreDb() {
  if (!db) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return db
}

export async function approveSetup(input: ApproveSetupInput): Promise<void> {
  const firestore = getFirestoreDb()
  const { caseId, dentistId, approved, adjustmentNotes } = input

  await updateDoc(doc(firestore, 'cases', caseId), {
    setup_status: approved ? 'approved' : 'revision_requested',
    setup_approved_at: approved ? serverTimestamp() : null,
    setup_approved_by: approved ? dentistId : null,
    adjustment_notes: adjustmentNotes?.trim() || null,
    updated_at: serverTimestamp(),
  })

  await addDoc(collection(firestore, 'cases', caseId, 'timeline'), {
    type: approved ? 'setup_approved' : 'setup_revision_requested',
    actor_id: dentistId,
    notes: adjustmentNotes?.trim() || null,
    created_at: serverTimestamp(),
  })
}
