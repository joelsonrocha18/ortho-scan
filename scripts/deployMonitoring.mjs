#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=')
      if (idx <= 0) return acc
      acc[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
      return acc
    }, {})
}

function resolveProjectRef() {
  const envProduction = parseEnvFile(path.join(root, '.env.production'))
  const supabaseUrl = process.env.VITE_SUPABASE_URL || envProduction.VITE_SUPABASE_URL
  if (!supabaseUrl) return ''
  try {
    return new URL(supabaseUrl).hostname.split('.')[0]
  } catch {
    return ''
  }
}

const projectRef = process.env.SUPABASE_PROJECT_REF || resolveProjectRef()
if (!projectRef) {
  console.error('SUPABASE_PROJECT_REF ausente e VITE_SUPABASE_URL inválido.')
  process.exit(1)
}

const command = `npx supabase functions deploy frontend-monitoring --project-ref ${projectRef}`
const result = spawnSync(command, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
