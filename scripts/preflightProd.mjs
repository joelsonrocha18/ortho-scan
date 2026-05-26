#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const requiredVars = [
  'VITE_DATA_MODE',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_APP_URL',
]

const recommendedVars = [
  'VITE_MONITORING_ENABLED',
  'VITE_RELEASE',
  'VITE_PUBLIC_POSTHOG_TOKEN',
  'VITE_PUBLIC_POSTHOG_HOST',
]

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=')
      if (idx <= 0) return acc
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
      acc[key] = value
      return acc
    }, {})
}

function validate() {
  const envProduction = parseEnvFile(path.join(root, '.env.production'))
  const envLocal = parseEnvFile(path.join(root, '.env.local'))
  const merged = { ...envLocal, ...envProduction, ...process.env }

  const missing = requiredVars.filter((key) => !String(merged[key] ?? '').trim())
  const weakDataMode = String(merged.VITE_DATA_MODE ?? '').trim().toLowerCase() !== 'firebase'
  const weakFirebaseProject = String(merged.VITE_FIREBASE_PROJECT_ID ?? '').trim() !== 'gostosao-3421e'
  const missingRecommended = recommendedVars.filter((key) => !String(merged[key] ?? '').trim())

  console.log('Preflight de producao')
  console.log(`- Fonte lida: ${fs.existsSync(path.join(root, '.env.production')) ? '.env.production' : '.env.local/process.env'}`)

  if (missing.length > 0) {
    console.error(`- ERRO: variaveis obrigatorias ausentes: ${missing.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('- OK: variaveis obrigatorias preenchidas.')
  }

  if (weakDataMode) {
    console.error('- ERRO: VITE_DATA_MODE deve ser "firebase" em producao.')
    process.exitCode = 1
  } else {
    console.log('- OK: VITE_DATA_MODE=firebase.')
  }

  if (weakFirebaseProject) {
    console.error('- ERRO: VITE_FIREBASE_PROJECT_ID deve ser "gostosao-3421e" em producao.')
    process.exitCode = 1
  } else {
    console.log('- OK: VITE_FIREBASE_PROJECT_ID=gostosao-3421e.')
  }

  if (missingRecommended.length > 0) {
    console.warn(`- AVISO: variaveis recomendadas ausentes: ${missingRecommended.join(', ')}`)
  } else {
    console.log('- OK: variaveis recomendadas preenchidas.')
  }

  if (process.exitCode && process.exitCode !== 0) {
    console.error('Preflight falhou.')
    return
  }
  console.log('Preflight concluido com sucesso.')
}

validate()
