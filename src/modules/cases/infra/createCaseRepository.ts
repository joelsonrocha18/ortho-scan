import type { User } from '../../../types/User'
import type { CaseRepository } from '../application/ports/CaseRepository'
import { createLocalCaseRepository } from './local/LocalCaseRepository'

export function createCaseRepository(currentUser: User | null): CaseRepository {
  return createLocalCaseRepository(currentUser)
}

// Casos remotos no modo Firebase usam src/data/caseRepo.ts diretamente nas páginas.
