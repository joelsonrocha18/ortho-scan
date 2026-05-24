import { DATA_MODE } from '../../../data/dataMode'
import type { User } from '../../../types/User'
import type { DashboardRepository } from '../application/ports/DashboardRepository'
import { createFirestoreDashboardRepository } from './firebase/FirestoreDashboardRepository'
import { createLocalDashboardRepository } from './local/LocalDashboardRepository'

export function createDashboardRepository(currentUser: User | null): DashboardRepository {
  if (DATA_MODE === 'firebase') {
    return createFirestoreDashboardRepository(currentUser)
  }
  return createLocalDashboardRepository(currentUser)
}
