import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../app/ToastProvider'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import { ApprovePlanningVersionUseCase } from '../../../cases'
import { createCaseRepository } from '../../../cases/infra/createCaseRepository'
import { LoadDentistPortalUseCase } from '../../application/useCases/LoadDentistPortal'
import { createLocalDentistPortalRepository } from '../../infra/local/LocalDentistPortalRepository'
import type { DentistPortalView } from '../../domain/services/DentistPortalService'

export function useDentistPortalController() {
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const repository = useMemo(() => createLocalDentistPortalRepository(currentUser), [currentUser])
  const caseRepository = useMemo(() => createCaseRepository(currentUser), [currentUser])
  const loadPortal = useMemo(() => new LoadDentistPortalUseCase(repository), [repository])
  const approvePlanning = useMemo(() => new ApprovePlanningVersionUseCase(caseRepository, currentUser), [caseRepository, currentUser])
  const [data, setData] = useState<DentistPortalView | null>(null)
  const refreshSignature = `${db.cases.map((item) => item.updatedAt).join('|')}::${db.patientDocuments.map((item) => item.createdAt).join('|')}::${db.labItems.map((item) => item.updatedAt).join('|')}`

  useEffect(() => {
    void (async () => {
      const result = await loadPortal.execute()
      if (!result.ok) {
        addToast({ type: 'error', title: 'Portal dentista', message: result.error })
        return
      }
      setData(result.data)
    })()
  }, [addToast, loadPortal, refreshSignature])

  const approveVersion = async (caseId: string, versionId: string) => {
    const result = await approvePlanning.execute({ caseId, versionId })
    if (!result.ok) {
      addToast({ type: 'error', title: 'Aprovacao', message: result.error })
      return
    }
    addToast({ type: 'success', title: 'Planejamento aprovado' })
    const refreshed = await loadPortal.execute()
    if (refreshed.ok) setData(refreshed.data)
  }

  return {
    data,
    currentUser,
    approveVersion,
  }
}
