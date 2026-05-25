import { DB_KEY, loadDb } from '../data/db'
import { DATA_MODE } from '../data/dataMode'
import { permissionsForRole, can } from '../auth/permissions'
import type { Role, User } from '../types/User'
import { listPatientsForUser, listScansForUser, listCasesForUser } from '../auth/scope'
import { listPatients } from '../repo/patientRepo'
import { listDentists } from '../data/dentistRepo'
import { listClinics } from '../repo/clinicRepo'
import { listScans } from '../data/scanRepo'
import { listCases } from '../data/caseRepo'
import { listLabItems } from '../data/labRepo'
import { markPatientDocAsError } from '../repo/patientDocsRepo'
import { markScanAttachmentError } from '../data/scanRepo'
import { markCaseScanFileError } from '../data/caseRepo'
import { APP_ROUTE_PATHS } from '../routes/appRoutes'

export type DiagnosticStatus = 'pass' | 'fail' | 'warn'

export type DiagnosticItem = {
  id: string
  title: string
  status: DiagnosticStatus
  message: string
  details?: string
  fixHint?: string
}

export type DiagnosticReport = {
  startedAt: string
  finishedAt: string
  durationMs: number
  items: DiagnosticItem[]
}

const REQUIRED_ROUTES = [
  '/login',
  '/app/dashboard',
  '/app/agenda',
  '/app/scans',
  '/app/cases',
  '/app/lab',
  '/app/patients',
  '/app/dentists',
  '/app/clinics',
  '/app/settings',
]

const DIAG_PREFIX = 'diag_'

function nowIso() {
  return new Date().toISOString()
}

function safeLocalStorage() {
  try {
    const key = '__diag_probe__'
    window.localStorage.setItem(key, '1')
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function detectDiagData(ids: string[]) {
  return ids.some((id) => id.startsWith(DIAG_PREFIX))
}

async function pingViaCep(timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch('https://viacep.com.br/ws/01001000/json/', { signal: controller.signal })
    if (!response.ok) return false
    const data = (await response.json()) as { cep?: string }
    return Boolean(data?.cep)
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export async function runDiagnostics(): Promise<DiagnosticReport> {
  const startedAt = nowIso()
  const items: DiagnosticItem[] = []
  const db = loadDb()

  const appMode = import.meta.env.MODE
  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? ''
  const storageOk = safeLocalStorage()
  items.push({
    id: 'env_mode',
    title: 'Ambiente',
    status: 'pass',
    message: `Modo: ${appMode}${appVersion ? ` | Versao: ${appVersion}` : ''}`,
    details: 'Import.meta.env.MODE e VITE_APP_VERSION (se definido).',
  })
  items.push({
    id: 'env_data_mode',
    title: 'Data mode',
    status: 'pass',
    message: `DATA_MODE: ${DATA_MODE}`,
  })
  items.push({
    id: 'env_storage',
    title: 'LocalStorage',
    status: storageOk ? 'pass' : 'fail',
    message: storageOk ? 'LocalStorage disponível.' : 'LocalStorage indisponível.',
    fixHint: storageOk ? undefined : 'Verifique bloqueio do navegador ou modo privado.',
  })
  const hasDbKey = storageOk ? window.localStorage.getItem(DB_KEY) !== null : false
  items.push({
    id: 'env_db_key',
    title: 'DB Key',
    status: hasDbKey ? 'pass' : 'warn',
    message: hasDbKey ? 'Chave do DB encontrada no localStorage.' : 'DB ainda não inicializado no localStorage.',
    fixHint: hasDbKey ? undefined : 'Abra a aplicacao e salve algum dado para inicializar o DB.',
  })
  const viaCepOk = await pingViaCep()
  items.push({
    id: 'viacep.ping',
    title: 'ViaCEP disponível',
    status: viaCepOk ? 'pass' : 'warn',
    message: viaCepOk ? 'ViaCEP respondeu com sucesso.' : 'ViaCEP indisponível ou sem rede.',
    fixHint: viaCepOk ? undefined : 'Sem internet/HTTPS/ViaCEP indisponível.',
  })

  const missingCollections: string[] = []
  if (!Array.isArray(db.patients)) missingCollections.push('patients')
  if (!Array.isArray(db.users)) missingCollections.push('users')
  if (!Array.isArray(db.dentists)) missingCollections.push('dentists')
  if (!Array.isArray(db.clinics)) missingCollections.push('clinics')
  if (!Array.isArray(db.scans)) missingCollections.push('scans')
  if (!Array.isArray(db.cases)) missingCollections.push('cases')
  if (!Array.isArray(db.labItems)) missingCollections.push('labItems')
  items.push({
    id: 'db_collections',
    title: 'DB & Migracoes',
    status: missingCollections.length === 0 ? 'pass' : 'fail',
    message: missingCollections.length === 0 ? 'Colecoes principais presentes.' : `Faltando: ${missingCollections.join(', ')}.`,
    fixHint: missingCollections.length === 0 ? undefined : 'Revise db.ts e migracoes recentes.',
  })

  const missingRoutes = REQUIRED_ROUTES.filter((route) => !APP_ROUTE_PATHS.includes(route))
  items.push({
    id: 'routes_core',
    title: 'Rotas essenciais',
    status: missingRoutes.length === 0 ? 'pass' : 'fail',
    message: missingRoutes.length === 0 ? 'Rotas principais presentes.' : `Rotas ausentes: ${missingRoutes.join(', ')}`,
    details: `Lista de rotas verificada em appRoutes.ts (${APP_ROUTE_PATHS.length} rotas).`,
    fixHint: missingRoutes.length === 0 ? undefined : 'Atualize as rotas no App.tsx.',
  })

  const repoChecks: Array<{ id: string; title: string; fn: unknown }> = [
    { id: 'repo_patients', title: 'patientRepo.listPatients', fn: listPatients },
    { id: 'repo_dentists', title: 'dentistRepo.listDentists', fn: listDentists },
    { id: 'repo_clinics', title: 'clinicRepo.listClinics', fn: listClinics },
    { id: 'repo_scans', title: 'scanRepo.listScans', fn: listScans },
    { id: 'repo_cases', title: 'caseRepo.listCases', fn: listCases },
    { id: 'repo_lab', title: 'labRepo.listLabItems', fn: listLabItems },
  ]
  const missingRepos = repoChecks.filter((item) => typeof item.fn !== 'function').map((item) => item.title)
  items.push({
    id: 'modules_repos',
    title: 'Modulos (Repos)',
    status: missingRepos.length === 0 ? 'pass' : 'warn',
    message: missingRepos.length === 0 ? 'Repos principais encontrados.' : `Repos ausentes: ${missingRepos.join(', ')}`,
    fixHint: missingRepos.length === 0 ? undefined : 'Revise exports nos repos.',
  })

  const roles: Role[] = [
    'master_admin',
    'dentist_admin',
    'dentist_client',
    'clinic_client',
    'lab_tech',
    'receptionist',
  ]
  const missingRoles = roles.filter((role) => permissionsForRole(role).length === 0)
  const rbacStatus: DiagnosticStatus = missingRoles.length === 0 ? 'pass' : 'warn'
  items.push({
    id: 'rbac_roles',
    title: 'Permissoes (RBAC)',
    status: rbacStatus,
    message: missingRoles.length === 0 ? 'Perfis principais encontrados.' : `Perfis sem permissoes: ${missingRoles.join(', ')}`,
    fixHint: missingRoles.length === 0 ? undefined : 'Executar Prompt 22 / ajustar permissions.ts.',
  })

  const master: User = { id: 'diag_master', name: 'Master', email: 'diag@local', role: 'master_admin', isActive: true, createdAt: startedAt, updatedAt: startedAt }
  const dentistAdmin: User = { id: 'diag_admin', name: 'Admin', email: 'diag_admin@local', role: 'dentist_admin', isActive: true, createdAt: startedAt, updatedAt: startedAt }
  const labTech: User = { id: 'diag_lab', name: 'Lab', email: 'diag_lab@local', role: 'lab_tech', isActive: true, createdAt: startedAt, updatedAt: startedAt }
  const receptionist: User = { id: 'diag_recep', name: 'Recep', email: 'diag_recep@local', role: 'receptionist', isActive: true, createdAt: startedAt, updatedAt: startedAt }

  const permIssues: string[] = []
  if (!can(master, 'users.delete')) permIssues.push('master_admin sem users.delete')
  if (!can(dentistAdmin, 'users.delete')) permIssues.push('dentist_admin sem users.delete')
  if (can(labTech, 'patients.write')) permIssues.push('lab_tech com patients.write')
  if (can(receptionist, 'users.write')) permIssues.push('receptionist com users.write')
  items.push({
    id: 'rbac_rules',
    title: 'Permissoes (Regras)',
    status: permIssues.length === 0 ? 'pass' : 'fail',
    message: permIssues.length === 0 ? 'Regras de permissão OK.' : `Falhas: ${permIssues.join('; ')}`,
    fixHint: permIssues.length === 0 ? undefined : 'Revisar rolePermissions em permissions.ts.',
  })

  const hasDiagData =
    detectDiagData(db.clinics.map((item) => item.id)) &&
    detectDiagData(db.dentists.map((item) => item.id)) &&
    detectDiagData(db.patients.map((item) => item.id)) &&
    detectDiagData(db.scans.map((item) => item.id)) &&
    detectDiagData(db.cases.map((item) => item.id))

  if (!hasDiagData) {
    items.push({
      id: 'scope_check',
      title: 'Escopo (Dentista/Clínica)',
      status: 'warn',
      message: 'Dados de teste não encontrados.',
      fixHint: 'Clique em "Criar dados de teste" e rode novamente.',
    })
  } else {
    const dentistClient = db.users.find((item) => item.id === 'diag_user_dentist_client') ?? null
    const clinicClient = db.users.find((item) => item.id === 'diag_user_clinic_client') ?? null
    const patientsDent = listPatientsForUser(db, dentistClient)
    const patientsClinic = listPatientsForUser(db, clinicClient)
    const scansDent = listScansForUser(db, dentistClient)
    const casesClinic = listCasesForUser(db, clinicClient)
    const ok =
      patientsDent.every((item) => item.id === 'diag_patient_p1') &&
      patientsClinic.every((item) => item.id === 'diag_patient_p1') &&
      scansDent.every((item) => item.id === 'diag_scan_s1') &&
      casesClinic.every((item) => item.id === 'diag_case_k1')
    items.push({
      id: 'scope_check',
      title: 'Escopo (Dentista/Clínica)',
      status: ok ? 'pass' : 'fail',
      message: ok ? 'Escopo aplicado corretamente.' : 'Escopo com vazamento ou retorno incorreto.',
      details: `Dentista cliente - pacientes: ${patientsDent.map((item) => item.id).join(', ') || '-'} | Clínica cliente - pacientes: ${patientsClinic.map((item) => item.id).join(', ') || '-'} | Exames: ${scansDent.map((item) => item.id).join(', ') || '-'} | Casos: ${casesClinic.map((item) => item.id).join(', ') || '-'}`,
      fixHint: ok ? undefined : 'Revisar auth/scope.ts e relacionamentos clinicId/dentistId.',
    })
  }

  const docChecks = [
    { id: 'docs_patient', title: 'patientDocsRepo.markPatientDocAsError', fn: markPatientDocAsError },
    { id: 'docs_scan', title: 'scanRepo.markScanAttachmentError', fn: markScanAttachmentError },
    { id: 'docs_case', title: 'caseRepo.markCaseScanFileError', fn: markCaseScanFileError },
  ]
  const missingDocFns = docChecks.filter((item) => typeof item.fn !== 'function').map((item) => item.title)
  const docsWithErrorMissingNote = db.patientDocuments.filter((doc) => doc.status === 'erro' && !doc.errorNote)
  items.push({
    id: 'docs_rules',
    title: 'Anexos/Docs (histórico)',
    status: missingDocFns.length === 0 && docsWithErrorMissingNote.length === 0 ? 'pass' : 'warn',
    message:
      missingDocFns.length === 0
        ? docsWithErrorMissingNote.length === 0
          ? 'Regras de erro presentes.'
          : `Documentos com erro sem motivo: ${docsWithErrorMissingNote.length}.`
        : `Funcoes ausentes: ${missingDocFns.join(', ')}`,
    fixHint: missingDocFns.length === 0 ? undefined : 'Revisar repos de documentos e anexos.',
  })

  const allowedLabStatuses = new Set(['aguardando_iniciar', 'em_producao', 'controle_qualidade', 'prontas'])
  const invalidLab = db.labItems.filter((item) => !allowedLabStatuses.has(item.status))
  items.push({
    id: 'lab_status',
    title: 'LAB pipeline',
    status: invalidLab.length === 0 ? 'pass' : 'warn',
    message: invalidLab.length === 0 ? 'Status do LAB ok.' : `Status fora do esperado: ${invalidLab.map((item) => item.status).join(', ')}`,
    fixHint: invalidLab.length === 0 ? undefined : 'Revisar migração de status do LAB.',
  })

  const finishedAt = nowIso()
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  return { startedAt, finishedAt, durationMs, items }
}

