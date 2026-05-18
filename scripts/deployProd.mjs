#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function run(command) {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm run preflight:prod')
run('npm run build')

const token = process.env.VERCEL_TOKEN?.trim()
run(token ? 'npx vercel deploy --prod --token "%VERCEL_TOKEN%"' : 'npx vercel deploy --prod')
