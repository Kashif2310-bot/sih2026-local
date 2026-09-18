import { test, expect } from '@playwright/test'

/**
 * Application automation (Adita): same workflow for guided / assisted /
 * government API. These tests assert the honesty contract — guided filing
 * must not say the government received the application.
 */

async function fillRequiredAndDocuments(page: import('@playwright/test').Page) {
  await page.getByLabel(/Applicant full name/i).fill('Lakshmi S')
  await page.getByLabel(/Mobile number/i).fill('9876543210')
  const gender = page.getByLabel(/^Gender/i)
  if (await gender.inputValue() === '') {
    await gender.fill('female')
  }

  await page.getByRole('button', { name: /Next: documents/i }).click()

  const docSelects = page.locator('select[aria-label]')
  const count = await docSelects.count()
  for (let i = 0; i < count; i++) {
    await docSelects.nth(i).selectOption('declared_available')
  }
  await page.getByRole('button', { name: /Next: review packet/i }).click()
  await expect(page.getByRole('heading', { name: /Generated application/i })).toBeVisible()
  await page.getByRole('button', { name: /Next: consent/i }).click()
}

test('apply: guided packet is tracked without claiming a government submission', async ({ page }) => {
  await page.goto('/assistant')
  await page.getByLabel('Message').fill(
    'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.',
  )
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('article', { name: /NSFDC Term Loan Scheme/i }).getByText('View details').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Start application' }).click()

  await expect(page.getByRole('heading', { name: /Prepare application/i })).toBeVisible()
  await expect(page.getByText(/Citizen profile \+ scheme/i)).toBeVisible()

  await fillRequiredAndDocuments(page)

  await page.getByRole('radio', { name: /Guided submission/i }).check()
  await page.getByText(/I confirm the details are accurate and I consent to preparing this application package/i).click()
  await page.getByRole('button', { name: /Consent and route application/i }).click()

  await expect(page.getByRole('heading', { name: /Application status/i })).toBeVisible()
  await expect(page.getByText(/Prepared successfully/i).first()).toBeVisible()
  await expect(page.getByText(/Application package prepared/i).first()).toBeVisible()
  await expect(page.getByText(/submitted successfully/i)).toHaveCount(0)
  await expect(page.getByText(/submit there yourself/i)).toHaveCount(0)
  await expect(page.getByText(/does not submit the form for you/i)).toHaveCount(0)
  await expect(page.getByText(/Government filing/i).first()).toBeVisible()
  await expect(page.getByText(/External channel/i).first()).toBeVisible()
  await expect(page.getByText(/View official scheme portal/i).first()).toBeVisible()
  await expect(page.getByText(/Jordan · Approval Service/i).first()).toBeVisible()
  await expect(page.getByText(/LP-GUIDED-/i).first()).toBeVisible()
  const appId = (await page.locator('text=/LP-APP-[A-F0-9]{16}/i').first().textContent())?.trim()
  expect(appId).toMatch(/^LP-APP-[A-F0-9]{16}$/i)
  await expect(page.getByText(/Application packet hash \(SHA-256\)/i).first()).toBeVisible()

  await page.locator('header').getByRole('link', { name: /^Apply$/ }).first().click()
  await expect(page.getByRole('heading', { name: /Application status/i })).toBeVisible()
  await expect(page.getByText(/Step 1 of 14/i)).toHaveCount(0)
  await expect(page.getByText(appId!).first()).toBeVisible()

  await page.goto('/admin/login')
  await page.getByLabel(/password|ಪಾಸ್‌ವರ್ಡ್/i).fill('x')
  await page.getByRole('button', { name: /log in|ಲಾಗಿನ್/i }).click()
  await page.goto('/admin/applications')
  await expect(page.getByText(appId!)).toBeVisible()
  await page.getByRole('link', { name: /^Review$/ }).first().click()
  await expect(page.getByText(appId!)).toBeVisible()
  await page.getByRole('button', { name: /^Documents$/ }).click()
  await expect(page.getByText(/Declared available/i).first()).toBeVisible()
  await expect(page.getByText(/Uploaded — pending verification/i)).toHaveCount(0)
  await page.getByRole('button', { name: /^Details$/ }).click()
  await expect(page.getByText(/Government filing/i).first()).toBeVisible()
  await page.getByRole('button', { name: /^Multisig Approval$/ }).click()
  await page.getByRole('button', { name: /Open approval case/i }).click()
  await expect(page.getByText(/Application packet hash \(SHA-256\)/i).first()).toBeVisible()
  await expect(page.getByText(/Approval snapshot digest \(Jordan\)/i).first()).toBeVisible()
})

test('apply: government API with no config fails honestly; simulation is labelled', async ({ page }) => {
  await page.goto('/apply/hub')
  await expect(page.getByRole('heading', { name: /Application automation/i })).toBeVisible()
  await page.getByRole('button', { name: /Mudra Yojana/i }).click()

  await expect(page.getByRole('heading', { name: /Prepare application/i })).toBeVisible()
  await page.getByLabel(/Applicant full name/i).fill('Test Applicant')
  await page.getByLabel(/Mobile number/i).fill('9123456789')
  await page.getByLabel(/^State/i).fill('Karnataka')
  await page.getByLabel(/Area type/i).fill('rural')
  await page.getByLabel(/^Age/i).fill('30')
  await page.getByLabel(/^Gender/i).fill('female')
  await page.getByLabel(/Social category/i).fill('sc')
  await page.getByLabel(/Annual household income/i).fill('200000')
  await page.getByLabel(/Business sector/i).fill('dairy')
  await page.getByLabel(/Business stage/i).fill('new')
  await page.getByLabel(/Loan \/ financing requested/i).fill('150000')

  await page.getByRole('button', { name: /Next: documents/i }).click()
  const docSelects = page.locator('select[aria-label]')
  const count = await docSelects.count()
  for (let i = 0; i < count; i++) {
    await docSelects.nth(i).selectOption('will_submit_on_portal')
  }
  await page.getByRole('button', { name: /Next: review packet/i }).click()
  await page.getByRole('button', { name: /Next: consent/i }).click()

  await page.getByRole('radio', { name: /Real government API/i }).check()
  await page.getByText(/I confirm the details are accurate and I consent to sending this application package/i).click()
  await page.getByRole('button', { name: /Consent and route application/i }).click()

  await expect(page.getByText(/Application package prepared/i).first()).toBeVisible()
  await expect(page.getByText(/submitted successfully/i)).toHaveCount(0)
  await expect(page.getByText(/Government filing/i).first()).toBeVisible()

  await page.goto('/apply/hub')
  await page.getByRole('button', { name: /Mudra Yojana/i }).click()
  await page.getByLabel(/Applicant full name/i).fill('Test Applicant')
  await page.getByLabel(/Mobile number/i).fill('9123456789')
  await page.getByLabel(/^State/i).fill('Karnataka')
  await page.getByLabel(/Area type/i).fill('rural')
  await page.getByLabel(/^Age/i).fill('30')
  await page.getByLabel(/^Gender/i).fill('female')
  await page.getByLabel(/Social category/i).fill('sc')
  await page.getByLabel(/Annual household income/i).fill('200000')
  await page.getByLabel(/Business sector/i).fill('dairy')
  await page.getByLabel(/Business stage/i).fill('new')
  await page.getByLabel(/Loan \/ financing requested/i).fill('150000')
  await page.getByRole('button', { name: /Next: documents/i }).click()
  const docs2 = page.locator('select[aria-label]')
  const n2 = await docs2.count()
  for (let i = 0; i < n2; i++) {
    await docs2.nth(i).selectOption('declared_available')
  }
  await page.getByRole('button', { name: /Next: review packet/i }).click()
  await page.getByRole('button', { name: /Next: consent/i }).click()
  await page.getByText(/Run as labelled simulation/i).click()
  await page.getByText(/I understand this is a labelled SIMULATION/i).click()
  await page.getByRole('button', { name: /Consent and route application/i }).click()
  await expect(page.getByText(/Simulation recorded/i).first()).toBeVisible()
  await expect(page.getByText(/LP-SIM-/i).first()).toBeVisible()
})
