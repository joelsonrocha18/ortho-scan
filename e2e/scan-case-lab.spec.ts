import { test, expect } from '@playwright/test'
import { loginAs, seedDbAndStart } from './helpers/auth'

test('scan to case to lab flow', async ({ page }) => {
  await seedDbAndStart(page)
  await loginAs(page, 'qa_user_master')

  await page.goto('/app/scans', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Criar Caso' }).first().click({ noWaitAfter: true })
  await page.getByRole('button', { name: 'Criar Caso' }).nth(1).click({ noWaitAfter: true })

  await expect(page).toHaveURL(/\/app\/cases\//)
  await expect(page.getByText(/Queixa do paciente:/i)).toBeVisible()
  await expect(page.getByText(/Orienta.*do dentista:/i)).toBeVisible()
  await expect(page.getByText('Queixa A')).toBeVisible()
  await expect(page.getByText('Orientacao A')).toBeVisible()

  await page.getByRole('button', { name: 'Concluir planejamento' }).click()
  const closeBudgetButton = page.getByRole('button', { name: /Fechar or.amento/ })
  await expect(closeBudgetButton).toBeEnabled()
  await page.getByPlaceholder('R$ 0,00').fill('12000')
  await closeBudgetButton.click()
  const approveButton = page.getByRole('button', { name: 'Aprovar contrato' })
  await expect(approveButton).toBeEnabled({ timeout: 30_000 })
  await approveButton.click()
  await page.getByRole('button', { name: 'Gerar OS para o LAB' }).click()

  await page.goto('/app/lab')
  await expect(page.getByRole('heading', { level: 3, name: 'Aguardando iniciar' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: /Em produ/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Controle de qualidade' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Prontas' })).toBeVisible()
})
