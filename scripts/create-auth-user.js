import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { applicationDefault, cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { initializeApp as initializeWebApp } from 'firebase/app'
import { collection, getDocs, initializeFirestore } from 'firebase/firestore'
import pg from 'pg'

let TARGET_EMAIL = process.env.FIREBASE_AUTH_EMAIL ?? 'joelsondosanjosrocha@gmail.com'
let TEMP_PASSWORD = process.env.FIREBASE_AUTH_TEMP_PASSWORD ?? 'senha123456'
let TARGET_ROLE = process.env.FIREBASE_AUTH_ROLE ?? 'master_admin'
let MANUAL_UID = process.env.FIREBASE_AUTH_UID
const { Client } = pg

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
  }
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(`Variaveis Firebase ausentes: ${missing.join(', ')}`)
  }
  return config
}

async function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!serviceAccountPath) return null
  return JSON.parse(await fs.readFile(path.resolve(serviceAccountPath), 'utf8'))
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function getCandidateEmails(data) {
  return [
    data.email,
    data.loginEmail,
    data.login_email,
    data.actorEmail,
    data.actor_email,
    data.userEmail,
    data.user_email,
  ].map(normalizeEmail)
}

function profileFromSource(uid, source) {
  const shouldLinkDentist = TARGET_ROLE === 'dentist_admin' || TARGET_ROLE === 'dentist_client'
  const shouldLinkClinic = shouldLinkDentist || TARGET_ROLE === 'clinic_client'
  return {
    email: TARGET_EMAIL,
    login_email: TARGET_EMAIL,
    role: TARGET_ROLE,
    dentist_id: shouldLinkDentist ? source.dentist_id ?? source.dentistId ?? uid : null,
    clinic_id: shouldLinkClinic ? source.clinic_id ?? source.clinicId ?? null : null,
    is_active: source.is_active ?? source.isActive ?? true,
    deleted_at: source.deleted_at ?? source.deletedAt ?? null,
  }
}

async function listCollectionWithAdmin(db, collectionName) {
  const snapshot = await db.collection(collectionName).get()
  return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }))
}

async function listCollectionWithWeb(db, collectionName) {
  const snapshot = await getDocs(collection(db, collectionName))
  return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }))
}

async function findUidInFirestore(listCollection) {
  for (const collectionName of ['profiles', 'dentists']) {
    const rows = await listCollection(collectionName)
    const found = rows.find((row) => getCandidateEmails(row.data).includes(TARGET_EMAIL))
    if (found) {
      return { uid: found.id, collectionName, data: found.data }
    }
  }
  return null
}

async function findUidInBackup() {
  for (const tableName of ['profiles', 'dentists', 'users']) {
    try {
      const raw = await fs.readFile(path.resolve(process.cwd(), 'backup', `${tableName}.json`), 'utf8')
      const payload = JSON.parse(raw)
      const rows = Array.isArray(payload.rows) ? payload.rows : []
      const found = rows.find((row) => getCandidateEmails(row).includes(TARGET_EMAIL))
      if (found?.id) {
        return { uid: found.id, collectionName: `backup/${tableName}`, data: found }
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}

async function findUidInPostgres() {
  if (!process.env.DATABASE_URL) return null
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    const authResult = await client.query(
      'select id::text as id, email from auth.users where lower(email) = lower($1) limit 1',
      [TARGET_EMAIL],
    )
    const authUser = authResult.rows[0]
    if (authUser?.id) {
      return { uid: authUser.id, collectionName: 'postgres/auth.users', data: { email: authUser.email } }
    }
  } catch (error) {
    console.warn(`[auth] Falha ao consultar Postgres: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await client.end().catch(() => undefined)
  }

  return null
}

async function main() {
  await loadDotenvFile(path.resolve(process.cwd(), '.env.local'))
  await loadDotenvFile(path.resolve(process.cwd(), '.env'))

  TARGET_EMAIL = process.env.FIREBASE_AUTH_EMAIL ?? TARGET_EMAIL
  TEMP_PASSWORD = process.env.FIREBASE_AUTH_TEMP_PASSWORD ?? TEMP_PASSWORD
  TARGET_ROLE = process.env.FIREBASE_AUTH_ROLE ?? TARGET_ROLE
  MANUAL_UID = process.env.FIREBASE_AUTH_UID ?? MANUAL_UID

  const config = getFirebaseConfig()
  const serviceAccount = await loadServiceAccount()
  const hasAdminCredential = Boolean(serviceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS)

  let uidSource = MANUAL_UID ? { uid: MANUAL_UID, collectionName: 'FIREBASE_AUTH_UID', data: {} } : null
  let adminApp = null

  if (!uidSource && hasAdminCredential) {
    adminApp = initializeAdminApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      projectId: config.projectId,
    })
    const adminDb = getAdminFirestore(adminApp)
    uidSource = await findUidInFirestore((collectionName) => listCollectionWithAdmin(adminDb, collectionName))
  } else if (!uidSource) {
    const webApp = initializeWebApp(config)
    const webDb = initializeFirestore(webApp, { experimentalForceLongPolling: true })
    uidSource = await findUidInFirestore((collectionName) => listCollectionWithWeb(webDb, collectionName))
  }

  if (!uidSource) uidSource = await findUidInPostgres()
  if (!uidSource) uidSource = await findUidInBackup()
  if (!uidSource) {
    throw new Error(`Nao encontrei UID original de perfil/admin para ${TARGET_EMAIL} em profiles, dentists ou backups equivalentes.`)
  }

  console.log(`[auth] UID encontrado: ${uidSource.uid} (${uidSource.collectionName})`)

  if (!hasAdminCredential) {
    throw new Error(
      'Credencial Firebase Admin ausente. Defina FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_PATH ' +
      'ou GOOGLE_APPLICATION_CREDENTIALS para criar usuario no Firebase Auth com UID fixo.',
    )
  }

  const app = adminApp ?? (getApps()[0] ?? initializeAdminApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId: config.projectId,
  }))
  const auth = getAuth(app)
  const adminDb = getAdminFirestore(app)

  try {
    const existing = await auth.getUser(uidSource.uid)
    await auth.updateUser(existing.uid, {
      email: TARGET_EMAIL,
      password: TEMP_PASSWORD,
      emailVerified: true,
      disabled: false,
    })
    console.log(`[auth] Usuario existente atualizado: ${existing.uid}`)
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'auth/user-not-found') throw error
    const created = await auth.createUser({
      uid: uidSource.uid,
      email: TARGET_EMAIL,
      password: TEMP_PASSWORD,
      emailVerified: true,
      disabled: false,
    })
    console.log(`[auth] Usuario criado: ${created.uid}`)
  }

  const profileRef = adminDb.collection('profiles').doc(uidSource.uid)
  const profileSnapshot = await profileRef.get()
  if (!profileSnapshot.exists) {
    await profileRef.set(profileFromSource(uidSource.uid, uidSource.data), { merge: true })
    console.log('[auth] Perfil criado em profiles para manter permissoes.')
  } else {
    await profileRef.set({ email: TARGET_EMAIL, login_email: TARGET_EMAIL, is_active: true, deleted_at: null }, { merge: true })
    console.log('[auth] Perfil existente atualizado em profiles.')
  }
}

main().catch((error) => {
  console.error(`[auth] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
