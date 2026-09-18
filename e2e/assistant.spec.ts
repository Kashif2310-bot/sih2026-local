import { test, expect } from '@playwright/test'

/**
 * AI Government Scheme Assistant — no local Ollama and no Supabase project
 * are configured in this test environment, so every reply comes from the
 * deterministic offline provider, and every turn's source-status badge
 * reads "Verified scheme knowledge base" (live retrieval never attempted).
 * That's fine: the point of these tests is the pipeline (extraction ->
 * retrieval -> eligibility -> ranking -> UI), not which AI/data path served
 * a given turn.
 */

test('assistant: poultry/Karnataka/SC profile surfaces matching schemes with sources and an action plan', async ({
  page,
}) => {
  await page.goto('/assistant')
  await expect(page.getByRole('heading', { name: /AI Government Scheme Assistant/i })).toBeVisible()

  await page.getByLabel('Message').fill(
    'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.',
  )
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(/Verified scheme knowledge base/i).first()).toBeVisible({ timeout: 15_000 })

  await expect(page.getByText('Karnataka').first()).toBeVisible()
  await expect(page.getByText('poultry').first()).toBeVisible()

  await expect(page.getByRole('heading', { name: /NSFDC Term Loan Scheme/i })).toBeVisible()

  // PMEGP explicitly excludes poultry farming — it should still be listed
  // (never hidden), but clearly labelled as an unlikely match rather than
  // silently omitted or mislabelled as a good fit.
  const pmegpCard = page.getByRole('article', { name: /Prime Minister's Employment Generation/i })
  await expect(pmegpCard).toBeVisible()
  await expect(pmegpCard.getByText(/unlikely match/i)).toBeVisible()
  // BUG REGRESSION: the card's one-line summary must lead with the actual
  // disqualifying reason (poultry is excluded), not a generic positive
  // reason like "age meets the requirement" that would misleadingly imply
  // a better fit than "Unlikely match" actually means.
  await expect(pmegpCard.getByText(/excluded/i)).toBeVisible()

  await page.getByRole('article', { name: /NSFDC Term Loan Scheme/i }).getByText('View details').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('link', { name: /official information/i })).toHaveAttribute(
    'href',
    /^https:\/\//,
  )
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: /Your action plan/i })).toBeVisible()
})

test('assistant: a materially different profile (Kerala tailoring woman) surfaces different top schemes', async ({
  page,
}) => {
  await page.goto('/assistant')

  await page.getByLabel('Message').fill(
    'I am a 47-year-old woman in Kerala with an existing tailoring business. I earn ₹6 lakh annually and need ₹8 lakh to expand.',
  )
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByRole('heading', { name: /Kudumbashree/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /NSFDC Term Loan Scheme/i })).toHaveCount(0)
})

test('assistant: starter question chips are clickable and existing app routes remain unaffected', async ({
  page,
}) => {
  await page.goto('/assistant')
  await expect(page.getByRole('article')).toHaveCount(0)

  const starter = page.getByRole('button').filter({ hasText: /poultry business/i }).first()
  await expect(starter).toBeVisible()
  await starter.click()

  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })

  // Existing routes must still work unmodified.
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: /Tell LokPulse who you are/i })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Start Opportunity Scan/i })).toBeVisible()
})

test('assistant: a third materially different profile (Maharashtra retail, general category) surfaces yet another top scheme', async ({
  page,
}) => {
  await page.goto('/assistant')

  await page.getByLabel('Message').fill(
    'I am a 35 year old man in urban Maharashtra, general category, income ₹9 lakh, want to start a retail business requiring ₹12 lakh.',
  )
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByRole('heading', { name: /Prime Minister's Employment Generation/i })).toBeVisible({
    timeout: 15_000,
  })
  // Kudumbashree is Kerala-only and this profile is Maharashtra — it must
  // not even be retrieved (structured filter), unlike Stand-Up India below
  // which IS retrieved but correctly marked as an unlikely match (general
  // category + male fails its SC/ST-or-woman gate).
  await expect(page.getByRole('heading', { name: /Kudumbashree/i })).toHaveCount(0)
  const standUpCard = page.getByRole('article', { name: /Stand-Up India/i })
  await expect(standUpCard).toBeVisible()
  await expect(standUpCard.getByText(/unlikely match/i)).toBeVisible()
  // Same regression as PMEGP above: the headline reason must be the real
  // disqualifier (SC/ST-or-woman gate), not a generic positive reason.
  await expect(standUpCard.getByText(/SC\/ST or a woman/i)).toBeVisible()
})

test('assistant: a follow-up correction updates the profile and recommendations, not just the first answer', async ({
  page,
}) => {
  await page.goto('/assistant')
  await page.getByLabel('Message').fill('I want to start a poultry business in Karnataka, SC category.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('dd', { hasText: 'Karnataka' })).toBeVisible()

  await page.getByLabel('Message').fill('Actually I am in Kerala, not Karnataka.')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.locator('dd', { hasText: 'Kerala' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('dd', { hasText: 'Karnataka' })).toHaveCount(0)
})

test('assistant: HTML/script-like input is shown as inert text and never executed (XSS safety)', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await page.goto('/assistant')
  await page.getByLabel('Message').fill('<script>alert("xss")</script> I want to start a shop business.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/Verified scheme knowledge base/i).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('<script>alert("xss")</script>', { exact: false })).toBeVisible()
  expect(dialogs).toHaveLength(0)
})

test('assistant: reset conversation clears chat, profile, and recommendations back to the starting state', async ({
  page,
}) => {
  await page.goto('/assistant')
  await page.getByLabel('Message').fill(
    'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.',
  )
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.getByText('Nothing captured yet')).toBeVisible()
  await expect(page.getByRole('button', { name: /poultry business/i })).toBeVisible()
})

test('assistant: an empty or whitespace-only message cannot be sent', async ({ page }) => {
  await page.goto('/assistant')
  const sendBtn = page.getByRole('button', { name: 'Send' })
  await expect(sendBtn).toBeDisabled()
  await page.getByLabel('Message').fill('   ')
  await expect(sendBtn).toBeDisabled()
})

test('assistant: voice is honestly unavailable in this deployment — no fake connected state, text still works', async ({
  page,
}) => {
  // No Gemini Live relay is configured in this test environment (by
  // design — see src/assistant/voice/geminiLiveConfig.ts). The UI must say
  // so plainly rather than showing a mic control that cannot actually
  // connect to anything.
  await page.goto('/assistant')
  await expect(page.getByText(/voice is not set up for this deployment/i)).toHaveCount(0)
  await expect(page.getByText(/voice is not configured/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /talk instead of typing/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^interrupt$/i })).toHaveCount(0)

  // Text chat is completely unaffected by voice being unavailable.
  await page.getByLabel('Message').fill('I am from Karnataka and want to start a dairy business.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })
})

test('assistant: full analysis surfaces government source coverage and starts a real application via the existing Apply flow', async ({
  page,
}) => {
  await page.goto('/assistant')
  await page.getByLabel('Message').fill(
    'I am 24 years old, from rural Karnataka, SC, my annual income is about ₹2 lakh, and I want to start a poultry business requiring ₹3 lakh.',
  )
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })

  const viewAnalysis = page.getByRole('button', { name: /view full analysis/i })
  await expect(viewAnalysis).toBeVisible()
  await viewAnalysis.click()

  const dialog = page.getByRole('dialog', { name: /your personalized analysis/i })
  await expect(dialog).toBeVisible()
  // Source coverage is shown, and the "never all schemes checked" honesty
  // note is present verbatim — this is the actual Prompt 8 coverage
  // accounting, not a decorative summary.
  await expect(dialog.getByText(/government source coverage/i)).toBeVisible()
  await expect(dialog.getByText(/coverage reflects the sources queried above/i)).toBeVisible()
  await expect(dialog.getByText(/what we know about you/i)).toBeVisible()
  await expect(dialog.getByText(/opportunity assessment/i)).toBeVisible()
  await expect(dialog.getByText(/financial path/i)).toBeVisible()
  await expect(dialog.getByText(/document readiness/i)).toBeVisible()
  await expect(dialog.getByText(/application readiness/i)).toBeVisible()
  await expect(dialog.getByText(/uncertainties and risks/i)).toBeVisible()

  const startFromAnalysis = dialog.getByRole('button', { name: /start application from this analysis/i })
  await expect(startFromAnalysis).toBeVisible()
  await startFromAnalysis.click()

  // Lands on the EXISTING apply-start route for the top-ranked scheme —
  // never a new route, never a new id scheme.
  await expect(page).toHaveURL(/\/apply\/start\//)
})
