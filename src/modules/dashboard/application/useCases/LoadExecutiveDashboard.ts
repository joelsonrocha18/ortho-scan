import type { ResultUseCase } from '../../../../shared/application/useCase'
import type { Result } from '../../../../shared/errors'
import { createAppError } from '../../../../shared/errors'
import { runGuardedAsync, unwrapResult } from '../../../../shared/application'
import type { DashboardDateRange, DashboardRepository } from '../ports/DashboardRepository'
import type { ExecutiveDashboardView } from '../../domain/services/ExecutiveDashboardService'
import { ExecutiveDashboardService } from '../../domain/services/ExecutiveDashboardService'

export class LoadExecutiveDashboardUseCase implements ResultUseCase<DashboardDateRange | undefined, ExecutiveDashboardView, string> {
  private readonly repository: DashboardRepository

  constructor(repository: DashboardRepository) {
    this.repository = repository
  }

  execute(period?: DashboardDateRange): Result<ExecutiveDashboardView, string> | Promise<Result<ExecutiveDashboardView, string>> {
    return runGuardedAsync(
      {
        flow: 'dashboard.executive',
        action: 'LoadExecutiveDashboardUseCase.execute',
      },
      async () => {
        const snapshot = unwrapResult(
          await this.repository.loadSnapshot(period),
          (error) => createAppError({ message: typeof error === 'string' ? error : 'Falha ao carregar o painel.' }),
        )
        return ExecutiveDashboardService.build(snapshot)
      },
    )
  }
}
