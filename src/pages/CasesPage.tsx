import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../app/ToastProvider'
import AppShell from '../layouts/AppShell'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import type { Case, CasePhase } from '../types/Case'
import type { ProductType } from '../types/Product'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import { DATA_MODE } from '../data/dataMode'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { listCasesForUser, listLabItemsForUser } from '../auth/scope'
import { buildActualChangeDateMap, buildArchScheduleDates, resolveAlignerArchTotals } from '../lib/alignerChange'
import { downloadAlignerTreatmentReport, type AlignerTreatmentReportRow } from '../lib/alignerTreatmentReport'
import { listCasesFirebase } from '../data/caseRepo'
import { listPatientsFirebase } from '../repo/patientRepo'
import { listDentistsFirebase } from '../data/dentistRepo'
import { listClinicsFirebase } from '../repo/clinicRepo'

const phaseLabelMap: Record<CasePhase, string> = {
  planejamento: 'Planejamento',
  'orçamento': 'Orçamento',
  contrato_pendente: 'Contrato pendente',
  contrato_aprovado: 'Contrato aprovado',
  em_producao: 'Em produção',
  finalizado: 'Finalizado',
}

const phaseToneMap: Record<CasePhase, 'neutral' | 'info' | 'success'> = {
  planejamento: 'neutral',
  'orçamento': 'neutral',
  contrato_pendente: 'neutral',
  contrato_aprovado: 'info',
  em_producao: 'info',
  finalizado: 'success',
}

type LiveLabStatus = 'aguardando_iniciar' | 'em_producao' | 'controle_qualidade' | 'prontas' | null

type PatientLookup = {
  name: string
  shortId?: string
  clinicId?: string
}

type ClinicLookup = {
  tradeName?: string
}

type CaseListItem = {
  id: string
  shortId?: string
  productType: ProductType
  treatmentOrigin?: 'interno' | 'externo'
  clinicId?: string
  patientId?: string
  patientName: string
  dentistId?: string
  phase: CasePhase
  status: string
  treatmentCode?: string
  totalTrays?: number
  totalTraysUpper?: number
  totalTraysLower?: number
  changeEveryDays?: number
  deliveryLots?: Case['deliveryLots']
  installation?: Case['installation']
  arch?: 'superior' | 'inferior' | 'ambos'
  caseDate: string
}

function isConcluded(item: CaseListItem) {
  return item.status === 'finalizado'
}

function isInProductionFlow(item: CaseListItem) {
  return !isConcluded(item)
}

function inferTreatmentOrigin(
  item: Pick<CaseListItem, 'treatmentOrigin' | 'clinicId'>,
  clinicsById?: Map<string, ClinicLookup>,
) {
  if (item.treatmentOrigin === 'interno' || item.treatmentOrigin === 'externo') return item.treatmentOrigin
  if (!item.clinicId) return 'externo' as const
  const normalizedClinicId = item.clinicId.trim().toLowerCase()
  if (normalizedClinicId === 'clinic_arrimo' || normalizedClinicId === 'cli-0001') return 'interno' as const
  const tradeName = clinicsById?.get(item.clinicId)?.tradeName?.trim().toUpperCase()
  return tradeName === 'ARRIMO' ? ('interno' as const) : ('externo' as const)
}

function resolveCaseOrigin(
  item: CaseListItem,
  patientsById: Map<string, PatientLookup>,
  clinicsById: Map<string, ClinicLookup>,
) {
  const patientClinicId = item.patientId ? patientsById.get(item.patientId)?.clinicId : undefined
  if (patientClinicId) {
    return inferTreatmentOrigin(
      {
        treatmentOrigin: undefined,
        clinicId: patientClinicId,
      },
      clinicsById,
    )
  }
  return inferTreatmentOrigin(
    {
      treatmentOrigin: item.treatmentOrigin,
      clinicId: item.clinicId,
    },
    clinicsById,
  )
}

function padTrayCount(value: number) {
  return String(Math.max(0, Math.trunc(value))).padStart(2, '0')
}

function formatTrayPair(upper: number, lower: number, upperLabel: 'sup' | 'Sup', lowerLabel: 'inf' | 'Inf') {
  return `${padTrayCount(upper)} ${upperLabel} / ${padTrayCount(lower)} ${lowerLabel}`
}

function resolveDeliveredToDentist(lots: Case['deliveryLots'] | undefined) {
  return (lots ?? []).reduce(
    (acc, lot) => {
      const quantity = Math.max(0, Math.trunc(lot.quantity ?? 0))
      if (lot.arch === 'superior') acc.upper += quantity
      if (lot.arch === 'inferior') acc.lower += quantity
      if (lot.arch === 'ambos') {
        acc.upper += quantity
        acc.lower += quantity
      }
      return acc
    },
    { upper: 0, lower: 0 },
  )
}

function pickMaxIsoDate(values: Array<string | undefined>) {
  const validValues = values.filter((value): value is string => Boolean(value))
  if (validValues.length === 0) return undefined
  return [...validValues].sort().at(-1)
}

function pickMinIsoDate(values: Array<string | undefined>) {
  const validValues = values.filter((value): value is string => Boolean(value))
  if (validValues.length === 0) return undefined
  return [...validValues].sort()[0]
}

function formatDentistDisplayName(dentist?: { name: string; gender?: string }) {
  const name = (dentist?.name ?? '').trim()
  if (!name) return '-'
  if (/^dra?\.?\s/i.test(name)) return name
  const prefix = dentist?.gender === 'feminino' ? 'Dra' : 'Dr'
  return `${prefix} ${name}`
}

function buildLabStatusByCase(items: Array<{ caseId?: string; status?: string }>) {
  const order: Array<Exclude<LiveLabStatus, null>> = ['aguardando_iniciar', 'em_producao', 'controle_qualidade', 'prontas']
  const score = (status: string) => {
    const index = order.indexOf(status as Exclude<LiveLabStatus, null>)
    return index < 0 ? -1 : index
  }
  const map = new Map<string, LiveLabStatus>()
  items.forEach((item) => {
    if (!item.caseId) return
    const current = map.get(item.caseId)
    const candidate = item.status as LiveLabStatus
    if (!candidate || score(candidate) < 0) return
    if (!current || score(candidate) > score(current)) {
      map.set(item.caseId, candidate)
    }
  })
  return map
}

function caseStatusBadge(item: CaseListItem, liveLabStatus: LiveLabStatus, hasLabOrder: boolean) {
  if (isConcluded(item)) return { label: 'Concluido', tone: 'success' as const }
  if (item.status === 'em_tratamento') return { label: 'Em tratamento', tone: 'info' as const }
  if (item.status === 'aguardando_reposicao') return { label: 'Aguardando reposição', tone: 'danger' as const }
  if (item.phase === 'planejamento') return { label: 'Planejamento', tone: 'neutral' as const }
  if (item.phase === 'orçamento') return { label: 'Orçamento', tone: 'neutral' as const }
  if (item.phase === 'contrato_pendente') return { label: 'Aguardando aprovação de contrato', tone: 'neutral' as const }
  if (item.phase === 'contrato_aprovado' && !hasLabOrder) return { label: 'Contrato aprovado - gerar OS', tone: 'info' as const }
  if (item.phase === 'contrato_aprovado' && hasLabOrder && !liveLabStatus) return { label: 'OS gerada', tone: 'info' as const }
  if (liveLabStatus === 'prontas') return { label: 'Pronto para entrega', tone: 'info' as const }
  if (liveLabStatus === 'controle_qualidade') return { label: 'Controle de qualidade', tone: 'info' as const }
  if (liveLabStatus === 'em_producao') return { label: 'Em produção', tone: 'info' as const }
  if (liveLabStatus === 'aguardando_iniciar') return { label: 'Aguardando iniciar', tone: 'neutral' as const }
  if ((item.deliveryLots?.length ?? 0) > 0 && !item.installation?.installedAt) return { label: 'Pronto para entrega', tone: 'info' as const }
  if (item.installation?.installedAt) return { label: 'Em entrega ao paciente', tone: 'info' as const }
  return { label: phaseLabelMap[item.phase], tone: phaseToneMap[item.phase] }
}

export default function CasesPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const isFirebaseMode = DATA_MODE === 'firebase'
  const isRemoteMode = isFirebaseMode
  const currentUser = getCurrentUser(db)
  const [remoteCases, setRemoteCases] = useState<CaseListItem[]>([])
  const [remotePatientsById, setRemotePatientsById] = useState<Map<string, PatientLookup>>(new Map())
  const [remoteClinicsById, setRemoteClinicsById] = useState<Map<string, ClinicLookup>>(new Map())
  const [remoteDentistsById, setRemoteDentistsById] = useState<Map<string, { name: string; shortId?: string; gender?: string }>>(new Map())
  const [remoteLabStatusByCase, setRemoteLabStatusByCase] = useState<Map<string, LiveLabStatus>>(new Map())
  const [remoteHasLabOrderByCase, setRemoteHasLabOrderByCase] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState<'todos' | 'interno' | 'externo'>('todos')
  const [showInTreatment, setShowInTreatment] = useState(true)
  const [showConcluded, setShowConcluded] = useState(false)
  const [isExportingExcel, setIsExportingExcel] = useState(false)

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) return
    ;(async () => {
      const [caseItems, patients, dentists, clinics] = await Promise.all([
        listCasesFirebase(),
        listPatientsFirebase(),
        listDentistsFirebase({ includeDeleted: false, includeInactive: true }),
        listClinicsFirebase({ includeDeleted: false }),
      ])
      if (!active) return

      const patientsMap = new Map<string, PatientLookup>()
      patients.forEach((patient) => {
        patientsMap.set(patient.id, { name: patient.name, shortId: patient.shortId, clinicId: patient.clinicId })
      })
      setRemotePatientsById(patientsMap)

      const dentistsMap = new Map<string, { name: string; shortId?: string; gender?: string }>()
      dentists.forEach((dentist) => {
        dentistsMap.set(dentist.id, { name: dentist.name, shortId: dentist.shortId, gender: dentist.gender })
      })
      setRemoteDentistsById(dentistsMap)

      const clinicsMap = new Map<string, ClinicLookup>()
      clinics.forEach((clinic) => {
        clinicsMap.set(clinic.id, { tradeName: clinic.tradeName })
      })
      setRemoteClinicsById(clinicsMap)
      setRemoteLabStatusByCase(new Map())
      setRemoteHasLabOrderByCase(new Set())
      setRemoteCases(caseItems.map((item) => ({
        id: item.id,
        shortId: item.shortId,
        productType: normalizeProductType(item.productId ?? item.productType),
        treatmentOrigin: inferTreatmentOrigin(
          {
            treatmentOrigin: item.treatmentOrigin,
            clinicId: item.clinicId,
          },
          clinicsMap,
        ),
        clinicId: item.clinicId,
        patientId: item.patientId,
        patientName: item.patientId ? patientsMap.get(item.patientId)?.name ?? item.patientName : item.patientName,
        dentistId: item.dentistId,
        phase: item.phase,
        status: item.status,
        treatmentCode: item.treatmentCode,
        totalTrays: item.totalTrays,
        totalTraysUpper: item.totalTraysUpper,
        totalTraysLower: item.totalTraysLower,
        changeEveryDays: item.changeEveryDays,
        deliveryLots: item.deliveryLots,
        installation: item.installation,
        arch: item.arch,
        caseDate: item.scanDate ?? item.createdAt.slice(0, 10),
      })))
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  const localPatientsById = useMemo(
    () => new Map(db.patients.map((item) => [item.id, { name: item.name, shortId: item.shortId, clinicId: item.clinicId }])),
    [db.patients],
  )
  const localClinicsById = useMemo(
    () => new Map(db.clinics.map((item) => [item.id, { tradeName: item.tradeName }])),
    [db.clinics],
  )
  const localDentistsById = useMemo(
    () => new Map(db.dentists.map((item) => [item.id, { name: item.name, shortId: item.shortId, gender: item.gender }])),
    [db.dentists],
  )
  const localLabStatusByCase = useMemo(
    () =>
      buildLabStatusByCase(
        listLabItemsForUser(db, currentUser).map((item) => ({
          caseId: item.caseId,
          status: item.status,
        })),
      ),
    [db, currentUser],
  )
  const localHasLabOrderByCase = useMemo(
    () =>
      new Set(
        listLabItemsForUser(db, currentUser)
          .map((item) => item.caseId)
          .filter((value): value is string => Boolean(value)),
      ),
    [db, currentUser],
  )
  const localCases = useMemo(
    () =>
      listCasesForUser(db, currentUser).map((item) => ({
        ...item,
        productType: normalizeProductType(item.productId ?? item.productType),
        treatmentOrigin: inferTreatmentOrigin(
          { treatmentOrigin: item.treatmentOrigin, clinicId: item.clinicId },
          localClinicsById,
        ),
        caseDate: item.scanDate ?? item.createdAt.slice(0, 10),
      })) as CaseListItem[],
    [currentUser, db, localClinicsById],
  )

  const cases: CaseListItem[] = isRemoteMode ? remoteCases : localCases
  const patientsById = isRemoteMode ? remotePatientsById : localPatientsById
  const clinicsById = isRemoteMode ? remoteClinicsById : localClinicsById
  const dentistsById = isRemoteMode ? remoteDentistsById : localDentistsById
  const liveLabStatusByCase = isRemoteMode ? remoteLabStatusByCase : localLabStatusByCase
  const hasLabOrderByCase = isRemoteMode ? remoteHasLabOrderByCase : localHasLabOrderByCase

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase()
    return cases
      .filter((item) => {
        const patient = item.patientId ? patientsById.get(item.patientId) : undefined
        const patientName = patient?.name ?? item.patientName
        const patientShortId = item.patientId ? patientsById.get(item.patientId)?.shortId : undefined
        const dentistShortId = item.dentistId ? dentistsById.get(item.dentistId)?.shortId : undefined
        const matchesSearch =
          query.length === 0 ||
          patientName.toLowerCase().includes(query) ||
          (patientShortId ?? '').toLowerCase().includes(query) ||
          (dentistShortId ?? '').toLowerCase().includes(query) ||
          (item.shortId ?? '').toLowerCase().includes(query) ||
          (item.treatmentCode ?? item.id).toLowerCase().includes(query)
        const matchesProduct = isAlignerProductType(item.productType)
        const matchesOrigin = originFilter === 'todos' || resolveCaseOrigin(item, patientsById, clinicsById) === originFilter

        const concluded = isConcluded(item)
        const inProduction = isInProductionFlow(item)
        const matchesStatus =
          (showInTreatment && showConcluded) ||
          (showInTreatment && inProduction && !concluded) ||
          (showConcluded && concluded)

        return matchesSearch && matchesStatus && matchesProduct && matchesOrigin
      })
      .sort((a, b) => {
        const aa = a.caseDate || ''
        const bb = b.caseDate || ''
        return bb.localeCompare(aa)
      })
  }, [cases, clinicsById, dentistsById, originFilter, patientsById, search, showConcluded, showInTreatment])

  const reportRows = useMemo<AlignerTreatmentReportRow[]>(() => {
    return filteredCases.map((item) => {
      const patientName = item.patientId ? (patientsById.get(item.patientId)?.name ?? item.patientName) : item.patientName
      const dentist = item.dentistId ? dentistsById.get(item.dentistId) : undefined
      const totals = resolveAlignerArchTotals(item)
      const deliveredToDentist = resolveDeliveredToDentist(item.deliveryLots)
      const deliveredUpper = Math.min(totals.upper, Math.max(0, Math.trunc(item.installation?.deliveredUpper ?? 0)))
      const deliveredLower = Math.min(totals.lower, Math.max(0, Math.trunc(item.installation?.deliveredLower ?? 0)))
      const badge = caseStatusBadge(
        item,
        liveLabStatusByCase.get(item.id) ?? null,
        hasLabOrderByCase.has(item.id),
      )
      const originLabel = resolveCaseOrigin(item, patientsById, clinicsById) === 'interno' ? 'Interno' : 'Externo'
      const upperSchedule = buildArchScheduleDates(
        item.installation?.installedAt,
        item.changeEveryDays,
        totals.upper,
        buildActualChangeDateMap(item.installation, 'superior'),
      )
      const lowerSchedule = buildArchScheduleDates(
        item.installation?.installedAt,
        item.changeEveryDays,
        totals.lower,
        buildActualChangeDateMap(item.installation, 'inferior'),
      )
      const lastUpperChange = deliveredUpper > 0 ? upperSchedule[deliveredUpper] : undefined
      const lastLowerChange = deliveredLower > 0 ? lowerSchedule[deliveredLower] : undefined
      const nextUpperChange = deliveredUpper < totals.upper ? upperSchedule[deliveredUpper + 1] : undefined
      const nextLowerChange = deliveredLower < totals.lower ? lowerSchedule[deliveredLower + 1] : undefined

      return {
        caseCode: item.treatmentCode ?? item.shortId ?? item.id,
        patientName,
        dentistName: formatDentistDisplayName(dentist),
        plannedTreatment: formatTrayPair(totals.upper, totals.lower, 'sup', 'inf'),
        changeDays: (item.changeEveryDays ?? 0) > 0 ? Math.trunc(item.changeEveryDays ?? 0) : '',
        status: badge.label,
        originLabel,
        deliveredToDentist: formatTrayPair(deliveredToDentist.upper, deliveredToDentist.lower, 'Sup', 'Inf'),
        currentTray: formatTrayPair(deliveredUpper, deliveredLower, 'sup', 'inf'),
        treatmentStartDate: item.installation?.installedAt?.slice(0, 10),
        lastChangeDate: pickMaxIsoDate([lastUpperChange, lastLowerChange]),
        nextChangeDate: pickMinIsoDate([nextUpperChange, nextLowerChange]),
      }
    })
  }, [clinicsById, dentistsById, filteredCases, hasLabOrderByCase, liveLabStatusByCase, patientsById])

  const handleExportExcel = async () => {
    if (reportRows.length === 0) {
      addToast({ type: 'error', title: 'Nenhum caso encontrado para exportar com os filtros atuais.' })
      return
    }
    try {
      setIsExportingExcel(true)
      await downloadAlignerTreatmentReport(reportRows)
      addToast({ type: "success", title: `Relatorio gerado com ${reportRows.length} registro(s).` })
    } catch (error) {
      console.error(error)
      addToast({ type: 'error', title: 'Falha ao gerar o relatorio em Excel. Tente novamente.' })
    } finally {
      setIsExportingExcel(false)
    }
  }

  const toggleInTreatment = () => {
    if (showInTreatment && !showConcluded) return
    setShowInTreatment((current) => !current)
  }

  const toggleConcluded = () => {
    if (showConcluded && !showInTreatment) return
    setShowConcluded((current) => !current)
  }

  return (
    <AppShell breadcrumb={['Início', 'Alinhadores']}>
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Alinhadores</h1>
        
      </section>

      <section className="ui-surface-panel mt-6 rounded-2xl p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto_auto_auto] md:items-center">
          <Input
            className="ui-input-strong"
            placeholder="Buscar por código, paciente ou Nº Caso"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value as 'todos' | 'interno' | 'externo')}
            className="ui-input-strong h-10 w-full rounded-lg px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="todos">Todos</option>
            <option value="interno">Interno</option>
            <option value="externo">Externo</option>
          </select>
          <Button
            variant={showInTreatment ? 'primary' : 'secondary'}
            onClick={toggleInTreatment}
          >
            Ativos
          </Button>
          <Button
            variant={showConcluded ? 'primary' : 'secondary'}
            onClick={toggleConcluded}
          >
            Concluídos
          </Button>
          <Button variant="secondary" onClick={() => void handleExportExcel()} disabled={isExportingExcel || reportRows.length === 0}>
            {isExportingExcel ? 'Gerando Excel...' : 'Gerar Excel'}
          </Button>
        </div>
      </section>

      <section className="mt-6">
        <Card className="ui-surface-panel overflow-hidden p-0">
          <div className="border-b border-slate-300/80 px-5 py-4 text-sm font-semibold text-[#1A202C]">
            {filteredCases.length} registros
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="ui-table-head">
                <tr>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Nº Caso</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Paciente</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Interno/Externo</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Placas Sup/Inf</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Troca (dias)</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Etapa do tratamento</th>
                  <th className="px-5 py-3 text-xs uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/70">
                {filteredCases.map((item) => {
                  const patientName = item.patientId ? (patientsById.get(item.patientId)?.name ?? item.patientName) : item.patientName
                  const dentist = item.dentistId ? dentistsById.get(item.dentistId) : undefined
                  const dentistPrefix = dentist?.gender === 'feminino' ? 'Dra.' : dentist ? 'Dr.' : ''
                  const resolvedUpper =
                    item.arch === 'inferior'
                      ? 0
                      : typeof item.totalTraysUpper === 'number'
                        ? item.totalTraysUpper
                        : (item.totalTrays ?? 0)
                  const resolvedLower =
                    item.arch === 'superior'
                      ? 0
                      : typeof item.totalTraysLower === 'number'
                        ? item.totalTraysLower
                        : (item.totalTrays ?? 0)
                  const traysLabel =
                    item.arch === 'superior'
                      ? `Sup ${resolvedUpper}`
                      : item.arch === 'inferior'
                        ? `Inf ${resolvedLower}`
                        : `Sup ${resolvedUpper} | Inf ${resolvedLower}`
                  const badge = caseStatusBadge(
                    item,
                    liveLabStatusByCase.get(item.id) ?? null,
                    hasLabOrderByCase.has(item.id),
                  )
                  const originLabel = resolveCaseOrigin(item, patientsById, clinicsById) === 'interno' ? 'Interno' : 'Externo'
                  return (
                    <tr key={item.id} className="ui-table-row">
                      <td className="px-5 py-4 text-sm font-bold text-[#1A202C]">{item.treatmentCode ?? item.id}</td>
                      <td className="px-5 py-4">
                        <p className="text-[16px] font-bold text-[#1A202C]">{patientName}</p>
                        <p className="mt-1 text-xs">
                          <span className="ui-label">Data do pedido:</span>{' '}
                          <span className="ui-value">{new Date(`${item.caseDate}T00:00:00`).toLocaleDateString('pt-BR')}</span>
                        </p>
                        {dentist ? (
                          <p className="mt-1 text-xs">
                            <span className="ui-label">Dentista:</span>{' '}
                            <span className="ui-value">{`${dentistPrefix} ${dentist.name}`}</span>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-[#1A202C]">
                        {originLabel}
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-[#1A202C]">
                        {traysLabel}
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-[#1A202C]">{item.changeEveryDays ?? '-'}</td>
                      <td className="px-5 py-4">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          to={`/app/cases/${item.id}`}
                          className="inline-flex items-center rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

    </AppShell>
  )
}



