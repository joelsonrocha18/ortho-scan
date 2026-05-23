import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { initializeApp } from 'firebase/app'
import { doc, getDoc, initializeFirestore, setDoc } from 'firebase/firestore'

const ADMIN_UID = 'rA7Fzd82D8cZ2mpvnyV05oCBJDg2'
const ADMIN_EMAIL = 'joelsondosanjosrocha@gmail.com'

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
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  }
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(`Variaveis Firebase ausentes: ${missing.join(', ')}`)
  }
  return config
}

async function main() {
  await loadDotenvFile(path.resolve(process.cwd(), '.env.local'))
  await loadDotenvFile(path.resolve(process.cwd(), '.env'))

  const app = initializeApp(getFirebaseConfig())
  const db = initializeFirestore(app, { experimentalForceLongPolling: true })
  const now = new Date().toISOString()

  const profileRef = doc(db, 'profiles', ADMIN_UID)
  const existingProfile = await getDoc(profileRef)
  const createdAt = existingProfile.exists() && typeof existingProfile.data().createdAt === 'string'
    ? existingProfile.data().createdAt
    : now

  await setDoc(profileRef, {
    id: ADMIN_UID,
    user_id: ADMIN_UID,
    email: ADMIN_EMAIL,
    loginEmail: ADMIN_EMAIL,
    login_email: ADMIN_EMAIL,
    role: 'master_admin',
    isActive: true,
    is_active: true,
    deletedAt: null,
    deleted_at: null,
    createdAt,
    created_at: createdAt,
    updatedAt: now,
    updated_at: now,
  }, { merge: true })

  const saved = await getDoc(profileRef)
  if (!saved.exists()) {
    throw new Error('Perfil admin nao foi encontrado apos gravar.')
  }

  const data = saved.data()
  console.log(JSON.stringify({
    ok: true,
    collection: 'profiles',
    uid: ADMIN_UID,
    email: data.email,
    role: data.role,
    isActive: data.isActive ?? data.is_active,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
