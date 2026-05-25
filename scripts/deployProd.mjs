#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const buildEnvKeys = [
  'VITE_DATA_MODE',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_WEB_PUSH_ENABLED',
  'VITE_INTERNAL_CHAT_ENABLED',
  'VITE_APP_URL',
  'VITE_MONITORING_ENABLED',
  'VITE_MONITORING_ENDPOINT',
  'VITE_RELEASE',
  'VITE_PUBLIC_POSTHOG_TOKEN',
  'VITE_PUBLIC_POSTHOG_HOST',
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

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

function run(command) {
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm run preflight:prod')
run('npm run build')

const envFromFiles = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
  ...parseEnvFile(path.join(root, '.env.production')),
  ...parseEnvFile(path.join(root, '.env.production.local')),
  ...process.env,
  VITE_DATA_MODE: 'firebase',
}
const buildEnvFlags = buildEnvKeys
  .map((key) => {
    const value = String(envFromFiles[key] ?? '').trim()
    return Object.prototype.hasOwnProperty.call(envFromFiles, key) ? `--build-env ${quote(`${key}=${value}`)}` : ''
  })
  .filter(Boolean)
  .join(' ')
const token = process.env.VERCEL_TOKEN?.trim()
const tokenFlag = token ? ` --token ${quote(token)}` : ''
run(`npx vercel deploy --prod --yes ${buildEnvFlags}${tokenFlag}`)
