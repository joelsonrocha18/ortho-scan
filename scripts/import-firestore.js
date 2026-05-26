import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { applicationDefault, cert, initializeApp as initializeAdminApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { initializeApp } from 'firebase/app'
import { collection, doc, getDocs, initializeFirestore, limit, query, writeBatch } from 'firebase/firestore'

const DEFAULT_TABLES = ['patients', 'dentists', 'clinics', 'cases', 'scans', 'lab_items']
const TABLES = (process.env.IMPORT_TABLES ?? '')
  .split(',')
  .map((table) => table.trim())
  .filter(Boolean)
const ACTIVE_TABLES = TABLES.length > 0 ? TABLES : DEFAULT_TABLES
const BACKUP_DIR = path.resolve(process.cwd(), 'backup')
const BATCH_SIZE = 450

function stripInlineComment(value) {
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char
    }
    if (char === '#' && !quote) {
      return value.slice(0, index).trim()
    }
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
      if (process.env[key]) return
      process.env[key] = stripInlineComment(rawValue).replace(/^['"]|['"]$/g, '')
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

function getFirebaseConfig() {
  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
  }
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(`Variaveis Firebase ausentes: ${missing.join(', ')}`)
  }
  return config
}

async function preflightFirestoreApi(config) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:runQuery?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
          from: [{ collectionId: ACTIVE_TABLES[0] }],
            limit: 1,
          },
        }),
        signal: controller.signal,
      },
    )
    if (response.ok) return

    const body = await response.text()
    if (body.includes('firestore.googleapis.com') || body.includes('Cloud Firestore API')) {
      throw new Error(
        `Cloud Firestore API nao esta ativa para o projeto ${config.projectId}. ` +
        'Ative o Firestore no console Firebase/Google Cloud e execute novamente.',
      )
    }
    throw new Error(`Preflight Firestore falhou com HTTP ${response.status}: ${body.slice(0, 400)}`)
  } finally {
    clearTimeout(timeout)
  }
}

async function readBackupRows(tableName) {
  const filePath = path.join(BACKUP_DIR, `${tableName}.json`)
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'))
  if (!Array.isArray(payload.rows)) {
    throw new Error(`Backup invalido para ${tableName}: campo rows ausente.`)
  }
  if (tableName === 'lab_items') {
    const activeRows = payload.rows.filter((row) => !row.deleted_at && !row.deletedAt)
    console.log(`[firestore] lab_items: ${activeRows.length} ativos de ${payload.rows.length} linhas no backup`)
    return activeRows
  }
  return payload.rows
}

async function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!serviceAccountPath) return null
  return JSON.parse(await fs.readFile(path.resolve(serviceAccountPath), 'utf8'))
}

function normalizeFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, normalizeFirestoreValue(entryValue)]),
  )
}

async function importCollectionWithWebSdk(db, tableName) {
  const rows = await readBackupRows(tableName)
  let imported = 0
  let batch = writeBatch(db)
  let batchSize = 0

  for (const row of rows) {
    if (!row.id || typeof row.id !== 'string') {
      throw new Error(`Registro sem id string em ${tableName}.`)
    }

    batch.set(doc(db, tableName, row.id), normalizeFirestoreValue(row))
    batchSize += 1

    if (batchSize >= BATCH_SIZE) {
      await batch.commit()
      imported += batchSize
      console.log(`[firestore] ${tableName}: ${imported}/${rows.length}`)
      batch = writeBatch(db)
      batchSize = 0
    }
  }

  if (batchSize > 0) {
    await batch.commit()
    imported += batchSize
  }

  console.log(`[firestore] ${tableName}: ${imported} documentos importados`)
  return imported
}

async function validateCollectionWithWebSdk(db, tableName) {
  const snapshot = await getDocs(query(collection(db, tableName), limit(1)))
  return !snapshot.empty
}

async function importCollectionWithAdmin(db, tableName) {
  const rows = await readBackupRows(tableName)
  let imported = 0
  let batch = db.batch()
  let batchSize = 0

  for (const row of rows) {
    if (!row.id || typeof row.id !== 'string') {
      throw new Error(`Registro sem id string em ${tableName}.`)
    }

    batch.set(db.collection(tableName).doc(row.id), normalizeFirestoreValue(row))
    batchSize += 1

    if (batchSize >= BATCH_SIZE) {
      await batch.commit()
      imported += batchSize
      console.log(`[firestore-admin] ${tableName}: ${imported}/${rows.length}`)
      batch = db.batch()
      batchSize = 0
    }
  }

  if (batchSize > 0) {
    await batch.commit()
    imported += batchSize
  }

  console.log(`[firestore-admin] ${tableName}: ${imported} documentos importados`)
  return imported
}

async function validateCollectionWithAdmin(db, tableName) {
  const snapshot = await db.collection(tableName).limit(1).get()
  return !snapshot.empty
}

async function main() {
  await loadDotenvFile(path.resolve(process.cwd(), '.env.local'))
  await loadDotenvFile(path.resolve(process.cwd(), '.env'))

  const firebaseConfig = getFirebaseConfig()
  const serviceAccount = await loadServiceAccount()
  const useAdmin = Boolean(serviceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const app = useAdmin
    ? initializeAdminApp({
        credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
        projectId: firebaseConfig.projectId,
      })
    : initializeApp(firebaseConfig)
  const db = useAdmin ? getAdminFirestore(app) : initializeFirestore(app, { experimentalForceLongPolling: true })
  if (!useAdmin) await preflightFirestoreApi(firebaseConfig)
  console.log(`[firestore] usando ${useAdmin ? 'firebase-admin' : 'SDK Web'} para importacao`)
  const summary = {}

  for (const table of ACTIVE_TABLES) {
    summary[table] = useAdmin
      ? await importCollectionWithAdmin(db, table)
      : await importCollectionWithWebSdk(db, table)
  }

  const validation = {}
  for (const table of ACTIVE_TABLES) {
    validation[table] = useAdmin
      ? await validateCollectionWithAdmin(db, table)
      : await validateCollectionWithWebSdk(db, table)
  }

  console.log('[firestore] resumo:', JSON.stringify({ imported: summary, validation }, null, 2))
}

main().catch((error) => {
  console.error(`[firestore] importacao falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
