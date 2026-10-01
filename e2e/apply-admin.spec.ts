import { test, expect } from '@playwright/test'

test.describe('Citizen apply → admin visibility', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 12.5242, longitude: 76.8958 },
  })

  test('wizard submit creates an application visible in admin', async ({ page }) => {
    await page.goto('/apply')
    await page.getByRole('button', { name: /skip — i will fill|ಸ್ಕಿಪ್/i }).click()

    // Profile: fresh applications require explicit applicant and location details.
    await page.getByLabel(/full name/i).fill('Lakshmi S.')
    await page.getByLabel(/^age/i).fill('32')
    await page.getByLabel(/^gender/i).selectOption('female')
    await page.getByLabel(/^community/i).selectOption('sc')
    await page.getByLabel(/business category/i).selectOption('dairy')
    await page.getByLabel(/available margin/i).fill('50000')
    await page.getByLabel(/annual family income/i).fill('120000')
    await page.getByLabel(/years of experience/i).fill('4')
    await page.getByRole('button', { name: /use my current location/i }).click()
    await expect(page.getByText('12.52420, 76.89580', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /run hyperlocal scan|ಹೈಪರ್‌ಲೋಕಲ್/i }).click()
    await expect(page.getByRole('heading', { name: /tell us more|ಇನ್ನಷ್ಟು/i })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: /skip this step|ಸ್ಕಿಪ್/i }).click()
    await page.getByRole('button', { name: /continue with nsfdc|NSFDC/i }).click()
    await page.getByRole('button', { name: /continue to scheme|ಯೋಜನೆ/i }).click()
    await page.getByRole('button', { name: /continue to financial|ಹಣಕಾಸು/i }).click()
    await page.getByRole('button', { name: /continue to application|ಅರ್ಜಿ/i }).click()

    await page.getByLabel(/phone number|ಫೋನ್/i).fill('9876543210')
    await page.getByLabel(/^address|ವಿಳಾಸ/i).fill('Near temple')
    await page.getByLabel(/village \/ town|ಗ್ರಾಮ/i).fill('Dinka')
    await page.getByLabel(/district|ಜಿಲ್ಲೆ/i).fill('Mandya')
    await page.getByLabel(/bank account number|ಬ್ಯಾಂಕ್ ಖಾತೆ/i).fill('1234567890')
    await page.getByLabel(/bank ifsc|IFSC/i).fill('SBIN0001234')
    await page.getByLabel(/describe your business|ವ್ಯವಹಾರ/i).fill('Dairy micro enterprise')
    await page.getByRole('button', { name: /continue to documents|ದಾಖಲೆ/i }).click()

    await page.getByRole('button', { name: /continue to review|ಪರಿಶೀಲನೆ/i }).click()
    await page.getByRole('button', { name: /continue to consent|ಸಮ್ಮತಿ/i }).click()

    await page.getByText(/information provided is accurate|ನಿಖರ/i).click()
    await page.getByText(/consent to this application being shared|ಸಮ್ಮತಿಸುತ್ತೇನೆ/i).click()
    await page.getByPlaceholder(/full name|ಪೂರ್ಣ ಹೆಸರು/i).fill('Lakshmi S.')
    await page.getByRole('button', { name: /continue to submission|ಸಲ್ಲಿಕೆ/i }).click()

    await page.getByRole('button', { name: /submit application|ಅರ್ಜಿ ಸಲ್ಲಿಸಿ/i }).click()
    const idText = page.locator('text=/LP-APP-/')
    await expect(idText.first()).toBeVisible()
    const appId = (await idText.first().textContent())?.trim()
    expect(appId).toMatch(/^LP-APP-[A-F0-9]{16}$/i)

    await page.getByRole('button', { name: /track status|ಟ್ರ್ಯಾಕ್/i }).click()
    await expect(page.getByText(appId!)).toBeVisible()
    await expect(page.getByText(/approval service status|ಅನುಮೋದನಾ ಸೇವೆ ಸ್ಥಿತಿ/i)).toBeVisible()

    await page.goto('/admin/login')
    await page.getByLabel(/password|ಪಾಸ್‌ವರ್ಡ್/i).fill('x')
    await page.getByRole('button', { name: /log in|ಲಾಗಿನ್/i }).click()
    await page.goto('/admin/applications')
    await expect(page.getByText(appId!)).toBeVisible()
  })
})
