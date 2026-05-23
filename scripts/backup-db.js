import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg

const DEFAULT_TABLES = ['patients', 'dentists', 'clinics', 'cases', 'scans', 'lab_items']
const TABLES = (process.env.BACKUP_TABLES ?? '')
  .split(',')
  .map((table) => table.trim())
  .filter(Boolean)
const ACTIVE_TABLES = TABLES.length > 0 ? TABLES : DEFAULT_TABLES
const BACKUP_DIR = path.resolve(process.cwd(), 'backup')

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
      const value = stripInlineComment(rawValue).replace(/^['"]|['"]$/g, '')
      process.env[key] = value
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

function quoteIdentifier(identifier) {
  if (!DEFAULT_TABLES.includes(identifier)) {
    throw new Error(`Tabela nao permitida para backup: ${identifier}`)
  }
  return `"${identifier.replaceAll('"', '""')}"`
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function backupTable(client, tableName) {
  const startedAt = new Date().toISOString()
  const query = `select * from ${quoteIdentifier(tableName)}`
  const result = await client.query(query)
  const finishedAt = new Date().toISOString()
  const outputPath = path.join(BACKUP_DIR, `${tableName}.json`)

  await writeJson(outputPath, {
    table: tableName,
    rowCount: result.rowCount,
    startedAt,
    finishedAt,
    rows: result.rows,
  })

  return {
    table: tableName,
    rowCount: result.rowCount,
    file: outputPath,
  }
}

async function main() {
  await loadDotenvFile(path.resolve(process.cwd(), '.env.local'))
  await loadDotenvFile(path.resolve(process.cwd(), '.env'))

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL nao encontrada. Defina no .env.local ou no ambiente antes de executar.')
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true })

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
  })

  const manifest = {
    createdAt: new Date().toISOString(),
    tables: [],
  }

  await client.connect()
  try {
    for (const table of ACTIVE_TABLES) {
      const entry = await backupTable(client, table)
      manifest.tables.push(entry)
      console.log(`[backup] ${table}: ${entry.rowCount} linhas -> ${path.relative(process.cwd(), entry.file)}`)
    }
  } finally {
    await client.end()
  }

  await writeJson(path.join(BACKUP_DIR, 'manifest.json'), manifest)
  console.log(`[backup] manifest: ${path.relative(process.cwd(), path.join(BACKUP_DIR, 'manifest.json'))}`)
}

main().catch((error) => {
  console.error(`[backup] falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
