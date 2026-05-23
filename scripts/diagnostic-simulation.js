#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import {
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

const state = {
  patientId: null,
  dentistId: null,
  caseId: null,
  deletedPatient: false,
  deletedDentist: false,
  deletedCase: false,
}

let server = null
let patientRepo = null
let dentistRepo = null
let caseRepo = null
let firebaseClient = null
let signedIn = false

function formatError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  }
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function unwrapRepoResult(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label}: ${result?.error ?? 'repositório retornou falha sem mensagem.'}`)
  }
  return result
}

async function runStep(title, action) {
  console.log(`\n${title}`)
  try {
    const output = await action()
    console.log(`✅ SUCESSO - ${title}`)
    return output
  } catch (error) {
    console.error(`❌ FALHA - ${title}`)
    console.error(formatError(error))
    throw error
  }
}

function diagnosticStamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

async function authenticateIfConfigured() {
  const email = process.env.DIAGNOSTIC_FIREBASE_EMAIL?.trim()
  const password = process.env.DIAGNOSTIC_FIREBASE_PASSWORD?.trim()
  if (!email || !password) {
    console.log('ℹ️  Sem DIAGNOSTIC_FIREBASE_EMAIL/PASSWORD. O teste usará Firestore sem usuário autenticado.')
    return
  }

  const auth = firebaseClient?.auth
  if (!auth) throw new Error('Firebase Auth não foi inicializado.')

  await setPersistence(auth, inMemoryPersistence)
  await signInWithEmailAndPassword(auth, email, password)
  signedIn = true
  console.log(`✅ SUCESSO - Autenticado no Firebase Auth como ${email}`)
}

async function cleanupAfterFailure() {
  console.log('\n🧹 Tentando limpeza dos registros de diagnóstico...')

  if (caseRepo && state.caseId && !state.deletedCase) {
    try {
      await caseRepo.deleteCaseFirebase(state.caseId)
      state.deletedCase = true
      console.log(`✅ SUCESSO - OS de diagnóstico removida: ${state.caseId}`)
    } catch (error) {
      console.error(`❌ FALHA - Limpeza da OS ${state.caseId}`)
      console.error(formatError(error))
    }
  }

  if (patientRepo && state.patientId && !state.deletedPatient) {
    try {
      await patientRepo.softDeletePatientFirebase(state.patientId)
      state.deletedPatient = true
      console.log(`✅ SUCESSO - Paciente de diagnóstico removido: ${state.patientId}`)
    } catch (error) {
      console.error(`❌ FALHA - Limpeza do paciente ${state.patientId}`)
      console.error(formatError(error))
    }
  }

  if (dentistRepo && state.dentistId && !state.deletedDentist) {
    try {
      await dentistRepo.softDeleteDentistFirebase(state.dentistId)
      state.deletedDentist = true
      console.log(`✅ SUCESSO - Dentista de diagnóstico removido: ${state.dentistId}`)
    } catch (error) {
      console.error(`❌ FALHA - Limpeza do dentista ${state.dentistId}`)
      console.error(formatError(error))
    }
  }
}

async function main() {
  server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  })

  const dataModeModule = await server.ssrLoadModule('/src/data/dataMode.ts')
  patientRepo = await server.ssrLoadModule('/src/repo/patientRepo.ts')
  dentistRepo = await server.ssrLoadModule('/src/data/dentistRepo.ts')
  caseRepo = await server.ssrLoadModule('/src/data/caseRepo.ts')
  firebaseClient = await server.ssrLoadModule('/src/lib/firebaseClient.ts')

  assert(dataModeModule.DATA_MODE === 'firebase', `VITE_DATA_MODE precisa ser "firebase"; atual: ${dataModeModule.DATA_MODE}`)
  await authenticateIfConfigured()

  const stamp = diagnosticStamp()
  const patient = await runStep('Passo A1 - Criar paciente mock no Firestore', async () => {
    const result = unwrapRepoResult(
      await patientRepo.createPatientFirebase({
        name: `Paciente Diagnóstico ${stamp}`,
        firstName: 'Paciente',
        lastName: `Diagnóstico ${stamp}`,
        cpf: '000.000.000-00',
        birthDate: '1990-01-01',
        gender: 'outro',
        phone: '(11) 3000-0000',
        whatsapp: '(11) 90000-0000',
        email: `diagnostico.paciente.${stamp}@orthoscan.local`,
        notes: 'Registro criado automaticamente pelo script de diagnóstico E2E.',
      }),
      'Falha ao criar paciente',
    )
    state.patientId = result.patient.id
    console.log(`Paciente criado: ${result.patient.id}`)
    return result.patient
  })

  const dentist = await runStep('Passo A2 - Criar dentista mock no Firestore', async () => {
    const result = unwrapRepoResult(
      await dentistRepo.createDentistFirebase({
        name: `Dra. Diagnóstico ${stamp}`,
        firstName: 'Dra.',
        lastName: `Diagnóstico ${stamp}`,
        type: 'dentista',
        cro: `DIAG-${stamp.slice(-6)}`,
        gender: 'feminino',
        phone: '(11) 3000-0001',
        whatsapp: '(11) 90000-0001',
        email: `diagnostico.dentista.${stamp}@orthoscan.local`,
        notes: 'Registro criado automaticamente pelo script de diagnóstico E2E.',
        isActive: true,
      }),
      'Falha ao criar dentista',
    )
    state.dentistId = result.dentist.id
    console.log(`Dentista criado: ${result.dentist.id}`)
    return result.dentist
  })

  const caseItem = await runStep('Passo B - Criar OS/Caso vinculado ao paciente e dentista', async () => {
    const created = await caseRepo.createCaseFirebase({
      productType: 'alinhador_3m',
      productId: 'alinhador_3m',
      requestedProductId: 'alinhador_3m',
      requestedProductLabel: 'Alinhador 3M',
      treatmentCode: `DIAG-${stamp}`,
      treatmentOrigin: 'interno',
      patientName: patient.name,
      patientId: patient.id,
      dentistId: dentist.id,
      requestedByDentistId: dentist.id,
      scanDate: todayIsoDate(),
      totalTrays: 2,
      totalTraysUpper: 1,
      totalTraysLower: 1,
      changeEveryDays: 7,
      attachmentBondingTray: false,
      status: 'planejamento',
      phase: 'planejamento',
      trays: [
        { trayNumber: 1, state: 'pendente' },
        { trayNumber: 2, state: 'pendente' },
      ],
      attachments: [],
      arch: 'ambos',
      complaint: 'Simulação automatizada de diagnóstico.',
      dentistGuidance: 'Validar hidratação NoSQL e fluxo CRUD.',
    })
    state.caseId = created.id
    assert(created.patientId === patient.id, 'OS criada sem vínculo correto com paciente.')
    assert(created.dentistId === dentist.id, 'OS criada sem vínculo correto com dentista.')
    console.log(`OS criada: ${created.id}`)
    return created
  })

  await runStep('Passo C - Buscar OS e validar hydrateRelations', async () => {
    const hydrated = await caseRepo.getCaseFirebase(caseItem.id, { hydrateRelations: true })
    assert(hydrated, 'OS não encontrada após criação.')
    assert(hydrated.patient?.id === patient.id, 'hydrateRelations não trouxe o paciente correto.')
    assert(hydrated.patient?.name === patient.name, 'hydrateRelations trouxe paciente com nome divergente.')
    assert(hydrated.dentist?.id === dentist.id, 'hydrateRelations não trouxe o dentista correto.')
    assert(hydrated.dentist?.name === dentist.name, 'hydrateRelations trouxe dentista com nome divergente.')
    console.log(`Paciente hidratado: ${hydrated.patient.name}`)
    console.log(`Dentista hidratado: ${hydrated.dentist.name}`)
    return hydrated
  })

  await runStep('Passo D - Atualizar status da OS no Firestore', async () => {
    const updated = await caseRepo.updateCaseFirebase(caseItem.id, {
      status: 'finalizado',
      phase: 'finalizado',
      trays: caseItem.trays.map((tray) => ({ ...tray, state: 'entregue' })),
    })
    assert(updated, 'Update retornou nulo.')
    assert(updated.status === 'finalizado', `Status esperado finalizado; recebido ${updated.status}.`)

    const readBack = await caseRepo.getCaseFirebase(caseItem.id)
    assert(readBack?.status === 'finalizado', 'Status finalizado não persistiu no Firestore.')
    console.log(`OS atualizada: ${caseItem.id} -> ${readBack.status}`)
    return readBack
  })

  await runStep('Passo E1 - Aplicar soft-delete na OS', async () => {
    const result = unwrapRepoResult(await caseRepo.deleteCaseFirebase(caseItem.id), 'Falha ao excluir OS')
    state.deletedCase = true
    const deleted = await caseRepo.getCaseFirebase(caseItem.id)
    assert(deleted?.deletedAt, 'Soft-delete da OS não gravou deletedAt.')
    console.log(`OS soft-deletada: ${caseItem.id}`)
    return result
  })

  await runStep('Passo E2 - Aplicar soft-delete no paciente', async () => {
    const result = unwrapRepoResult(await patientRepo.softDeletePatientFirebase(patient.id), 'Falha ao excluir paciente')
    state.deletedPatient = true
    const deleted = await patientRepo.getPatientFirebase(patient.id)
    assert(deleted?.deletedAt, 'Soft-delete do paciente não gravou deletedAt.')
    console.log(`Paciente soft-deletado: ${patient.id}`)
    return result
  })

  await runStep('Limpeza adicional - Aplicar soft-delete no dentista mock', async () => {
    const result = unwrapRepoResult(await dentistRepo.softDeleteDentistFirebase(dentist.id), 'Falha ao excluir dentista mock')
    state.deletedDentist = true
    const deleted = await dentistRepo.getDentistFirebase(dentist.id)
    assert(deleted?.deletedAt, 'Soft-delete do dentista não gravou deletedAt.')
    console.log(`Dentista soft-deletado: ${dentist.id}`)
    return result
  })

  console.log('\n✅ DIAGNÓSTICO CONCLUÍDO - CRUD e hidratação Firestore passaram na simulação E2E.')
}

try {
  await main()
} catch (error) {
  await cleanupAfterFailure()
  console.error('\n❌ DIAGNÓSTICO REPROVADO')
  console.error(formatError(error))
  process.exitCode = 1
} finally {
  if (signedIn && firebaseClient?.auth) {
    await signOut(firebaseClient.auth).catch(() => undefined)
  }
  if (server) {
    await server.close()
  }
}
