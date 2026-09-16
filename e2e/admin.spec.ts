import { test, expect } from '@playwright/test'

test.describe('Admin prototype path', () => {
  test('login → dashboard shows seeded apps → open detail', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel(/password|ಪಾಸ್‌ವರ್ಡ್/i).fill('demo')
    await page.getByRole('button', { name: /log in|ಲಾಗಿನ್/i }).click()
    await expect(page.getByRole('heading', { name: /admin dashboard|ಅಡ್ಮಿನ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್/i })).toBeVisible()
    await page.getByRole('link', { name: /view all applications|ಎಲ್ಲಾ ಅರ್ಜಿಗಳನ್ನು ನೋಡಿ/i }).click()
    await expect(page.getByText('APP-DEMO-0001')).toBeVisible()
    await page.getByRole('link', { name: /review|ಪರಿಶೀಲಿಸಿ/i }).first().click()
    await expect(page.getByText(/ministry|department|ಸಚಿವಾಲಯ|ಇಲಾಖೆ/i).first()).toBeVisible()
  })
})
