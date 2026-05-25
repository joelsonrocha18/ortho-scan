import { doc, getDoc } from 'firebase/firestore'
import { db as firestoreDb } from '../../../../lib/firebaseClient'
import type { LabWorkflowConfig } from '../../../../types/LabWorkflow'

function getFirestoreDb() {
  if (!firestoreDb) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return firestoreDb
}

export async function getWorkflowConfig(clinicId: string): Promise<LabWorkflowConfig | null> {
  const ref = doc(getFirestoreDb(), 'lab_workflow_configs', clinicId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return snap.data() as LabWorkflowConfig
}
