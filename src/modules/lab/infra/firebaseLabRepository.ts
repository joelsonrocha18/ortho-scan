import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../../../lib/firebaseClient'

export type LabQueueStage =
  | 'triagem'
  | 'setup'
  | 'impressao'
  | 'termoformagem'
  | 'acabamento'
  | 'expedicao'

export type LabCase = {
  id: string
  caseId?: string
  patientName?: string
  dentistName?: string
  currentStage?: LabQueueStage
  priority?: 'normal' | 'urgent' | 'vip'
  dueDate?: unknown
  alignerCount?: number
  assignedTechId?: string
}

function getFirestoreDb() {
  if (!db) {
    throw new Error('Firebase nao configurado. Verifique as variaveis VITE_FIREBASE_*.')
  }
  return db
}

export function subscribeToLabQueue(
  clinicId: string,
  onUpdate: (cases: LabCase[]) => void,
): Unsubscribe {
  const q = query(
    collection(getFirestoreDb(), 'clinics', clinicId, 'lab_queue'),
    where('status', '!=', 'completed'),
  )

  return onSnapshot(q, (snapshot) => {
    const cases = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as LabCase[]
    onUpdate(cases)
  })
}

export async function updateLabCaseStage(caseId: string, newStage: LabQueueStage): Promise<void> {
  await updateDoc(doc(getFirestoreDb(), 'lab_items', caseId), {
    currentStage: newStage,
    stage: newStage,
    updated_at: serverTimestamp(),
  })
}
