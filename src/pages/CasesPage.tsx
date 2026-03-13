import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../layouts/AppShell'
import Badge from '../components/Badge'
import Button from '../components/Button'
import AiEditableModal from '../components/ai/AiEditableModal'
import Card from '../components/Card'
import Input from '../components/Input'
import type { CasePhase } from '../types/Case'
import type { ProductType } from '../types/Product'
import { isAlignerProductType, normalizeProductType } from '../types/Product'
import { DATA_MODE } from '../data/dataMode'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { listCasesForUser, listLabItemsForUser } from '../auth/scope'
import { supabase } from '../lib/supabaseClient'
import { runAiEndpoint as runAiRequest } from '../repo/aiRepo'
import { normalizeTreatmentIdsSupabase } from '../repo/profileRepo'
import { useAiModuleEnabled } from '../lib/useAiModuleEnabled'

const phaseLabelMap: Record<CasePhase, string> = {
  planejamento: 'Planejamento',
  orçamento: 'Orçamento',
  contrato_pendente: 'Contrato pendente',
  contrato_aprovado: 'Contrato aprovado',
  em_producao: 'Em producao',
  finalizado: 'Finalizado',
}

const phaseToneMap: Record<CasePhase, 'neutral' | 'info' | 'success'> = {
  planejamento: 'neutral',
  orçamento: 'neutral',
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
  deliveryLots?: unknown[]
  installation?: { installedAt?: string }
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
  if (liveLabStatus === 'em_producao') return { label: 'Em producao', tone: 'info' as const }
  if (liveLabStatus === 'aguardando_iniciar') return { label: 'Aguardando iniciar', tone: 'neutral' as const }
  if ((item.deliveryLots?.length ?? 0) > 0 && !item.installation?.installedAt) return { label: 'Pronto para entrega', tone: 'info' as const }
  if (item.installation?.installedAt) return { label: 'Em entrega ao paciente', tone: 'info' as const }
  return { label: phaseLabelMap[item.phase], tone: phaseToneMap[item.phase] }
}

export default function CasesPage() {
  const { db } = useDb()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const aiComercialEnabled = useAiModuleEnabled('comercial')
  const canAiComercial = can(currentUser, 'ai.comercial') && aiComercialEnabled
  const [supabaseCases, setSupabaseCases] = useState<CaseListItem[]>([])
  const [supabasePatientsById, setSupabasePatientsById] = useState<Map<string, PatientLookup>>(new Map())
  const [supabaseClinicsById, setSupabaseClinicsById] = useState<Map<string, ClinicLookup>>(new Map())
  const [supabaseDentistsById, setSupabaseDentistsById] = useState<Map<string, { name: string; shortId?: string; gender?: string }>>(new Map())
  const [supabaseLabStatusByCase, setSupabaseLabStatusByCase] = useState<Map<string, LiveLabStatus>>(new Map())
  const [supabaseHasLabOrderByCase, setSupabaseHasLabOrderByCase] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState<'todos' | 'interno' | 'externo'>('todos')
  const [showInTreatment, setShowInTreatment] = useState(true)
  const [showConcluded, setShowConcluded] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiModalTitle, setAiModalTitle] = useState('')
  const [aiDraft, setAiDraft] = useState('')

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) return
    ;(async () => {
      const migrationKey = 'orth_treatment_id_migration_v1_done'
      const hasMigrated = typeof window !== 'undefined' && localStorage.getItem(migrationKey) === 'done'
      if (!hasMigrated) {
        const migrated = await normalizeTreatmentIdsSupabase()
        if (migrated.ok && typeof window !== 'undefined') {
          localStorage.setItem(migrationKey, 'done')
        }
      }
      const [casesRes, patientsRes, dentistsRes, clinicsRes, labRes] = await Promise.all([
        supabase
          .from('cases')
          .select('id, clinic_id, patient_id, dentist_id, status, data, created_at, deleted_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('patients').select('id, name, clinic_id, deleted_at').is('deleted_at', null),
        supabase.from('dentists').select('id, name, gender, deleted_at').is('deleted_at', null),
        supabase.from('clinics').select('id, trade_name, deleted_at').is('deleted_at', null),
        supabase.from('lab_items').select('case_id, status, deleted_at').is('deleted_at', null),
      ])
      if (!active) return

      const patientsMap = new Map<string, PatientLookup>()
      for (const row of (patientsRes.data ?? []) as Array<{ id: string; name: string; clinic_id?: string | null }>) {
        patientsMap.set(row.id, { name: row.name ?? '', shortId: undefined, clinicId: row.clinic_id ?? undefined })
      }
      setSupabasePatientsById(patientsMap)

      const dentistsMap = new Map<string, { name: string; shortId?: string; gender?: string }>()
      for (const row of (dentistsRes.data ?? []) as Array<{ id: string; name: string; gender?: string }>) {
        dentistsMap.set(row.id, { name: row.name ?? '', shortId: undefined, gender: row.gender })
      }
      setSupabaseDentistsById(dentistsMap)

      const clinicsMap = new Map<string, ClinicLookup>()
      for (const row of (clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>) {
        clinicsMap.set(row.id, { tradeName: row.trade_name ?? '' })
      }
      setSupabaseClinicsById(clinicsMap)

      setSupabaseLabStatusByCase(
        buildLabStatusByCase(
          ((labRes.data ?? []) as Array<{ case_id?: string; status?: string }>).map((row) => ({
            caseId: row.case_id,
            status: row.status,
          })),
        ),
      )
      setSupabaseHasLabOrderByCase(
        new Set(
          ((labRes.data ?? []) as Array<{ case_id?: string }>)
            .map((row) => row.case_id)
            .filter((value): value is string => Boolean(value)),
        ),
      )

      const mapped = ((casesRes.data ?? []) as Array<{ id: string; clinic_id?: string; patient_id?: string; dentist_id?: string; status?: string; created_at?: string; data?: Record<string, unknown> }>).map((row) => {
        const data = row.data ?? {}
        const status = (data.status as string | undefined) ?? row.status ?? 'planejamento'
        const phaseRaw = (data.phase as string | undefined) ?? ''
        const resolvedClinicId = (data.clinicId as string | undefined) ?? row.clinic_id ?? undefined
        const phase = (
          phaseRaw
          || (
            status === 'finalizado'
              ? 'finalizado'
              : status === 'em_producao'
                || status === 'em_entrega'
                || status === 'em_tratamento'
                || status === 'aguardando_reposicao'
                ? 'em_producao'
                : 'planejamento'
          )
        ) as CasePhase
        const patientName = (data.patientName as string | undefined)
          ?? (row.patient_id ? patientsMap.get(row.patient_id)?.name : undefined)
          ?? '-'
        const caseDate = (data.scanDate as string | undefined) ?? (row.created_at ? row.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
        return {
          id: row.id,
          shortId: (data.shortId as string | undefined) ?? undefined,
          productType: normalizeProductType(data.productId ?? data.productType),
          treatmentOrigin: inferTreatmentOrigin(
            {
              treatmentOrigin: (data.treatmentOrigin as 'interno' | 'externo' | undefined) ?? undefined,
              clinicId: resolvedClinicId,
            },
            clinicsMap,
          ),
          clinicId: resolvedClinicId,
          patientId: row.patient_id,
          patientName,
          dentistId: row.dentist_id,
          phase,
          status,
          treatmentCode: data.treatmentCode as string | undefined,
          totalTrays: data.totalTrays as number | undefined,
          totalTraysUpper: data.totalTraysUpper as number | undefined,
          totalTraysLower: data.totalTraysLower as number | undefined,
          changeEveryDays: data.changeEveryDays as number | undefined,
          deliveryLots: (data.deliveryLots as unknown[] | undefined) ?? [],
          installation: (data.installation as { installedAt?: string } | undefined) ?? undefined,
          arch: (data.arch as 'superior' | 'inferior' | 'ambos' | undefined) ?? 'ambos',
          caseDate,
        } as CaseListItem
      })
      setSupabaseCases(mapped)
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode])

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

  const cases: CaseListItem[] = isSupabaseMode ? supabaseCases : localCases
  const patientsById = isSupabaseMode ? supabasePatientsById : localPatientsById
  const clinicsById = isSupabaseMode ? supabaseClinicsById : localClinicsById
  const dentistsById = isSupabaseMode ? supabaseDentistsById : localDentistsById
  const liveLabStatusByCase = isSupabaseMode ? supabaseLabStatusByCase : localLabStatusByCase
  const hasLabOrderByCase = isSupabaseMode ? supabaseHasLabOrderByCase : localHasLabOrderByCase

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

  const toggleInTreatment = () => {
    if (showInTreatment && !showConcluded) return
    setShowInTreatment((current) => !current)
  }

  const toggleConcluded = () => {
    if (showConcluded && !showInTreatment) return
    setShowConcluded((current) => !current)
  }

  const runComercialAi = async (endpoint: '/comercial/script' | '/comercial/resumo-leigo' | '/comercial/followup', title: string) => {
    if (!canAiComercial) return
    const reference = filteredCases.find((item) => item.phase === 'orçamento' || item.phase === 'contrato_pendente') ?? filteredCases[0]
    if (!reference) return
    const result = await runAiRequest(endpoint, {
      clinicId: currentUser?.linkedClinicId,
      inputText: `Caso ${reference.treatmentCode ?? reference.shortId ?? reference.id}. Paciente ${reference.patientName}. Fase ${reference.phase}. Status ${reference.status}.`,
      metadata: {
        patientId: reference.patientId,
        dentistId: reference.dentistId,
        totalTraysUpper: reference.totalTraysUpper,
        totalTraysLower: reference.totalTraysLower,
      },
    })
    if (!result.ok) return
    setAiModalTitle(title)
    setAiDraft(result.output)
    setAiModalOpen(true)
  }

  return (
    <AppShell breadcrumb={['Início', 'Alinhadores']}>
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Alinhadores</h1>
        <p className="mt-2 text-sm text-slate-500">Gestao dos alinhadores com fluxo clinico e esteira de producao.</p>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_auto_auto] md:items-center">
          <Input
            placeholder="Buscar por codigo, paciente ou Nº Caso"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value as 'todos' | 'interno' | 'externo')}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
            Concluidos
          </Button>
        </div>
        {canAiComercial ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void runComercialAi('/comercial/script', 'Script WhatsApp')}>
              Script WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => void runComercialAi('/comercial/resumo-leigo', 'Resumo leigo')}>
              Resumo leigo
            </Button>
            <Button variant="secondary" onClick={() => void runComercialAi('/comercial/followup', 'Follow-up')}>
              Follow-up
            </Button>
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4 text-sm font-medium text-slate-700">
            {filteredCases.length} registros
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nº Caso</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Paciente</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Interno/Externo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Placas Sup/Inf</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Troca (dias)</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Etapa do tratamento</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
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
                    <tr key={item.id} className="bg-white">
                      <td className="px-5 py-4 text-sm font-semibold text-slate-800">{item.treatmentCode ?? item.id}</td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-slate-900">{patientName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Data do pedido: {new Date(`${item.caseDate}T00:00:00`).toLocaleDateString('pt-BR')}
                        </p>
                        {dentist ? (
                          <p className="mt-1 text-xs text-slate-500">Dentista: {`${dentistPrefix} ${dentist.name}`}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        {originLabel}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        {traysLabel}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">{item.changeEveryDays ?? '-'}</td>
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

      <AiEditableModal
        open={aiModalOpen}
        title={aiModalTitle}
        value={aiDraft}
        onChange={setAiDraft}
        onClose={() => setAiModalOpen(false)}
        onSave={() => {
          setAiModalOpen(false)
        }}
        saveLabel="Salvar rascunho"
      />
    </AppShell>
  )
}

