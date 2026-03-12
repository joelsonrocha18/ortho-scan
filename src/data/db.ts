import type { Case, CaseAttachment, CasePhase, CaseStatus, CaseTray, TrayState } from '../types/Case'
import type { LabItem } from '../types/Lab'
import type { Patient } from '../types/Patient'
import type { PatientDocument } from '../types/PatientDocument'
import type { Scan, ScanArch, ScanAttachment, ScanStatus } from '../types/Scan'
import type { DentistClinic } from '../types/DentistClinic'
import type { User } from '../types/User'
import type { Clinic } from '../types/Clinic'
import type { AuditLog } from '../types/Audit'
import type { ProductType } from '../types/Product'
import type { ReplacementBankEntry } from '../types/ReplacementBank'
import { normalizeProductType } from '../types/Product'
import { emitDbChanged } from '../lib/events'
import { nextOrthTreatmentCode, normalizeOrthTreatmentCode } from '../lib/treatmentCode'
import { DATA_MODE } from './dataMode'

export const DB_KEY = 'arrimo_orthoscan_db_v1'
const DB_MODE_KEY = 'arrimo_orthoscan_seed_mode_v1'
const HOTFIX_RESET_JOELSON_TREATMENT_KEY = 'arrimo_hotfix_reset_joelson_treatment_v1'
const HOTFIX_RESET_JOELSON_TARGET = 'JOELSON DOS ANJOS ROCHA'
const SEED_MODE: 'full' | 'empty' = 'full'
const MASTER_EMAIL: string | undefined = 'master@orthoscan.local'
const LOCAL_DEFAULT_PASSWORD: string | undefined = 'Ortho@1234'
const FULL_DEMO_INTRA_SLOTS = [
  'intra_frontal',
  'intra_lateral_dir',
  'intra_lateral_esq',
  'intra_oclusal_sup',
  'intra_oclusal_inf',
]
const FULL_DEMO_EXTRA_SLOTS = [
  'extra_face_frontal',
  'extra_face_lateral_dir',
  'extra_face_lateral_esq',
  'extra_diagonal_dir',
  'extra_diagonal_esq',
  'extra_sorriso_frontal',
]

export type AppDb = {
  cases: Case[]
  labItems: LabItem[]
  replacementBank: ReplacementBankEntry[]
  patients: Patient[]
  patientDocuments: PatientDocument[]
  scans: Scan[]
  dentists: DentistClinic[]
  clinics: Clinic[]
  users: User[]
  auditLogs: AuditLog[]
  [key: string]: unknown
}

type LegacyCase = {
  id: string
  shortId?: string
  productType?: ProductType
  productId?: ProductType
  requestedProductId?: string
  requestedProductLabel?: string
  paciente?: { nome?: string }
  data_scan?: string
  planejamento?: { quantidade_total_placas?: number; troca_a_cada_dias?: number }
  status?: CaseStatus
  phase?: CasePhase
  budget?: Case['budget']
  contract?: Case['contract']
  deliveryLots?: Case['deliveryLots']
  installation?: Case['installation']
  patientName?: string
  patientId?: string
  scanDate?: string
  totalTrays?: number
  changeEveryDays?: number
  trays?: CaseTray[]
  attachments?: CaseAttachment[]
  sourceScanId?: string
  arch?: ScanArch
  complaint?: string
  dentistGuidance?: string
  dentistId?: string
  requestedByDentistId?: string
  clinicId?: string
  treatmentCode?: string
  treatmentOrigin?: 'interno' | 'externo'
  scanAttachments?: Array<{
    id: string
    name: string
    type?: string
    kind?: string
    slotId?: string
    rxType?: string
    arch?: string
    isLocal?: boolean
    url?: string
    filePath?: string
    status?: 'ok' | 'erro'
    attachedAt?: string
    note?: string
    flaggedAt?: string
    flaggedReason?: string
    createdAt?: string
  }>
  scanFiles?: Array<{
    id: string
    name: string
    kind?: string
    slotId?: string
    rxType?: string
    arch?: string
    isLocal?: boolean
    url?: string
    filePath?: string
    status?: 'ok' | 'erro'
    attachedAt?: string
    note?: string
    flaggedAt?: string
    flaggedReason?: string
    createdAt?: string
  }>
  totalTraysUpper?: number
  totalTraysLower?: number
  attachmentBondingTray?: boolean
  createdAt?: string
  updatedAt?: string
}

type LegacyScan = Partial<Scan> & {
  id: string
  shortId?: string
  serviceOrderCode?: string
  purposeProductId?: string
  purposeProductType?: string
  purposeLabel?: string
  patientId?: string
  dentistId?: string
  requestedByDentistId?: string
  clinicId?: string
  attachments?: Array<
    Partial<ScanAttachment> & {
      type?: string
    }
  >
}

type LegacyLabItem = Partial<LabItem> & { id: string }
type LegacyDentistClinic = Partial<DentistClinic> & { id: string }
type LegacyPatientDocument = Partial<PatientDocument> & { id: string }
type LegacyUser = Partial<User> & { id: string }
type LegacyClinic = Partial<Clinic> & { id: string }

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function daysFrom(baseDate: string, days: number) {
  const date = new Date(`${baseDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

function daysFromNow(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

function nowIso() {
  return new Date().toISOString()
}

function patientIdFromName(name: string) {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `pat_${normalized || 'sem_nome'}`
}

function normalizeName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function isArrimoClinic(clinic?: Pick<Clinic, 'id' | 'tradeName'> | null) {
  if (!clinic) return false
  if (clinic.id === 'clinic_arrimo') return true
  return clinic.tradeName.trim().toUpperCase() === 'ARRIMO'
}

function inferCaseOrigin(caseItem: Pick<Case, 'clinicId'>, clinicsById: Map<string, Clinic>): 'interno' | 'externo' {
  if (!caseItem.clinicId) return 'externo'
  return isArrimoClinic(clinicsById.get(caseItem.clinicId) ?? null) ? 'interno' : 'externo'
}

function ensureTreatmentCodes(cases: Case[], clinics: Clinic[]) {
  const clinicsById = new Map(clinics.map((item) => [item.id, item]))
  const used = cases
    .map((item) => normalizeOrthTreatmentCode(item.treatmentCode))
    .filter((item): item is string => Boolean(item))
  const sorted = [...cases].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const normalized = new Map<string, Case>()
  sorted.forEach((item) => {
    const origin = item.treatmentOrigin ?? inferCaseOrigin(item, clinicsById)
    const persistedCode = normalizeOrthTreatmentCode(item.treatmentCode)
    const code = persistedCode || nextOrthTreatmentCode(used)
    if (!persistedCode) {
      used.push(code)
    }
    normalized.set(item.id, { ...item, treatmentOrigin: origin, treatmentCode: code })
  })

  return cases.map((item) => normalized.get(item.id) ?? item)
}

function isObjectUrl(url?: string) {
  return Boolean(url && url.startsWith('blob:'))
}

function statusForTray(index: number, total: number): TrayState {
  if (index === 5) return 'rework'
  if (index <= Math.min(4, total)) return 'entregue'
  if (index <= Math.min(8, total)) return 'pronta'
  if (index <= Math.min(12, total)) return 'em_producao'
  return 'pendente'
}

function buildTrays(scanDate: string, totalTrays: number, changeEveryDays: number) {
  const trays: CaseTray[] = []
  for (let tray = 1; tray <= totalTrays; tray += 1) {
    const state = statusForTray(tray, totalTrays)
    trays.push({
      trayNumber: tray,
      state,
      dueDate: daysFrom(scanDate, changeEveryDays * tray),
      deliveredAt: state === 'entregue' ? daysFrom(scanDate, changeEveryDays * tray) : undefined,
      notes: state === 'rework' ? 'Reavaliar ajuste da placa.' : undefined,
    })
  }
  return trays
}

function buildPendingTrays(scanDate: string, totalTrays: number, changeEveryDays: number): CaseTray[] {
  const trays: CaseTray[] = []
  const base = new Date(`${scanDate}T00:00:00`)
  for (let tray = 1; tray <= totalTrays; tray += 1) {
    const due = new Date(base)
    due.setDate(due.getDate() + changeEveryDays * tray)
    trays.push({ trayNumber: tray, state: 'pendente', dueDate: due.toISOString().slice(0, 10) })
  }
  return trays
}

function mapLegacyKind(item: { kind?: string; type?: string; rxType?: string; arch?: string }) {
  if (item.kind) return item.kind
  if (item.type === 'stl') return 'scan3d'
  if (item.type === 'foto') return 'foto_intra'
  if (item.type === 'raiox') return item.rxType === 'tomografia' ? 'dicom' : 'raiox'
  if (item.type === 'outro') return 'outro'
  return 'outro'
}

function phaseFromStatus(status: CaseStatus): CasePhase {
  if (status === 'finalizado') return 'finalizado'
  if (status === 'em_producao' || status === 'em_entrega' || status === 'em_tratamento' || status === 'aguardando_reposicao') return 'em_producao'
  return 'planejamento'
}

function mockCaseAttachments(caseId: string): CaseAttachment[] {
  return [
    { id: `att_${caseId}_1`, name: 'scan_intraoral.pdf', type: 'scan', url: 'https://example.com/scan_intraoral.pdf', createdAt: nowIso() },
    { id: `att_${caseId}_2`, name: 'planejamento.png', type: 'outro', url: 'https://example.com/planejamento.png', createdAt: nowIso() },
  ]
}

function seedPatients(): Patient[] {
  const now = nowIso()
  const seed: Array<Patient> = [
    {
      id: 'pat_maria_silva',
      name: 'Maria Silva',
      cpf: '123.456.789-10',
      phone: '(11) 3344-5500',
      whatsapp: '(11) 99888-1111',
      email: 'maria.silva@paciente.local',
      birthDate: '1991-02-10',
      gender: 'feminino',
      clinicId: 'clinic_arrimo',
      primaryDentistId: 'dent_demo',
      notes: 'Caso de alinhador em fase de produção.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pat_joao_santos',
      name: 'Joao Santos',
      cpf: '222.333.444-55',
      phone: '(11) 3232-1212',
      whatsapp: '(11) 99777-2222',
      email: 'joao.santos@paciente.local',
      birthDate: '1988-07-22',
      gender: 'masculino',
      clinicId: 'clinic_arrimo',
      primaryDentistId: 'dent_demo',
      notes: 'Caso em orçamento.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pat_ana_costa',
      name: 'Ana Costa',
      cpf: '333.444.555-66',
      phone: '(11) 3040-2020',
      whatsapp: '(11) 99666-3333',
      email: 'ana.costa@paciente.local',
      birthDate: '1994-11-05',
      gender: 'feminino',
      clinicId: 'clinic_arrimo',
      primaryDentistId: 'dent_demo',
      notes: 'Caso em entrega.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pat_bruno_ramos',
      name: 'Bruno Ramos',
      cpf: '444.555.666-77',
      phone: '(21) 3111-1414',
      whatsapp: '(21) 99555-4444',
      email: 'bruno.ramos@paciente.local',
      birthDate: '1985-03-28',
      gender: 'masculino',
      clinicId: 'clinic_parceira',
      primaryDentistId: 'dent_parceiro_1',
      notes: 'Contrato pendente.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pat_luiza_ferreira',
      name: 'Luiza Ferreira',
      cpf: '555.666.777-88',
      phone: '(21) 3444-8888',
      whatsapp: '(21) 99444-5555',
      email: 'luiza.ferreira@paciente.local',
      birthDate: '1997-09-14',
      gender: 'feminino',
      clinicId: 'clinic_parceira',
      primaryDentistId: 'dent_parceiro_2',
      notes: 'Planejamento inicial.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: patientIdFromName('Paciente Demo Completo'),
      name: 'Paciente Demo Completo',
      clinicId: 'clinic_arrimo',
      primaryDentistId: 'dent_demo',
      createdAt: now,
      updatedAt: now,
    },
  ]
  return seed
}

function seedCases(): Case[] {
  const now = nowIso()
  const finishedInstallationDate = daysFromNow(-45)
  return [
    {
      id: 'case_001',
      patientName: 'Maria Silva',
      patientId: 'pat_maria_silva',
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      productType: 'alinhador_12m',
      productId: 'alinhador_12m',
      scanDate: daysFromNow(-40),
      totalTrays: 24,
      totalTraysUpper: 24,
      totalTraysLower: 24,
      changeEveryDays: 7,
      status: 'em_producao',
      phase: 'em_producao',
      budget: { value: 15900, notes: 'Plano premium', createdAt: now },
      contract: { status: 'aprovado', approvedAt: daysFromNow(-35), notes: 'Contrato assinado digitalmente.' },
      trays: buildTrays(daysFromNow(-40), 24, 7),
      attachments: mockCaseAttachments('case_001'),
      deliveryLots: [],
      installation: undefined,
      arch: 'ambos',
      complaint: 'Apinhamento anterior superior e inferior.',
      dentistGuidance: 'Controle de torque em incisivos.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'case_002',
      patientName: 'Joao Santos',
      patientId: 'pat_joao_santos',
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      productType: 'alinhador_6m',
      productId: 'alinhador_6m',
      scanDate: daysFromNow(-20),
      totalTrays: 18,
      totalTraysUpper: 18,
      totalTraysLower: 18,
      changeEveryDays: 10,
      status: 'planejamento',
      phase: 'orçamento',
      budget: { value: 9800, notes: 'Aguardando aprovação comercial.', createdAt: now },
      contract: { status: 'pendente' },
      trays: buildPendingTrays(daysFromNow(-20), 18, 10),
      attachments: mockCaseAttachments('case_002'),
      deliveryLots: [],
      installation: undefined,
      arch: 'ambos',
      complaint: 'Mordida cruzada posterior.',
      dentistGuidance: 'Setup com expansão leve.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'case_003',
      patientName: 'Ana Costa',
      patientId: 'pat_ana_costa',
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      productType: 'alinhador_3m',
      productId: 'alinhador_3m',
      scanDate: daysFromNow(-70),
      totalTrays: 10,
      totalTraysUpper: 10,
      totalTraysLower: 10,
      changeEveryDays: 10,
      status: 'em_entrega',
      phase: 'em_producao',
      budget: { value: 6500, notes: 'Plano curto.', createdAt: now },
      contract: { status: 'aprovado', approvedAt: daysFromNow(-60) },
      trays: buildTrays(daysFromNow(-70), 10, 10),
      attachments: mockCaseAttachments('case_003'),
      deliveryLots: [
        {
          id: 'lot_case_003_1',
          arch: 'ambos',
          fromTray: 1,
          toTray: 4,
          quantity: 4,
          deliveredToDoctorAt: daysFromNow(-30),
          note: 'Entrega parcial ao profissional.',
          createdAt: now,
        },
      ],
      installation: {
        installedAt: daysFromNow(-28),
        note: 'Primeira instalação concluída.',
        deliveredUpper: 4,
        deliveredLower: 4,
      },
      arch: 'ambos',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'case_004',
      patientName: 'Bruno Ramos',
      patientId: 'pat_bruno_ramos',
      dentistId: 'dent_parceiro_1',
      requestedByDentistId: 'dent_parceiro_1',
      clinicId: 'clinic_parceira',
      productType: 'placa_bruxismo',
      productId: 'placa_bruxismo',
      scanDate: daysFromNow(-12),
      totalTrays: 1,
      totalTraysUpper: 1,
      totalTraysLower: 0,
      changeEveryDays: 30,
      status: 'planejamento',
      phase: 'contrato_pendente',
      budget: { value: 1300, notes: 'Aguardando aceite do paciente.', createdAt: now },
      contract: { status: 'pendente', notes: 'Contrato enviado por WhatsApp.' },
      trays: buildPendingTrays(daysFromNow(-12), 1, 30),
      attachments: mockCaseAttachments('case_004'),
      deliveryLots: [],
      installation: undefined,
      arch: 'superior',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'case_005',
      patientName: 'Luiza Ferreira',
      patientId: 'pat_luiza_ferreira',
      dentistId: 'dent_parceiro_2',
      requestedByDentistId: 'dent_parceiro_2',
      clinicId: 'clinic_parceira',
      productType: 'contencao',
      productId: 'contencao',
      scanDate: daysFromNow(-10),
      totalTrays: 1,
      totalTraysUpper: 1,
      totalTraysLower: 1,
      changeEveryDays: 30,
      status: 'planejamento',
      phase: 'contrato_aprovado',
      budget: { value: 1700, notes: 'Contrato aprovado, aguardando OS.', createdAt: now },
      contract: { status: 'aprovado', approvedAt: daysFromNow(-8) },
      trays: buildPendingTrays(daysFromNow(-10), 1, 30),
      attachments: mockCaseAttachments('case_005'),
      deliveryLots: [],
      installation: undefined,
      arch: 'ambos',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'case_006',
      patientName: 'Paciente Demo Completo',
      patientId: patientIdFromName('Paciente Demo Completo'),
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      productType: 'alinhador_12m',
      productId: 'alinhador_12m',
      scanDate: daysFromNow(-140),
      totalTrays: 20,
      totalTraysUpper: 20,
      totalTraysLower: 20,
      changeEveryDays: 7,
      status: 'finalizado',
      phase: 'finalizado',
      budget: { value: 12900, notes: 'Caso encerrado com sucesso.', createdAt: now },
      contract: { status: 'aprovado', approvedAt: daysFromNow(-130) },
      trays: buildTrays(daysFromNow(-140), 20, 7).map((tray) => ({ ...tray, state: 'entregue', deliveredAt: daysFromNow(-30) })),
      attachments: mockCaseAttachments('case_006'),
      deliveryLots: [
        {
          id: 'lot_case_006_1',
          arch: 'ambos',
          fromTray: 1,
          toTray: 20,
          quantity: 20,
          deliveredToDoctorAt: daysFromNow(-60),
          note: 'Lotes completos entregues.',
          createdAt: now,
        },
      ],
      installation: {
        installedAt: finishedInstallationDate,
        note: 'Tratamento finalizado e contido.',
        deliveredUpper: 20,
        deliveredLower: 20,
      },
      arch: 'ambos',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function seedLabItems(): LabItem[] {
  const timestamp = nowIso()
  return [
    { id: 'lab_001', caseId: 'case_001', clinicId: 'clinic_arrimo', patientId: 'pat_maria_silva', dentistId: 'dent_demo', productType: 'alinhador_12m', productId: 'alinhador_12m', requestCode: 'OS-1001', requestKind: 'producao', arch: 'ambos', trayNumber: 11, plannedUpperQty: 2, plannedLowerQty: 2, planningDefinedAt: timestamp, plannedDate: daysFromNow(-4), dueDate: daysFromNow(-1), status: 'aguardando_iniciar', priority: 'Medio', notes: 'Aguardando liberar produção.', patientName: 'Maria Silva', createdAt: timestamp, updatedAt: timestamp },
    { id: 'lab_002', caseId: 'case_001', clinicId: 'clinic_arrimo', patientId: 'pat_maria_silva', dentistId: 'dent_demo', productType: 'alinhador_12m', productId: 'alinhador_12m', requestCode: 'OS-1002', requestKind: 'producao', arch: 'ambos', trayNumber: 12, plannedUpperQty: 2, plannedLowerQty: 2, planningDefinedAt: timestamp, plannedDate: daysFromNow(-3), dueDate: daysFromNow(1), status: 'em_producao', priority: 'Medio', notes: 'Impressão em andamento.', patientName: 'Maria Silva', createdAt: timestamp, updatedAt: timestamp },
    { id: 'lab_003', caseId: 'case_001', clinicId: 'clinic_arrimo', patientId: 'pat_maria_silva', dentistId: 'dent_demo', productType: 'alinhador_12m', productId: 'alinhador_12m', requestCode: 'OS-1003', requestKind: 'reconfeccao', arch: 'superior', trayNumber: 10, plannedUpperQty: 1, plannedLowerQty: 0, planningDefinedAt: timestamp, plannedDate: daysFromNow(-6), dueDate: daysFromNow(-2), status: 'controle_qualidade', priority: 'Urgente', notes: 'Rework por ajuste de margem.', patientName: 'Maria Silva', createdAt: timestamp, updatedAt: timestamp },
    { id: 'lab_004', caseId: 'case_003', clinicId: 'clinic_arrimo', patientId: 'pat_ana_costa', dentistId: 'dent_demo', productType: 'alinhador_3m', productId: 'alinhador_3m', requestCode: 'OS-1004', requestKind: 'producao', arch: 'ambos', trayNumber: 6, plannedUpperQty: 2, plannedLowerQty: 2, planningDefinedAt: timestamp, plannedDate: daysFromNow(-2), dueDate: daysFromNow(2), status: 'prontas', priority: 'Baixo', notes: 'Pronto para entrega ao profissional.', patientName: 'Ana Costa', createdAt: timestamp, updatedAt: timestamp },
    { id: 'lab_005', caseId: 'case_005', clinicId: 'clinic_parceira', patientId: 'pat_luiza_ferreira', dentistId: 'dent_parceiro_2', productType: 'contencao', productId: 'contencao', requestCode: 'OS-1005', requestKind: 'reposicao_programada', expectedReplacementDate: daysFromNow(30), arch: 'ambos', trayNumber: 1, plannedUpperQty: 1, plannedLowerQty: 1, planningDefinedAt: timestamp, plannedDate: daysFromNow(5), dueDate: daysFromNow(15), status: 'aguardando_iniciar', priority: 'Baixo', notes: 'Reposição automática futura.', patientName: 'Luiza Ferreira', createdAt: timestamp, updatedAt: timestamp },
    { id: 'lab_006', caseId: 'case_004', clinicId: 'clinic_parceira', patientId: 'pat_bruno_ramos', dentistId: 'dent_parceiro_1', productType: 'placa_bruxismo', productId: 'placa_bruxismo', requestCode: 'OS-1006', requestKind: 'producao', arch: 'superior', trayNumber: 1, plannedUpperQty: 1, plannedLowerQty: 0, planningDefinedAt: timestamp, plannedDate: daysFromNow(-1), dueDate: daysFromNow(3), status: 'em_producao', priority: 'Urgente', notes: 'Paciente com dor ATM.', patientName: 'Bruno Ramos', createdAt: timestamp, updatedAt: timestamp },
  ]
}

function seedScans(cases: Case[]): Scan[] {
  const linkedCaseId = cases.find((item) => item.id === 'case_001')?.id
  return [
    {
      id: 'scan_001',
      patientName: 'Bruna Oliveira',
      patientId: patientIdFromName('Bruna Oliveira'),
      scanDate: daysFromNow(-1),
      arch: 'ambos',
      complaint: 'Desalinhamento frontal.',
      dentistGuidance: 'Verificar necessidade de attachments vestibulares.',
      notes: 'Paciente sensivel na regiao posterior.',
      attachments: [
        { id: 'scan_001_att_1', name: 'intra_frontal.jpg', kind: 'foto_intra', slotId: 'intra_frontal', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_001_att_2', name: 'extra_face_frontal.jpg', kind: 'foto_extra', slotId: 'extra_face_frontal', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
      ],
      purposeProductId: 'alinhador_12m',
      purposeProductType: 'alinhador_12m',
      purposeLabel: 'Alinhador 12 meses',
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      status: 'pendente',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'scan_002',
      patientName: 'Carlos Mendes',
      patientId: patientIdFromName('Carlos Mendes'),
      scanDate: daysFromNow(-3),
      arch: 'ambos',
      complaint: 'Mordida cruzada leve.',
      dentistGuidance: 'Planejamento com foco em expansao superior.',
      attachments: [
        { id: 'scan_002_att_1', name: 'arcada_superior.stl', kind: 'scan3d', arch: 'superior', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_002_att_2', name: 'arcada_inferior.stl', kind: 'scan3d', arch: 'inferior', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_002_att_3', name: 'raiox_panoramica.pdf', kind: 'raiox', rxType: 'panoramica', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_002_att_4', name: 'telerradiografia.jpg', kind: 'raiox', rxType: 'teleradiografia', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_002_att_5', name: 'tomografia.zip', kind: 'dicom', rxType: 'tomografia', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
      ],
      purposeProductId: 'alinhador_6m',
      purposeProductType: 'alinhador_6m',
      purposeLabel: 'Alinhador 6 meses',
      dentistId: 'dent_parceiro_1',
      requestedByDentistId: 'dent_parceiro_1',
      clinicId: 'clinic_parceira',
      status: 'aprovado',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'scan_003',
      patientName: linkedCaseId ? cases[0].patientName : 'Paciente Seed',
      patientId: linkedCaseId ? cases[0].patientId : patientIdFromName('Paciente Seed'),
      scanDate: daysFromNow(-10),
      arch: 'ambos',
      complaint: 'Acompanhar alinhamento inferior.',
      dentistGuidance: 'Plano conservador.',
      attachments: [{ id: 'scan_003_att_1', name: 'registro_inicial.jpg', kind: 'foto_intra', slotId: 'intra_frontal', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() }],
      purposeProductId: 'alinhador_12m',
      purposeProductType: 'alinhador_12m',
      purposeLabel: 'Alinhador 12 meses',
      dentistId: 'dent_demo',
      requestedByDentistId: 'dent_demo',
      clinicId: 'clinic_arrimo',
      status: linkedCaseId ? 'convertido' : 'aprovado',
      linkedCaseId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: 'scan_004',
      patientName: 'Luiza Ferreira',
      patientId: 'pat_luiza_ferreira',
      scanDate: daysFromNow(-2),
      arch: 'superior',
      complaint: 'Sensibilidade na região molar.',
      dentistGuidance: 'Repetir escaneamento superior por artefato.',
      purposeProductId: 'contencao',
      purposeProductType: 'contencao',
      purposeLabel: 'Contenção',
      dentistId: 'dent_parceiro_2',
      requestedByDentistId: 'dent_parceiro_2',
      clinicId: 'clinic_parceira',
      attachments: [
        { id: 'scan_004_att_1', name: 'scan_superior.stl', kind: 'scan3d', arch: 'superior', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
        { id: 'scan_004_att_2', name: 'foto_extra.png', kind: 'foto_extra', slotId: 'extra_face_frontal', status: 'ok', attachedAt: nowIso(), createdAt: nowIso() },
      ],
      status: 'reprovado',
      notes: 'Reprovado por baixa qualidade do arquivo superior.',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ]
}

function seedDentists(): DentistClinic[] {
  const now = nowIso()
  return [
    {
      id: 'dent_demo',
      name: 'Dentista Demo',
      type: 'dentista',
      cro: 'CRO-00000',
      phone: '(11) 99999-0000',
      whatsapp: '(11) 99999-0000',
      email: 'dentista.demo@orthoscan.local',
      clinicId: 'clinic_arrimo',
      gender: 'masculino',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'dent_parceiro_1',
      name: 'Dra. Camila Lima',
      type: 'dentista',
      cro: 'CRO-11223',
      phone: '(21) 98888-1111',
      whatsapp: '(21) 98888-1111',
      email: 'camila.lima@orthoscan.local',
      clinicId: 'clinic_parceira',
      gender: 'feminino',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'dent_parceiro_2',
      name: 'Dr. Renato Alves',
      type: 'dentista',
      cro: 'CRO-44556',
      phone: '(21) 97777-3333',
      whatsapp: '(21) 97777-3333',
      email: 'renato.alves@orthoscan.local',
      clinicId: 'clinic_parceira',
      gender: 'masculino',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function seedClinics(): Clinic[] {
  const now = nowIso()
  return [
    {
      id: 'clinic_arrimo',
      tradeName: 'ARRIMO',
      legalName: '',
      cnpj: '11.111.111/0001-11',
      phone: '(11) 3000-1000',
      whatsapp: '(11) 99999-1000',
      email: 'arrimo@orthoscan.local',
      notes: 'Clínica interna (origem A-xxxx).',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'clinic_parceira',
      tradeName: 'Clínica Parceira Alpha',
      legalName: 'Clínica Parceira Alpha LTDA',
      cnpj: '22.222.222/0001-22',
      phone: '(21) 3000-2000',
      whatsapp: '(21) 98888-2000',
      email: 'contato@parceira-alpha.local',
      notes: 'Clínica externa (origem C-xxxx).',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function seedUsers(): User[] {
  const now = nowIso()
  const defaultPassword = LOCAL_DEFAULT_PASSWORD
  return [
    {
      id: 'user_master',
      name: 'Master Admin',
      email: MASTER_EMAIL || 'master@orthoscan.local',
      password: defaultPassword,
      role: 'master_admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user_dentist_admin',
      name: 'Dentista Admin',
      email: 'dentist.admin@orthoscan.local',
      password: defaultPassword,
      role: 'dentist_admin',
      isActive: true,
      linkedClinicId: 'clinic_arrimo',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user_dentist_client',
      name: 'Dentista Cliente',
      email: 'dentist.client@orthoscan.local',
      password: defaultPassword,
      role: 'dentist_client',
      isActive: true,
      linkedDentistId: 'dent_demo',
      linkedClinicId: 'clinic_arrimo',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user_clinic_client',
      name: 'Clínica Cliente',
      email: 'clinic.client@orthoscan.local',
      password: defaultPassword,
      role: 'clinic_client',
      isActive: true,
      linkedClinicId: 'clinic_arrimo',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user_lab_tech',
      name: 'Tecnico LAB',
      email: 'lab.tech@orthoscan.local',
      password: defaultPassword,
      role: 'lab_tech',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'user_reception',
      name: 'Recepcao',
      email: 'reception@orthoscan.local',
      password: defaultPassword,
      role: 'receptionist',
      isActive: true,
      linkedClinicId: 'clinic_arrimo',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function ensureMasterUser(users: User[]): User[] {
  const masterSeed = seedUsers().find((user) => user.role === 'master_admin')
  if (!masterSeed) return users
  const existing = users.find((user) => user.role === 'master_admin')
  if (!existing) return [masterSeed, ...users]

  if (existing.id !== masterSeed.id) {
    let customChanged = false
    let customNext = existing
    if (existing.deletedAt) {
      customNext = { ...customNext, deletedAt: undefined }
      customChanged = true
    }
    if (!existing.isActive) {
      customNext = { ...customNext, isActive: true }
      customChanged = true
    }
    if (!customChanged) return users
    return users.map((user) => (user.id === existing.id ? { ...customNext, updatedAt: nowIso() } : user))
  }

  let changed = false
  let next = existing
  if (existing.deletedAt) {
    next = { ...next, deletedAt: undefined }
    changed = true
  }
  if (!existing.isActive) {
    next = { ...next, isActive: true }
    changed = true
  }
  if (MASTER_EMAIL && existing.email !== MASTER_EMAIL) {
    next = { ...next, email: MASTER_EMAIL }
    changed = true
  }
  if (LOCAL_DEFAULT_PASSWORD && existing.password !== LOCAL_DEFAULT_PASSWORD) {
    next = { ...next, password: LOCAL_DEFAULT_PASSWORD }
    changed = true
  }
  if (!changed) return users
  return users.map((user) => (user.id === existing.id ? { ...next, updatedAt: nowIso() } : user))
}

function ensureDefaultUsers(users: User[]): User[] {
  const seed = seedUsers()
  const byId = new Map(users.map((item) => [item.id, item]))
  for (const seeded of seed) {
    const current = byId.get(seeded.id)
    if (!current) {
      byId.set(seeded.id, seeded)
      continue
    }
    byId.set(seeded.id, {
      ...current,
      email: seeded.email || current.email,
      password: seeded.password ?? current.password,
      role: seeded.role,
      isActive: true,
      linkedClinicId: seeded.linkedClinicId ?? current.linkedClinicId,
      linkedDentistId: seeded.linkedDentistId ?? current.linkedDentistId,
      deletedAt: undefined,
      updatedAt: nowIso(),
    })
  }
  return Array.from(byId.values())
}

function buildSeededDb(mode: 'full' | 'empty'): AppDb {
  if (mode === 'empty') {
    return {
      cases: [],
      labItems: [],
      replacementBank: [],
      patients: [],
      patientDocuments: [],
      scans: [],
      dentists: [],
      clinics: [],
      users: ensureMasterUser(ensureDefaultUsers(seedUsers())),
      auditLogs: [],
    }
  }
  const clinics = seedClinics()
  const cases = ensureTreatmentCodes(seedCases(), clinics)
  return ensureFullSeedData({
    cases,
    labItems: seedLabItems(),
    replacementBank: [],
    patients: seedPatients(),
    patientDocuments: [],
    scans: seedScans(cases),
    dentists: seedDentists(),
    clinics,
    users: ensureMasterUser(ensureDefaultUsers(seedUsers())),
    auditLogs: [],
  })
}

function readPersistedMode(): 'full' | 'empty' | null {
  const raw = localStorage.getItem(DB_MODE_KEY)
  if (raw === 'full' || raw === 'empty') return raw
  return null
}

function effectiveSeedMode(): 'full' | 'empty' {
  if (import.meta.env.MODE === 'test') return readPersistedMode() ?? 'full'
  if (DATA_MODE === 'supabase') return 'empty'
  return SEED_MODE
}

function fullDemoAttachments(): ScanAttachment[] {
  const createdAt = nowIso()
  const base: ScanAttachment[] = [
    { id: 'scan_full_001_sup_3d', name: 'upper.stl', kind: 'scan3d', arch: 'superior', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
    { id: 'scan_full_001_inf_3d', name: 'lower.stl', kind: 'scan3d', arch: 'inferior', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
    { id: 'scan_full_001_pan', name: 'panoramica.pdf', kind: 'raiox', rxType: 'panoramica', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
    { id: 'scan_full_001_tel', name: 'tele.jpg', kind: 'raiox', rxType: 'teleradiografia', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
    { id: 'scan_full_001_tom', name: 'tomografia.zip', kind: 'dicom', rxType: 'tomografia', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
    { id: 'scan_full_001_setup', name: 'setup.project', kind: 'projeto', isLocal: false, status: 'ok', attachedAt: createdAt, createdAt },
  ]

  const intra = FULL_DEMO_INTRA_SLOTS.map((slotId, index) => ({
    id: `scan_full_001_intra_${index + 1}`,
    name: `${slotId}.jpg`,
    kind: 'foto_intra' as const,
    slotId,
    isLocal: false,
    status: 'ok' as const,
    attachedAt: createdAt,
    createdAt,
  }))
  const extra = FULL_DEMO_EXTRA_SLOTS.map((slotId, index) => ({
    id: `scan_full_001_extra_${index + 1}`,
    name: `${slotId}.jpg`,
    kind: 'foto_extra' as const,
    slotId,
    isLocal: false,
    status: 'ok' as const,
    attachedAt: createdAt,
    createdAt,
  }))

  return [...base, ...intra, ...extra]
}

function ensureFullSeedData(db: AppDb): AppDb {
  const scanId = 'scan_full_001'
  const caseId = 'case_from_scan_full_001'
  const now = nowIso()
  const recentScanDate = daysFromNow(-2)

  const hasFullScan = db.scans.some((item) => item.id === scanId)
  if (db.scans.length === 0 || !hasFullScan) {
    const fullScan: Scan = {
      id: scanId,
      patientName: 'Paciente Demo Completo',
      patientId: patientIdFromName('Paciente Demo Completo'),
      scanDate: recentScanDate,
      arch: 'ambos',
      complaint: 'Apinhamento leve anterior e necessidade de alinhamento global.',
      dentistGuidance: 'Executar setup completo com controle de torque e avaliar attachments vestibulares.',
      attachments: fullDemoAttachments(),
      status: 'aprovado',
      createdAt: now,
      updatedAt: now,
    }
    db.scans = [fullScan, ...db.scans]
  }

  const fullScan = db.scans.find((item) => item.id === scanId)
  if (!fullScan) return db

  const hasFullCase = db.cases.some((item) => item.id === caseId)
  if (!hasFullCase) {
    const totalTraysUpper = 24
    const totalTraysLower = 20
    const totalTrays = Math.max(totalTraysUpper, totalTraysLower)
    const changeEveryDays = 7

    const fullCase: Case = {
      id: caseId,
      patientName: fullScan.patientName,
      patientId: fullScan.patientId,
      scanDate: fullScan.scanDate,
      totalTrays,
      totalTraysUpper,
      totalTraysLower,
      changeEveryDays,
      attachmentBondingTray: true,
      status: 'planejamento',
      phase: 'planejamento',
      contract: { status: 'pendente' },
      deliveryLots: [],
      installation: undefined,
      trays: buildPendingTrays(fullScan.scanDate, totalTrays, changeEveryDays),
      attachments: [],
      sourceScanId: fullScan.id,
      arch: fullScan.arch,
      complaint: fullScan.complaint,
      dentistGuidance: fullScan.dentistGuidance,
      scanFiles: fullScan.attachments.map((att) => ({
        id: att.id,
        name: att.name,
        kind: att.kind,
        slotId: att.slotId,
        rxType: att.rxType,
        arch: att.arch,
        isLocal: att.isLocal,
        url: att.url,
        filePath: att.filePath,
        status: att.status ?? 'ok',
        attachedAt: att.attachedAt ?? att.createdAt,
        note: att.note,
        flaggedAt: att.flaggedAt,
        flaggedReason: att.flaggedReason,
        createdAt: att.createdAt,
      })),
      createdAt: now,
      updatedAt: now,
    }
    db.cases = [fullCase, ...db.cases]
  }

  db.scans = db.scans.map((item) =>
    item.id === scanId
      ? {
          ...item,
          status: 'convertido',
          linkedCaseId: caseId,
          updatedAt: nowIso(),
        }
      : item,
  )

  db.cases = ensureTreatmentCodes(db.cases, db.clinics)

  return db
}

function migrateCase(oldCase: LegacyCase): Case {
  const patientName = oldCase.patientName ?? oldCase.paciente?.nome ?? 'Paciente sem nome'
  const scanDate = oldCase.scanDate ?? oldCase.data_scan ?? toIsoDate(new Date())
  const totalTrays = oldCase.totalTrays ?? oldCase.planejamento?.quantidade_total_placas ?? 12
  const changeEveryDays = oldCase.changeEveryDays ?? oldCase.planejamento?.troca_a_cada_dias ?? 7
  const legacyStatus = oldCase.status ?? 'planejamento'
  const hasInstallation = Boolean(oldCase.installation?.installedAt)
  const status: CaseStatus =
    legacyStatus === 'finalizado' ? 'finalizado' : hasInstallation && legacyStatus !== 'planejamento' ? 'em_entrega' : legacyStatus
  const phase = oldCase.phase ?? phaseFromStatus(status)
  const trays = Array.isArray(oldCase.trays) && oldCase.trays.length > 0 ? oldCase.trays : buildTrays(scanDate, totalTrays, changeEveryDays)
  const attachments = Array.isArray(oldCase.attachments) ? oldCase.attachments : []

  const sourceScanFiles = Array.isArray(oldCase.scanFiles) ? oldCase.scanFiles : oldCase.scanAttachments
  const scanFiles = Array.isArray(sourceScanFiles)
    ? sourceScanFiles.map((item, index) => ({
        id: item.id ?? `scan_file_${oldCase.id}_${index}`,
        name: item.name,
        kind: mapLegacyKind(item) as NonNullable<Case['scanFiles']>[number]['kind'],
        slotId: item.slotId,
        rxType: item.rxType as NonNullable<Case['scanFiles']>[number]['rxType'],
        arch: item.arch as NonNullable<Case['scanFiles']>[number]['arch'],
        isLocal: item.isLocal ?? isObjectUrl(item.url),
        url: item.url,
        filePath: item.filePath,
        status: item.status ?? 'ok',
        attachedAt: item.attachedAt ?? item.createdAt ?? nowIso(),
        note: item.note,
        flaggedAt: item.flaggedAt,
        flaggedReason: item.flaggedReason,
        createdAt: item.createdAt ?? nowIso(),
      }))
    : []

  return {
    id: oldCase.id,
    shortId: oldCase.shortId,
    productType: normalizeProductType(oldCase.productType),
    productId: normalizeProductType(oldCase.productId ?? oldCase.productType),
    requestedProductId: oldCase.requestedProductId,
    requestedProductLabel: oldCase.requestedProductLabel,
    treatmentCode: oldCase.treatmentCode,
    treatmentOrigin: oldCase.treatmentOrigin,
    patientName,
    patientId: oldCase.patientId,
    dentistId: oldCase.dentistId,
    requestedByDentistId: oldCase.requestedByDentistId,
    clinicId: oldCase.clinicId,
    scanDate,
    totalTrays,
    changeEveryDays,
    totalTraysUpper: oldCase.totalTraysUpper ?? totalTrays,
    totalTraysLower: oldCase.totalTraysLower ?? totalTrays,
    attachmentBondingTray: oldCase.attachmentBondingTray ?? false,
    status,
    phase,
    budget: oldCase.budget,
    contract: oldCase.contract
      ? {
          ...oldCase.contract,
          approvedAt:
            oldCase.contract.status === 'aprovado'
              ? oldCase.contract.approvedAt ?? nowIso()
              : oldCase.contract.approvedAt,
        }
      : phase === 'planejamento' || phase === 'orçamento' || phase === 'contrato_pendente'
        ? { status: 'pendente' }
        : { status: 'aprovado', approvedAt: nowIso() },
    deliveryLots: Array.isArray(oldCase.deliveryLots) ? oldCase.deliveryLots : [],
    installation: oldCase.installation,
    trays: trays.slice(0, totalTrays),
    attachments,
    sourceScanId: oldCase.sourceScanId,
    arch: oldCase.arch ?? 'ambos',
    complaint: oldCase.complaint,
    dentistGuidance: oldCase.dentistGuidance,
    scanFiles,
    createdAt: oldCase.createdAt ?? nowIso(),
    updatedAt: oldCase.updatedAt ?? nowIso(),
  }
}

function migrateScan(raw: LegacyScan): Scan {
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map((item, index) => {
        const isLocal = item.isLocal ?? isObjectUrl(item.url)
        const kind = mapLegacyKind(item) as ScanAttachment['kind']
        return {
          id: item.id ?? `scan_att_${Date.now()}_${index}`,
          name: item.name ?? 'arquivo_sem_nome',
          kind,
          rxType: item.rxType as ScanAttachment['rxType'],
          slotId: item.slotId,
          arch: item.arch as ScanAttachment['arch'],
          mime: item.mime,
          size: item.size,
          url: isLocal ? undefined : item.url,
          filePath: (item as { filePath?: string; file_path?: string }).filePath ?? (item as { file_path?: string }).file_path,
          isLocal,
          status: item.status ?? 'ok',
          attachedAt: item.attachedAt ?? item.createdAt ?? nowIso(),
          note: item.note,
          flaggedAt: item.flaggedAt,
          flaggedReason: item.flaggedReason,
          createdAt: item.createdAt ?? nowIso(),
        }
      })
    : []

  return {
    id: raw.id,
    shortId: raw.shortId,
    serviceOrderCode: raw.serviceOrderCode,
    purposeProductId: raw.purposeProductId,
    purposeProductType: raw.purposeProductType,
    purposeLabel: raw.purposeLabel,
    patientName: raw.patientName ?? 'Paciente sem nome',
    patientId: raw.patientId,
    dentistId: raw.dentistId,
    requestedByDentistId: raw.requestedByDentistId,
    clinicId: raw.clinicId,
    scanDate: raw.scanDate ?? toIsoDate(new Date()),
    arch: raw.arch ?? 'ambos',
    complaint: raw.complaint,
    dentistGuidance: raw.dentistGuidance,
    notes: raw.notes,
    attachments,
    status: (raw.status as ScanStatus) ?? 'pendente',
    linkedCaseId: raw.linkedCaseId,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  }
}

function migratePatient(raw: Partial<Patient>): Patient {
  const name = raw.name?.trim() || 'Paciente sem nome'
  return {
    id: raw.id ?? patientIdFromName(name),
    shortId: raw.shortId,
    name,
    cpf: (raw as { document?: string }).document ?? raw.cpf,
    gender: raw.gender,
    address: raw.address,
    clinicId: raw.clinicId,
    primaryDentistId: raw.primaryDentistId,
    phone: raw.phone,
    whatsapp: raw.whatsapp,
    email: raw.email,
    birthDate: raw.birthDate,
    notes: raw.notes,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
    deletedAt: raw.deletedAt,
  }
}

function normalizeLabStatus(status?: string): LabItem['status'] {
  if (status === 'aguardando_iniciar') return 'aguardando_iniciar'
  if (status === 'em_producao') return 'em_producao'
  if (status === 'controle_qualidade') return 'controle_qualidade'
  if (status === 'prontas') return 'prontas'
  if (status === 'triagem') return 'aguardando_iniciar'
  if (status === 'rework') return 'controle_qualidade'
  if (status === 'entregue') return 'prontas'
  if (status === 'pronta') return 'prontas'
  return 'aguardando_iniciar'
}

function migrateLabItem(raw: LegacyLabItem): LabItem {
  const plannedUpperQty = Number.isFinite(raw.plannedUpperQty) ? Math.max(0, Math.trunc(raw.plannedUpperQty as number)) : 0
  const plannedLowerQty = Number.isFinite(raw.plannedLowerQty) ? Math.max(0, Math.trunc(raw.plannedLowerQty as number)) : 0
  return {
    id: raw.id,
    productType: normalizeProductType(raw.productType),
    productId: normalizeProductType(raw.productId ?? raw.productType),
    requestedProductId: raw.requestedProductId,
    requestedProductLabel: raw.requestedProductLabel,
    requestCode: raw.requestCode,
    requestKind: raw.requestKind,
    expectedReplacementDate: raw.expectedReplacementDate ?? raw.dueDate ?? toIsoDate(new Date()),
    caseId: raw.caseId,
    arch: raw.arch ?? 'ambos',
    plannedUpperQty,
    plannedLowerQty,
    planningDefinedAt: plannedUpperQty + plannedLowerQty > 0 ? raw.planningDefinedAt ?? nowIso() : undefined,
    trayNumber: raw.trayNumber ?? 1,
    patientName: raw.patientName ?? 'Paciente sem nome',
    plannedDate: raw.plannedDate ?? toIsoDate(new Date()),
    dueDate: raw.dueDate ?? toIsoDate(new Date()),
    status: normalizeLabStatus(raw.status),
    priority: raw.priority ?? 'Medio',
    notes: raw.notes,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  }
}

function migrateDentist(raw: LegacyDentistClinic): DentistClinic {
  const now = nowIso()
  return {
    id: raw.id,
    shortId: raw.shortId,
    name: raw.name?.trim() || 'Sem nome',
    type: raw.type === 'clinica' ? 'clinica' : 'dentista',
    cnpj: raw.cnpj || undefined,
    cro: raw.cro || undefined,
    gender: raw.gender === 'feminino' ? 'feminino' : 'masculino',
    clinicId: raw.clinicId || undefined,
    phone: raw.phone || undefined,
    whatsapp: raw.whatsapp || undefined,
    email: raw.email || undefined,
    address: raw.address,
    notes: raw.notes || undefined,
    isActive: raw.isActive ?? true,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    deletedAt: raw.deletedAt || undefined,
  }
}

function migrateClinic(raw: LegacyClinic): Clinic {
  const now = nowIso()
  return {
    id: raw.id,
    shortId: raw.shortId,
    legalName: raw.legalName,
    tradeName: raw.tradeName?.trim() || 'Clínica',
    cnpj: raw.cnpj,
    phone: raw.phone,
    whatsapp: raw.whatsapp,
    email: raw.email,
    address: raw.address,
    notes: raw.notes,
    isActive: raw.isActive ?? true,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    deletedAt: raw.deletedAt,
  }
}

function migrateUser(raw: LegacyUser): User {
  const now = nowIso()
  return {
    id: raw.id,
    shortId: raw.shortId,
    name: raw.name?.trim() || 'Usuário',
    email: raw.email?.trim() || 'user@orthoscan.local',
    password: raw.password,
    role: raw.role ?? 'receptionist',
    isActive: raw.isActive ?? true,
    phone: raw.phone || undefined,
    whatsapp: raw.whatsapp || undefined,
    linkedDentistId: raw.linkedDentistId,
    linkedClinicId: raw.linkedClinicId,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    deletedAt: raw.deletedAt,
  }
}

function normalizeDb(raw: unknown): AppDb {
  if (!raw || typeof raw !== 'object') {
    return { cases: [], labItems: [], replacementBank: [], patients: [], patientDocuments: [], scans: [], dentists: [], clinics: [], users: [], auditLogs: [] }
  }

  const input = raw as {
    cases?: unknown
    casos?: unknown
    labItems?: unknown
    replacementBank?: unknown
    scans?: unknown
    patients?: unknown
    patientDocuments?: unknown
    dentists?: unknown
    clinics?: unknown
    users?: unknown
    auditLogs?: unknown
    [key: string]: unknown
  }
  const rawCases = Array.isArray(input.cases) ? (input.cases as LegacyCase[]) : Array.isArray(input.casos) ? (input.casos as LegacyCase[]) : []
  const cases = rawCases.map(migrateCase)
  const labItems = Array.isArray(input.labItems) ? (input.labItems as LegacyLabItem[]).map(migrateLabItem) : []
  const replacementBank = Array.isArray(input.replacementBank)
    ? (input.replacementBank as Array<Partial<ReplacementBankEntry>>)
        .map((item) => {
          if (!item.id || !item.caseId || !item.arcada || !item.placaNumero) return null
          return {
            id: item.id,
            caseId: item.caseId,
            arcada: item.arcada,
            placaNumero: Math.max(1, Math.trunc(item.placaNumero)),
            status: item.status ?? 'disponivel',
            ...(item.sourceLabItemId ? { sourceLabItemId: item.sourceLabItemId } : {}),
            ...(item.deliveredAt ? { deliveredAt: item.deliveredAt } : {}),
            createdAt: item.createdAt ?? nowIso(),
            updatedAt: item.updatedAt ?? nowIso(),
          } satisfies ReplacementBankEntry
        })
        .filter((item): item is ReplacementBankEntry => Boolean(item))
    : []
  const patients = Array.isArray(input.patients) ? (input.patients as Partial<Patient>[]).map(migratePatient) : []
  const scans = Array.isArray(input.scans) ? (input.scans as LegacyScan[]).map(migrateScan) : []
  const patientDocuments = Array.isArray(input.patientDocuments)
    ? (input.patientDocuments as LegacyPatientDocument[]).map((item) => ({
        id: item.id,
        patientId: item.patientId ?? 'unknown',
        title: item.title ?? item.fileName ?? 'Documento',
        category: item.category ?? 'outro',
        createdAt: item.createdAt ?? nowIso(),
        note: item.note,
        isLocal: item.isLocal ?? false,
        url: item.url,
        filePath: (item as { filePath?: string; file_path?: string }).filePath ?? (item as { file_path?: string }).file_path,
        fileName: item.fileName ?? item.title ?? 'arquivo',
        mimeType: item.mimeType,
        status: item.status ?? 'ok',
        errorNote: item.errorNote,
      }))
    : []
  const legacyDocsFromPatients: PatientDocument[] = patients.flatMap((patient) => {
    const rawDocs = (input.patients as Array<{ id?: string; documents?: Array<{ id: string; name?: string; url?: string; isLocal?: boolean; status?: 'ok' | 'erro'; note?: string; flaggedReason?: string; createdAt?: string }> }> | undefined) ?? []
    const matched = rawDocs.find((item) => item.id === patient.id)
    const docs = matched?.documents ?? []
    return docs.map((doc) => ({
      id: doc.id,
      patientId: patient.id,
      title: doc.name ?? 'Documento',
      category: 'outro',
      createdAt: doc.createdAt ?? nowIso(),
      note: doc.note,
      isLocal: doc.isLocal ?? false,
      url: doc.url,
      fileName: doc.name ?? 'arquivo',
      mimeType: undefined,
      status: doc.status ?? 'ok',
      errorNote: doc.flaggedReason,
    }))
  })
  const dentistsRaw = Array.isArray(input.dentists)
    ? (input.dentists as LegacyDentistClinic[]).map(migrateDentist)
    : []
  const clinicsFromDentists = dentistsRaw
    .filter((item) => item.type === 'clinica')
    .map((item) => ({
      id: item.id.replace('dent_', 'clinic_'),
      tradeName: item.name,
      legalName: undefined,
      cnpj: item.cnpj,
      phone: item.phone,
      whatsapp: item.whatsapp,
      email: item.email,
      address: item.address,
      notes: item.notes,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
    })) as Clinic[]
  const dentists = dentistsRaw.filter((item) => item.type === 'dentista')
  const clinicsRaw = Array.isArray(input.clinics)
    ? (input.clinics as LegacyClinic[]).map(migrateClinic)
    : []
  const clinicById = new Map(clinicsRaw.map((item) => [item.id, item]))
  clinicsFromDentists.forEach((clinic) => {
    if (!clinicById.has(clinic.id)) {
      clinicById.set(clinic.id, clinic)
    }
  })
  const clinics = Array.from(clinicById.values())
  const users = Array.isArray(input.users) ? (input.users as LegacyUser[]).map(migrateUser) : []
  const auditLogs = Array.isArray(input.auditLogs) ? (input.auditLogs as AuditLog[]) : []
  const byName = new Map(patients.map((item) => [item.name.toLowerCase(), item.id]))
  const linkedCases = cases.map((item) => ({
    ...item,
    productType: normalizeProductType(item.productType),
    productId: normalizeProductType(item.productId ?? item.productType),
    patientId: item.patientId ?? byName.get(item.patientName.toLowerCase()),
  }))
  const casesWithCode = ensureTreatmentCodes(linkedCases, clinics)
  const caseCodeById = new Map(casesWithCode.map((item) => [item.id, item.treatmentCode]))
  const usedCodes = casesWithCode
    .map((item) => normalizeOrthTreatmentCode(item.treatmentCode))
    .filter((item): item is string => Boolean(item))
  const scansSortedByCreated = [...scans].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const generatedByScanId = new Map<string, string>()
  scansSortedByCreated.forEach((scan) => {
    const linked = scan.linkedCaseId ? caseCodeById.get(scan.linkedCaseId) : undefined
    const normalizedCurrent = normalizeOrthTreatmentCode(scan.serviceOrderCode)
    const resolved = linked || normalizedCurrent || nextOrthTreatmentCode(usedCodes)
    if (!linked && !normalizedCurrent) {
      usedCodes.push(resolved)
    }
    generatedByScanId.set(scan.id, resolved)
  })
  const linkedScans = scans.map((item) => ({
    ...item,
    patientId: item.patientId ?? byName.get(item.patientName.toLowerCase()),
    serviceOrderCode: generatedByScanId.get(item.id),
  }))

  return {
    ...input,
    cases: casesWithCode,
    labItems: labItems.map((item) => ({
      ...item,
      productType: normalizeProductType(item.productType),
      productId: normalizeProductType(item.productId ?? item.productType),
    })),
    patients,
    replacementBank,
    patientDocuments: patientDocuments.length > 0 ? patientDocuments : legacyDocsFromPatients,
    scans: linkedScans,
    dentists,
    clinics,
    users,
    auditLogs,
  }
}

function applyHotfixResetJoelsonTreatment(db: AppDb): AppDb {
  if (typeof window === 'undefined') return db
  if (localStorage.getItem(HOTFIX_RESET_JOELSON_TREATMENT_KEY) === 'done') return db

  const target = db.cases.find(
    (item) => normalizeName(item.patientName) === normalizeName(HOTFIX_RESET_JOELSON_TARGET),
  )
  if (!target) return db

  const resetTrays = buildPendingTrays(target.scanDate, target.totalTrays, target.changeEveryDays).map((tray) => ({
    ...tray,
    deliveredAt: undefined,
    notes: undefined,
  }))
  const nextStatus: CaseStatus = 'planejamento'
  const nextPhase: CasePhase = target.contract?.status === 'aprovado' ? 'contrato_aprovado' : 'planejamento'

  const nextCases = db.cases.map((item) =>
    item.id === target.id
      ? {
          ...item,
          trays: resetTrays,
          deliveryLots: [],
          installation: undefined,
          status: nextStatus,
          phase: nextPhase,
          updatedAt: nowIso(),
        }
      : item,
  )
  const nextLabItems = db.labItems.filter((item) => item.caseId !== target.id)

  localStorage.setItem(HOTFIX_RESET_JOELSON_TREATMENT_KEY, 'done')
  return {
    ...db,
    cases: nextCases,
    labItems: nextLabItems,
  }
}

export function ensureSeed() {
  const mode = effectiveSeedMode()
  const raw = localStorage.getItem(DB_KEY)
  if (!raw) {
    const seeded = buildSeededDb(mode)
    localStorage.setItem(DB_KEY, JSON.stringify(seeded))
    return seeded
  }

  try {
    const normalized = applyHotfixResetJoelsonTreatment(normalizeDb(JSON.parse(raw) as unknown))
    if (mode === 'empty') {
      // In Supabase mode we keep local cache untouched to avoid wiping
      // records used by local UI state between route transitions.
      const nextDb: AppDb = {
        ...normalized,
        users: ensureMasterUser(
          ensureDefaultUsers(normalized.users.length === 0 ? seedUsers() : normalized.users),
        ),
      }
      localStorage.setItem(DB_KEY, JSON.stringify(nextDb))
      return nextDb
    }
    const required = seedPatients()
    const existingByName = new Set(normalized.patients.map((item) => item.name.toLowerCase()))
    const mergedPatients = [
      ...normalized.patients,
      ...required.filter((item) => !existingByName.has(item.name.toLowerCase())),
    ]
    const nextDb = ensureFullSeedData({
      ...normalized,
      cases: normalized.cases,
      labItems: normalized.labItems,
      patients: mergedPatients,
      patientDocuments: normalized.patientDocuments ?? [],
      scans: normalized.scans.length === 0 ? seedScans(normalized.cases) : normalized.scans,
      dentists: normalized.dentists.length === 0 ? seedDentists() : normalized.dentists,
      clinics: normalized.clinics.length === 0 ? seedClinics() : normalized.clinics,
      users: ensureMasterUser(
        ensureDefaultUsers(normalized.users.length === 0 ? seedUsers() : normalized.users),
      ),
    })
    localStorage.setItem(DB_KEY, JSON.stringify(nextDb))
    return nextDb
  } catch {
    const seeded = buildSeededDb(mode)
    localStorage.setItem(DB_KEY, JSON.stringify(seeded))
    return seeded
  }
}

export function loadDb(): AppDb {
  return ensureSeed()
}

export function saveDb(db: AppDb) {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
  emitDbChanged()
}

export function resetDb(mode?: 'full' | 'empty') {
  const resolvedMode = mode ?? SEED_MODE
  localStorage.setItem(DB_MODE_KEY, resolvedMode)
  const next = buildSeededDb(resolvedMode)
  localStorage.setItem(DB_KEY, JSON.stringify(next))
  emitDbChanged()
  return next
}

export function ensureMasterUserInDb() {
  const db = loadDb()
  const nextUsers = ensureMasterUser(db.users)
  if (nextUsers === db.users) return db
  const nextDb = { ...db, users: nextUsers }
  saveDb(nextDb)
  return nextDb
}

