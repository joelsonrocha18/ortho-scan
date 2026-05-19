import { expect, test } from '@playwright/test'
import { loginAs, seedDbAndStart } from './helpers/auth'

async function openUsersTab(page: import('@playwright/test').Page) {
  await page.locator('main').getByRole('button', { name: 'Usuários' }).click({ noWaitAfter: true })
  await expect(page.getByRole('button', { name: '+ Novo usuário' })).toBeVisible()
}

test('settings users CRUD + status + reset', async ({ page }) => {
  await seedDbAndStart(page)
  await loginAs(page, 'qa_user_master')

  await page.goto('/app/settings', { waitUntil: 'domcontentloaded' })
  await openUsersTab(page)

  await page.getByRole('button', { name: '+ Novo usuário' }).click()
  await page.getByRole('button', { name: 'Dados pessoais' }).click()
  await page.getByLabel('Nome completo').fill('Usuario E2E')
  await page.getByRole('button', { name: 'Acesso (login e senha)' }).click()
  await page.getByLabel('E-mail (login)').fill('usuario.e2e@local')
  await page.getByLabel('Senha').fill('12345678')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await openUsersTab(page)
  await expect(page.getByText('Usuario E2E')).toBeVisible()

  const row = page.locator('tr', { hasText: 'Usuario E2E' })
  await row.getByTitle('Editar').click()
  await page.getByRole('button', { name: 'Dados pessoais' }).click()
  await page.getByLabel('Nome completo').fill('Usuario E2E Editado')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await openUsersTab(page)
  await expect(page.getByText('Usuario E2E Editado')).toBeVisible()

  const editedRow = page.locator('tr', { hasText: 'Usuario E2E Editado' })
  await editedRow.getByTitle('Desativar').click()
  await openUsersTab(page)
  const editedRowAfterToggle = page.locator('tr', { hasText: 'Usuario E2E Editado' })
  await expect(editedRowAfterToggle.getByTitle('Ativar')).toBeVisible()

  await editedRowAfterToggle.getByTitle('Redefinir senha').click()
  await expect(page.getByText(/Senha tempor.ria/)).toBeVisible()

  await openUsersTab(page)
  const editedRowBeforeDelete = page.locator('tr', { hasText: 'Usuario E2E Editado' })
  await editedRowBeforeDelete.getByTitle('Excluir').click()
  await openUsersTab(page)
  await expect(page.locator('tr', { hasText: 'Usuario E2E Editado' })).toBeVisible()
})
