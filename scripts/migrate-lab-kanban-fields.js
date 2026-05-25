import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const BATCH_SIZE = 450

function stripInlineComment(value) {
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char
    }
    if (char === '#' && !quote) return value.slice(0, index).trim()
  }
  return value.trim()
}

async function loadDotenvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
      if (!match) return
      const [, key, rawValue] = match
      if (!process.env[key]) {
        process.env[key] = stripInlineComment(rawValue).replace(/^['"]|['"]$/g, '')
      }
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

async function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!serviceAccountPath) return null
  return JSON.parse(await fs.readFile(path.resolve(serviceAccountPath), 'utf8'))
}

function normalizeStage(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  if (['queued', 'aguardando_iniciar', 'triagem'].includes(normalized)) return 'queued'
  if (['in_production', 'em_producao', 'producao'].includes(normalized)) return 'in_production'
  if (['qc', 'controle_qualidade', 'rework'].includes(normalized)) return normalized === 'rework' ? 'rework' : 'qc'
  if (['shipped', 'prontas', 'pronta', 'expedicao'].includes(normalized)) return 'shipped'
  if (['delivered', 'entregue'].includes(normalized)) return 'delivered'
  return 'queued'
}

function defaultSubStatusId(stage) {
  if (stage === 'in_production') return 's1'
  if (stage === 'qc') return 's2'
  if (stage === 'shipped' || stage === 'delivered') return 's3'
  return 'queued'
}

function trayNumbersForLabItem(data) {
  if (Array.isArray(data.tray_numbers) && data.tray_numbers.length > 0) return data.tray_numbers
  const nested = data.data && typeof data.data === 'object' ? data.data : {}
  const plannedUpper = Number(nested.plannedUpperQty ?? 0)
  const plannedLower = Number(nested.plannedLowerQty ?? 0)
  const count = Math.max(1, Math.trunc(plannedUpper + plannedLower))
  const firstTray = Math.max(1, Math.trunc(Number(data.tray_number ?? nested.trayNumber ?? 1)))
  return Array.from({ length: count }, (_, index) => firstTray + index)
}

async function commitBatches(db, writes) {
  let committed = 0
  for (let index = 0; index < writes.length; index += BATCH_SIZE) {
    const batch = db.batch()
    writes.slice(index, index + BATCH_SIZE).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true })
    })
    await batch.commit()
    committed += Math.min(BATCH_SIZE, writes.length - index)
  }
  return committed
}

async function main() {
  await loadDotenvFile(path.resolve(process.cwd(), '.env.local'))
  await loadDotenvFile(path.resolve(process.cwd(), '.env'))

  const serviceAccount = await loadServiceAccount()
  const app = initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  })
  const db = getFirestore(app)

  const [clinicsSnap, labItemsSnap] = await Promise.all([
    db.collection('clinics').get(),
    db.collection('lab_items').get(),
  ])

  const writes = []
  const defaultStages = [
    { id: 's1', label: 'Termoformagem', order: 0, color: '#7C3AED', is_final: false },
    { id: 's2', label: 'Acabamento', order: 1, color: '#0891B2', is_final: false },
    { id: 's3', label: 'Expedicao', order: 2, color: '#059669', is_final: true },
  ]

  for (const clinicDoc of clinicsSnap.docs) {
    const configRef = db.collection('lab_workflow_configs').doc(clinicDoc.id)
    const configSnap = await configRef.get()
    if (!configSnap.exists) {
      writes.push({
        ref: configRef,
        data: {
          clinicId: clinicDoc.id,
          stages: defaultStages,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: 'migration',
        },
      })
    }
  }

  const activeLabItemByCaseId = new Map()

  labItemsSnap.docs.forEach((labItemDoc) => {
    const data = labItemDoc.data()
    if (data.deleted_at || data.deletedAt) return

    const nested = data.data && typeof data.data === 'object' ? data.data : {}
    const stage = normalizeStage(data.stage ?? data.status ?? nested.stage ?? nested.status)
    const trayNumbers = trayNumbersForLabItem(data)
    const subStatusId = typeof data.sub_status_id === 'string' && data.sub_status_id
      ? data.sub_status_id
      : defaultSubStatusId(stage)
    const caseId = typeof data.case_id === 'string' && data.case_id
      ? data.case_id
      : typeof nested.caseId === 'string' ? nested.caseId : ''

    writes.push({
      ref: labItemDoc.ref,
      data: {
        batch_type: data.batch_type ?? (trayNumbers.length > 1 ? 'batch' : 'single'),
        tray_numbers: trayNumbers,
        stage,
        sub_status_id: subStatusId,
        stage_history: Array.isArray(data.stage_history) ? data.stage_history : [],
        updated_at: data.updated_at ?? FieldValue.serverTimestamp(),
      },
    })

    if (caseId) {
      const previous = activeLabItemByCaseId.get(caseId)
      const updatedAt = String(data.updated_at ?? nested.updatedAt ?? data.created_at ?? '')
      if (!previous || updatedAt >= previous.updatedAt) {
        activeLabItemByCaseId.set(caseId, {
          id: labItemDoc.id,
          stage,
          subStatusId,
          updatedAt,
        })
      }
    }
  })

  activeLabItemByCaseId.forEach((labItem, caseId) => {
    writes.push({
      ref: db.collection('cases').doc(caseId),
      data: {
        lab_stage: labItem.stage,
        lab_sub_status_id: labItem.subStatusId,
        current_lab_item_id: labItem.id,
        updated_at: FieldValue.serverTimestamp(),
      },
    })
  })

  const committed = await commitBatches(db, writes)
  console.log(JSON.stringify({
    ok: true,
    clinics: clinicsSnap.size,
    labItems: labItemsSnap.size,
    caseMirrors: activeLabItemByCaseId.size,
    writes: committed,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
