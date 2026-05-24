import { DATA_MODE } from '../../../data/dataMode'
import { createFirestorePatientAccessRepository } from './firebase/FirestorePatientAccessRepository'
import { createLocalPatientAccessRepository } from './local/LocalPatientAccessRepository'

export function createPatientAccessRepository() {
  return DATA_MODE === 'firebase'
    ? createFirestorePatientAccessRepository()
    : createLocalPatientAccessRepository()
}
