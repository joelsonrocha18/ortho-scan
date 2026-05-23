import { DATA_MODE } from '../../../data/dataMode'
import type { User } from '../../../types/User'
import type { DashboardRepository } from '../application/ports/DashboardRepository'
import { createFirestoreDashboardRepository } from './firebase/FirestoreDashboardRepository'
import { createLocalDashboardRepository } from './local/LocalDashboardRepository'
import { createSupabaseDashboardRepository } from './supabase/SupabaseDashboardRepository'

export function createDashboardRepository(currentUser: User | null): DashboardRepository {
  if (DATA_MODE === 'firebase') {
    return createFirestoreDashboardRepository(currentUser)
  }
  if (DATA_MODE === 'supabase') {
    return createSupabaseDashboardRepository(currentUser)
  }
  return createLocalDashboardRepository(currentUser)
}
