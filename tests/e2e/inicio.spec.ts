import { expect, test } from '@playwright/test'

test('la raíz lleva al acceso', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('la franja de demo no aparece fuera del modo demo', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('datos ficticios')).toHaveCount(0)
})
