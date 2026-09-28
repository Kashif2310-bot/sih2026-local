import { test, expect, type Page } from '@playwright/test'
import {
  createVerifierPool,
  demoAuthorizedPool,
  evaluateApproval,
  makeSnapshot,
  openCase,
  signIds,
} from '../src/lib/approval/testKit'

async function stubFairWeather(page: Page) {
  await page.route('https://api.open-meteo.com/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        daily: {
          time: ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'],
          weathercode: [2, 2, 2, 2, 2, 2, 2],
          temperature_2m_max: [31, 31, 31, 31, 31, 31, 31],
          temperature_2m_min: [22, 22, 22, 22, 22, 22, 22],
          precipitation_sum: [1, 0, 0, 0, 0, 0, 0],
          precipitation_probability_max: [30, 20, 20, 20, 20, 20, 20],
        },
      },
    })
  })
}

async function fillScan(
  page: Page,
  opts: {
    name?: string
    gender?: string
    community?: string
    income?: string
    age?: string
    village?: string
    category?: string
    margin?: string
    demoMode?: boolean
  } = {},
) {
  await page.goto('/scan')
  if (opts.demoMode) {
    await page.getByRole('checkbox', { name: /Offline Demo Mode/i }).check()
  }
  await page.getByLabel('Full name').fill(opts.name ?? 'Lakshmi S.')
  if (opts.age) await page.getByRole('spinbutton', { name: 'Age' }).fill(opts.age)
  await page.getByLabel('Gender').selectOption(opts.gender ?? 'female')
  await page.getByLabel('Community').selectOption(opts.community ?? 'sc')
  if (opts.income) await page.getByLabel('Annual family income (₹)').fill(opts.income)
  await page.getByLabel('Village / Block').selectOption(opts.village ?? 'dinka-mandya')
  await page.getByLabel('Business category').selectOption(opts.category ?? 'dairy')
  await page.getByLabel('Available margin capital (₹)').fill(opts.margin ?? '100000')
  await page.getByRole('button', { name: 'Run hyperlocal scan' }).click()
  await expect(page).toHaveURL(/\/pulse/, { timeout: 60_000 })
}

async function openSanction(page: Page) {
  await page.getByRole('link', { name: 'Sanction' }).first().click()
  await expect(page).toHaveURL(/\/sanction/)
  await expect(page.getByRole('heading', { name: /Adaptive Multi-Sig Sanction/i })).toBeVisible()
}

test.describe('sanction approval — UI', () => {
  test('scan → finance → sanction: 3-of-5 quorum, duplicate blocked, simulated authorization', async ({
    page,
  }) => {
    await stubFairWeather(page)
    await fillScan(page)
    await page.getByRole('link', { name: 'Open feasibility report' }).click()
    await expect(page).toHaveURL(/\/report/)
    await page.getByRole('link', { name: 'Structure NSFDC finance' }).click()
    await expect(page).toHaveURL(/\/finance/)
    await expect(page.getByText(/Term Loan Scheme/i).first()).toBeVisible()
    await page.getByRole('link', { name: /Adaptive Multi-Sig Sanction/i }).click()
    await expect(page).toHaveURL(/\/sanction/)

    await expect(page.getByText(/0\/3 of 5/)).toBeVisible()
    const signButtons = page.getByRole('button', { name: /Sign as verifier/i })
    await expect(signButtons).toHaveCount(5)

    await signButtons.nth(0).click()
    await expect(page.getByText(/Signed/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Sign as verifier/i })).toHaveCount(4)
    await expect(page.getByText(/Awaiting quorum/)).toBeVisible()

    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /Sign as verifier/i }).first().click()
    }
    await expect(page.getByRole('button', { name: /Simulate escrow release/i })).toBeVisible()
    await page.getByRole('button', { name: /Simulate escrow release/i }).click()
    await expect(page.getByText(/Simulated release — no blockchain transaction/i)).toBeVisible()
    await expect(page.getByText(/Disbursement authorization digest/i)).toBeVisible()
    await expect(page.getByText(/application_opened/)).toBeVisible()
    await expect(page.getByText(/quorum_reached/)).toBeVisible()
    await expect(page.getByText(/disbursement_authorized/)).toBeVisible()
  })

  test('mentor-required: non-mentor signatures do not unlock; mentor role does', async ({ page }) => {
    await fillScan(page, {
      name: 'Ravi K.',
      gender: 'male',
      community: 'general',
      income: '900000',
      age: '60',
      category: 'textiles',
      margin: '5000',
      demoMode: true,
    })
    await openSanction(page)
    await expect(page.getByText(/0\/4 of 5/)).toBeVisible()
    await expect(page.getByText(/mentor role is required/i)).toBeVisible()

    const mentorCard = page.locator('div.glass').filter({ hasText: 'Block Mentor' })
    await expect(mentorCard).toBeVisible()

    for (const role of [
      'SCA District Officer',
      'Bank Channel Partner',
      'NSFDC State Nodal',
      'SHG Federation Lead',
    ]) {
      await page.locator('div.glass').filter({ hasText: role }).getByRole('button', { name: /Sign as verifier/i }).click()
    }
    await expect(page.getByText(/Awaiting quorum/)).toBeVisible()
    await mentorCard.getByRole('button', { name: /Sign as verifier/i }).click()
    await expect(page.getByRole('button', { name: /Simulate escrow release/i })).toBeVisible()
  })

  test('EN/KN UI parity on /sanction', async ({ page }) => {
    await stubFairWeather(page)
    await fillScan(page)
    await openSanction(page)
    await expect(page.getByText(/Demo \/ fixture identities/i).first()).toBeVisible()
    await page.getByRole('button', { name: 'ಕನ್ನಡ' }).click()
    await expect(page.getByText(/ಡೆಮೋ \/ ಫಿಕ್ಸ್ಚರ್ ಗುರುತುಗಳು/).first()).toBeVisible()
    await expect(page.getByText(/ನಿಯೋಜಿತ ಪರಿಶೀಲಕರು/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
  })

  test('existing routes remain functional after a scan', async ({ page }) => {
    await stubFairWeather(page)
    await fillScan(page)
    await expect(page.getByRole('heading', { name: /Live Opportunity Pulse/i })).toBeVisible()
    await page.getByRole('link', { name: 'Report' }).first().click()
    await expect(page.getByRole('heading', { name: /Hyperlocal Feasibility Report/i })).toBeVisible()
    await page.getByRole('link', { name: 'Finance' }).first().click()
    await expect(page.getByText(/Term Loan Scheme/i).first()).toBeVisible()
    await page.getByRole('link', { name: 'Export' }).first().click()
    await expect(page.getByRole('heading', { name: /NSFDC Feasibility/i })).toBeVisible()
    await page.getByRole('link', { name: 'Home' }).first().click()
    // `/` is the full-bleed Ishara homepage (no citizen nav); re-enter via its Entrepreneur card.
    await page.getByRole('link', { name: /^Entrepreneur/ }).click()
    await expect(page).toHaveURL(/\/scan$/)
    await page.getByRole('link', { name: 'Assistant' }).first().click()
    await expect(page.getByRole('heading', { name: /AI Government Scheme Assistant/i })).toBeVisible()
  })
})

test.describe('sanction approval — cryptographic invariants (node)', () => {
  test('valid 2-of-3 quorum', async () => {
    const verifiers = createVerifierPool()
    const pool = demoAuthorizedPool(verifiers)
    const snapshot = makeSnapshot(84)
    expect(snapshot.lokScore.quorumRequired).toBe(2)
    expect(snapshot.lokScore.quorumPool).toBe(3)
    const opened = openCase(snapshot, pool)
    expect(opened.allocation.allocatedReviewerIds).toHaveLength(3)
    const sigs = await signIds(verifiers, opened.attestation, opened.allocation.allocatedReviewerIds.slice(0, 2))
    expect(evaluateApproval({ snapshot, ...opened, pool, signatures: sigs }).ok).toBe(true)
  })

  test('outsider signer blocked', async () => {
    const verifiers = createVerifierPool()
    const pool = demoAuthorizedPool(verifiers)
    const snapshot = makeSnapshot(84)
    const opened = openCase(snapshot, pool)
    const outside = verifiers.find((v) => !opened.allocation.allocatedReviewerIds.includes(v.id))!
    const sigs = await signIds(verifiers, opened.attestation, [
      opened.allocation.allocatedReviewerIds[0],
      outside.id,
    ])
    const result = evaluateApproval({ snapshot, ...opened, pool, signatures: sigs })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('outside the allocated set'))).toBe(true)
  })

  test('duplicate signer blocked', async () => {
    const verifiers = createVerifierPool()
    const pool = demoAuthorizedPool(verifiers)
    const snapshot = makeSnapshot(84)
    const opened = openCase(snapshot, pool)
    const one = await signIds(verifiers, opened.attestation, [opened.allocation.allocatedReviewerIds[0]])
    const result = evaluateApproval({
      snapshot,
      ...opened,
      pool,
      signatures: [one[0], { ...one[0], signedAt: one[0].signedAt + 1 }],
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('duplicate signer'))).toBe(true)
  })

  test('tampered application blocked', async () => {
    const verifiers = createVerifierPool()
    const pool = demoAuthorizedPool(verifiers)
    const snapshot = makeSnapshot(84)
    const opened = openCase(snapshot, pool)
    const sigs = await signIds(verifiers, opened.attestation, opened.allocation.allocatedReviewerIds.slice(0, 2))
    const result = evaluateApproval({
      snapshot: { ...snapshot, loanAmount: 1 },
      ...opened,
      pool,
      signatures: sigs,
    })
    expect(result.ok).toBe(false)
  })

  test('tampered quorum blocked', async () => {
    const verifiers = createVerifierPool()
    const pool = demoAuthorizedPool(verifiers)
    const snapshot = makeSnapshot(84)
    const opened = openCase(snapshot, pool)
    const sigs = await signIds(verifiers, opened.attestation, opened.allocation.allocatedReviewerIds.slice(0, 2))
    const result = evaluateApproval({
      snapshot,
      ...opened,
      policy: { ...opened.policy, quorumRequired: 4 },
      pool,
      signatures: sigs,
    })
    expect(result.ok).toBe(false)
  })
})
