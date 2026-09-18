import { test, expect } from '@playwright/test'

test('landing: Admin / Operations opens the existing admin login', async ({ page }) => {
  await page.goto('/')
  const adminLink = page.getByRole('link', { name: 'Admin / Operations', exact: true })
  await expect(adminLink).toBeVisible()
  await expect(page.locator('header nav').getByRole('link', { name: 'Admin / Operations' })).toHaveCount(0)
  await adminLink.click()
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('heading', { name: /Admin Login/i })).toBeVisible()
})
