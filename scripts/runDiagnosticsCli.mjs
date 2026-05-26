import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const reportsDir = path.join(root, 'reports')
const outFile = path.join(reportsDir, 'diagnostics.json')

const requiredRoutes = [
  '/login',
  '/app/dashboard',
  '/app/scans',
  '/app/cases',
  '/app/lab',
  '/app/dentists',
  '/app/patients',
  '/app/settings/diagnostics',
]

const requiredRoles = [
  'master_admin',
  'dentist_admin',
  'dentist_client',
  'clinic_client',
  'lab_tech',
  'receptionist',
]

const requiredPermissionKeys = [
  'dashboard.read',
  'users.read',
  'users.write',
  'users.delete',
  'dentists.read',
  'dentists.write',
  'dentists.delete',
  'clinics.read',
  'clinics.write',
  'clinics.delete',
  'patients.read',
  'patients.write',
  'patients.delete',
  'scans.read',
  'scans.write',
  'scans.approve',
  'cases.read',
  'cases.write',
  'lab.read',
  'lab.write',
  'docs.read',
  'docs.write',
  'settings.read',
  'settings.write',
]

function now() {
  return new Date().toISOString()
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function run(command) {
  try {
    const output = execSync(command, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return { ok: true, output: output.trim() }
  } catch (e) {
    return {
      ok: false,
      output: `${e.stdout?.toString()?.trim() || ''}\n${e.stderr?.toString()?.trim() || ''}`.trim(),
    }
  }
}

function pass(id, title, message, details = '') {
  return { id, title, status: 'pass', message, details }
}

function warn(id, title, message, details = '') {
  return { id, title, status: 'warn', message, details }
}

function fail(id, title, message, details = '') {
  return { id, title, status: 'fail', message, details }
}

const startedAt = now()
const items = []

fs.mkdirSync(reportsDir, { recursive: true })

const nodeV = run('node -v')
const npmV = run('npm -v')
if (nodeV.ok && npmV.ok) {
  items.push(pass('env_versions', 'Node/NPM', `Node ${nodeV.output} | NPM ${npmV.output}`))
} else {
  items.push(fail('env_versions', 'Node/NPM', 'Falha ao obter versoes.', `${nodeV.output}\n${npmV.output}`))
}

const dbFile = read('src/data/db.ts')
if (dbFile.includes("arrimo_orthoscan_db_v1")) {
  items.push(pass('db_key', 'DB key', 'Chave do DB local encontrada em db.ts.'))
} else {
  items.push(fail('db_key', 'DB key', 'Chave arrimo_orthoscan_db_v1 nao encontrada em db.ts.'))
}

const routesFile = read('src/routes/appRoutes.ts')
const missingRoutes = requiredRoutes.filter((route) => !routesFile.includes(`'${route}'`))
if (missingRoutes.length === 0) {
  items.push(pass('routes_core', 'Rotas essenciais', `Todas as rotas essenciais estao declaradas (${requiredRoutes.length}).`))
} else {
  items.push(fail('routes_core', 'Rotas essenciais', `Rotas ausentes: ${missingRoutes.join(', ')}`))
}

const userType = read('src/types/User.ts')
const missingRoles = requiredRoles.filter((role) => !userType.includes(`'${role}'`))
if (missingRoles.length === 0) {
  items.push(pass('rbac_roles', 'Roles', 'Todas as roles obrigatorias foram encontradas.'))
} else {
  items.push(fail('rbac_roles', 'Roles', `Roles ausentes: ${missingRoles.join(', ')}`))
}

const perms = read('src/auth/permissions.ts')
if (requiredRoles.every((role) => perms.includes(`${role}:`))) {
  items.push(pass('rbac_mapping', 'Permissoes por role', 'Mapeamento de permissoes encontrado para todas as roles.'))
} else {
  items.push(fail('rbac_mapping', 'Permissoes por role', 'Ha roles sem mapeamento em permissions.ts.'))
}
const missingPermissionKeysInApp = requiredPermissionKeys.filter((key) => !perms.includes(`'${key}'`))
if (missingPermissionKeysInApp.length === 0) {
  items.push(pass('rbac_permissions_app', 'Permissoes no app', `Todas as permissoes obrigatorias foram encontradas (${requiredPermissionKeys.length}).`))
} else {
  items.push(fail('rbac_permissions_app', 'Permissoes no app', `Permissoes ausentes no app: ${missingPermissionKeysInApp.join(', ')}`))
}

const scope = read('src/auth/scope.ts')
if (scope.includes('listPatientsForUser') && scope.includes('listScansForUser') && scope.includes('listCasesForUser')) {
  items.push(pass('scope_fns', 'Escopo', 'Funcoes de escopo principais encontradas.'))
} else {
  items.push(fail('scope_fns', 'Escopo', 'Funcoes de escopo incompletas.'))
}

const cameraFile = read('src/components/files/FilePickerWithCamera.tsx')
const hasCapture = cameraFile.includes('capture={capture}')
const hasAccept = cameraFile.includes('accept={accept}')
const hasIosFallback = cameraFile.includes('iPhone|iPad|iPod')
if (hasCapture && hasAccept && hasIosFallback) {
  items.push(pass('camera_fallback', 'Upload + Camera', 'Componente contem accept/capture e fallback iOS.'))
} else {
  items.push(warn('camera_fallback', 'Upload + Camera', 'Cobertura parcial do fallback de camera detectada.'))
}

const lint = run('npm run lint --silent')
if (lint.ok) {
  items.push(pass('smoke_lint', 'Smoke lint', 'Lint executado com sucesso.'))
} else {
  items.push(fail('smoke_lint', 'Smoke lint', 'Lint falhou.', lint.output.slice(0, 1500)))
}

const typecheck = run('npm run typecheck --silent')
if (typecheck.ok) {
  items.push(pass('smoke_typecheck', 'Smoke typecheck', 'Typecheck executado com sucesso.'))
} else {
  items.push(fail('smoke_typecheck', 'Smoke typecheck', 'Typecheck falhou.', typecheck.output.slice(0, 1500)))
}

const rbacSmoke = run('npm run test -- --run src/tests/rbac/rbacScope.test.ts')
if (rbacSmoke.ok) {
  items.push(pass('smoke_rbac_runtime', 'Smoke RBAC runtime', 'Teste de RBAC executado com sucesso.'))
} else {
  items.push(fail('smoke_rbac_runtime', 'Smoke RBAC runtime', 'Teste de RBAC falhou.', rbacSmoke.output.slice(0, 1500)))
}

const finishedAt = now()
const summary = items.reduce(
  (acc, item) => {
    acc[item.status] += 1
    return acc
  },
  { pass: 0, warn: 0, fail: 0 },
)

const report = {
  startedAt,
  finishedAt,
  durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  summary,
  items,
}

fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

console.log(`Diagnostics saved: ${path.relative(root, outFile)}`)
console.log(`PASS=${summary.pass} WARN=${summary.warn} FAIL=${summary.fail}`)

if (summary.fail > 0) {
  process.exitCode = 1
}
