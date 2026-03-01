import { test, expect } from '@playwright/test'
import { loginAs, seedDbAndStart } from './helpers/auth'

test('smoke routes for master_admin', async ({ page }) => {
  await seedDbAndStart(page)
  await loginAs(page, 'qa_user_master')

  const routes: Array<{ path: string; marker: string }> = [
    { path: '/app/dashboard', marker: 'Painel Operacional' },
    { path: '/app/scans', marker: 'Exames (Scans)' },
    { path: '/app/cases', marker: 'Alinhadores' },
    { path: '/app/lab', marker: 'Fila de produção e entregas' },
    { path: '/app/dentists', marker: 'Dentistas' },
    { path: '/app/patients', marker: 'Pacientes' },
    { path: '/app/settings/diagnostics', marker: 'Diagnostico do Sistema' },
  ]

  for (const route of routes) {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(new RegExp(route.path.replace('/', '\\/')))
    await expect(page.locator('main')).toContainText(route.marker)
  }
})
