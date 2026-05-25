#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const requiredFirebaseVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=')
      if (idx <= 0) return acc
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
      acc[key] = value
      return acc
    }, {})
}

function run(command, env) {
  const result = spawnSync(command, {
    cwd: root,
    env,
    shell: true,
    stdio: 'inherit',
  })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const envFromFiles = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
  ...parseEnvFile(path.join(root, '.env.production')),
  ...parseEnvFile(path.join(root, '.env.production.local')),
}

const deployEnv = {
  ...envFromFiles,
  ...process.env,
  VITE_DATA_MODE: 'firebase',
}

const missing = requiredFirebaseVars.filter((key) => !String(deployEnv[key] ?? '').trim())
if (missing.length > 0) {
  console.error(`Firebase deploy bloqueado. Variaveis ausentes: ${missing.join(', ')}`)
  process.exit(1)
}

const firebaseProjectId = String(deployEnv.VITE_FIREBASE_PROJECT_ID ?? '').trim()
if (!/^[a-z0-9-]+$/.test(firebaseProjectId)) {
  console.error(`Firebase deploy bloqueado. Project ID invalido: ${firebaseProjectId}`)
  process.exit(1)
}

console.log(`Firebase Hosting deploy: projeto ${firebaseProjectId}`)
run('npm run build', deployEnv)
run(`firebase deploy --only hosting,firestore:rules --project ${firebaseProjectId}`, deployEnv)
