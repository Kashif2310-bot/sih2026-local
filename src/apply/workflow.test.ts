import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, type UserProfile } from '../assistant/types'
import { submitOnChannel } from './channels'
import { mapProfileToFields, missingRequiredFields } from './mapping'
import { getSchemeApplicationSpec } from './catalog'
import { prepareApplication, submitApplication } from './workflow'

const POULTRY: UserProfile = {
  rawNotes: [],
  age: 24,
  areaType: 'rural',
  state: 'Karnataka',
  socialCategory: 'sc',
  gender: 'female',
  annualIncome: 200_000,
  businessSector: 'poultry',
  businessStage: 'new',
  businessStatus: 'idea',
  investmentRequired: 300_000,
  ownContribution: 30_000,
}

function completeOverrides(): Record<string, string | number | boolean> {
  return {
    applicant_name: 'Lakshmi S',
    mobile: '9876543210',
  }
}

function declareAllDocs(schemeId: string) {
  const spec = getSchemeApplicationSpec(schemeId)
  const declarations: Record<string, 'declared_available'> = {}
  for (const d of spec.documents) declarations[d.key] = 'declared_available'
  return declarations
}

describe('field mapping', () => {
  it('maps citizen profile onto the scheme schema and lists remaining gaps', () => {
    const spec = getSchemeApplicationSpec('nsfdc-term-loan')
    const mapped = mapProfileToFields(spec.fields, POULTRY)
    expect(mapped.find((f) => f.key === 'state')?.value).toBe('Karnataka')
    expect(mapped.find((f) => f.key === 'loan_amount_requested')?.value).toBe(270_000)
    expect(mapped.find((f) => f.key === 'loan_amount_requested')?.source).toBe('derived')
    const missing = missingRequiredFields(mapped)
    expect(missing.map((f) => f.key)).toEqual(expect.arrayContaining(['applicant_name', 'mobile']))
    expect(missing.map((f) => f.key)).not.toContain('state')
  })
})

describe('prepareApplication workflow', () => {
  it('blocks packet generation until required fields and documents are present', () => {
    const blocked = prepareApplication({ schemeId: 'pmegp', profile: POULTRY })
    expect(blocked.canPreparePacket).toBe(false)
    expect(blocked.packet).toBeNull()
    expect(blocked.completedSteps).toContain('validation')
    expect(blocked.completedSteps).not.toContain('generated_application')
    expect(blocked.issues.some((i) => i.code === 'missing_field')).toBe(true)
  })

  it('generates a packet once gaps are filled — same steps regardless of channel', () => {
    const guided = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
      channel: 'guided',
    })
    const assisted = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
      channel: 'assisted',
    })
    expect(guided.canPreparePacket).toBe(true)
    expect(assisted.canPreparePacket).toBe(true)
    expect(guided.completedSteps).toEqual(assisted.completedSteps)
    expect(guided.packet?.fields.applicant_name).toBe('Lakshmi S')
    expect(guided.packet?.fields.mobile).toBe('9876543210')
  })
})

describe('submitApplication — honesty contract', () => {
  it('refuses to submit without explicit consent', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
    })
    const result = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: false,
      simulate: false,
      config: { randomId: () => 'TEST' },
    })
    expect(result.outcome).toBe('consent_required')
    expect(result.filedWithGovernment).toBe(false)
    expect(result.honestLabel).toMatch(/consent/i)
  })

  it('guided channel never claims a government filing', async () => {
    const prepared = prepareApplication({
      schemeId: 'pmegp',
      profile: { ...POULTRY, businessSector: 'retail', education: 'Class 10 pass' },
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pmegp'),
      channel: 'guided',
    })
    const result = await submitApplication({
      prepared,
      channel: 'guided',
      consentAccepted: true,
      simulate: false,
      config: { randomId: () => 'GUIDED1' },
    })
    expect(result.outcome).toBe('guided_packet_ready')
    expect(result.filedWithGovernment).toBe(false)
    expect(result.governmentApplicationId).toBeUndefined()
    expect(result.honestLabel).not.toMatch(/submitted successfully/i)
    expect(result.trackingId).toMatch(/^LP-GUIDED-/)
    expect(result.officialPortalUrl).toMatch(/^https:\/\//)
    expect(result.honestLabel).toMatch(/application package prepared/i)
    expect(result.nextSteps.join(' ')).not.toMatch(/submit there yourself|does not submit the form/i)
  })

  it('assisted channel never claims a government filing', async () => {
    const prepared = prepareApplication({
      schemeId: 'nsfdc-term-loan',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('nsfdc-term-loan'),
      channel: 'assisted',
    })
    const result = await submitApplication({
      prepared,
      channel: 'assisted',
      consentAccepted: true,
      simulate: false,
      config: { randomId: () => 'ASSIST1' },
    })
    expect(result.outcome).toBe('assisted_packet_ready')
    expect(result.filedWithGovernment).toBe(false)
    expect(result.honestLabel).toMatch(/application package prepared/i)
    expect(result.filedWithGovernment).toBe(false)
  })

  it('government_api without config fails honestly — no fake success', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
      channel: 'government_api',
    })
    const result = await submitApplication({
      prepared,
      channel: 'government_api',
      consentAccepted: true,
      simulate: false,
      config: { governmentApiUrl: '', randomId: () => 'API1' },
    })
    expect(result.outcome).toBe('government_api_unavailable')
    expect(result.filedWithGovernment).toBe(false)
    expect(result.honestLabel).not.toMatch(/submitted successfully/i)
    expect(result.detail).toMatch(/not connected/i)
  })

  it('simulation is labelled as simulation and never filedWithGovernment', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
    })
    const result = await submitApplication({
      prepared,
      channel: 'government_api',
      consentAccepted: true,
      simulate: true,
      config: {
        governmentApiUrl: 'https://example.invalid/apply',
        randomId: () => 'SIM1',
        transport: {
          postJson: async () => {
            throw new Error('simulation must not call the API')
          },
        },
      },
    })
    expect(result.outcome).toBe('simulation_recorded')
    expect(result.simulation).toBe(true)
    expect(result.filedWithGovernment).toBe(false)
    expect(result.honestLabel).toMatch(/simulation/i)
    expect(result.consent.text).toMatch(/SIMULATION/i)
    expect(result.package).toBeUndefined()
  })

  it('government_api reports submitted_to_government only when the API returns an id', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
      channel: 'government_api',
    })
    const result = await submitApplication({
      prepared,
      channel: 'government_api',
      consentAccepted: true,
      simulate: false,
      config: {
        governmentApiUrl: 'https://gov.example/apply',
        randomId: () => 'REAL1',
        transport: {
          postJson: async () => ({ ok: true, status: 201, applicationId: 'GOV-9988' }),
        },
      },
    })
    expect(result.outcome).toBe('submitted_to_government')
    expect(result.filedWithGovernment).toBe(true)
    expect(result.governmentApplicationId).toBe('GOV-9988')
    expect(result.trackingId).toBe('GOV-9988')
    expect(result.applicationId).toMatch(/^LP-APP-/)
    expect(result.snapshot?.frozen).toBe(true)
    expect(result.package?.readyForApproval).toBe(true)
    expect(result.package?.handoff.nextOwner).toBe('jordan')
    expect(result.package?.filedWithGovernment).toBe(true)
  })

  it('government_api rejection is not reported as submitted', async () => {
    const prepared = prepareApplication({
      schemeId: 'pm-mudra-yojana',
      profile: POULTRY,
      fieldOverrides: completeOverrides(),
      documentDeclarations: declareAllDocs('pm-mudra-yojana'),
    })
    const result = await submitOnChannel('government_api', prepared.packet!, {
      simulate: false,
      config: {
        governmentApiUrl: 'https://gov.example/apply',
        randomId: () => 'REJ1',
        transport: {
          postJson: async () => ({ ok: false, status: 422, message: 'incomplete KYC' }),
        },
      },
    })
    expect(result.outcome).toBe('government_api_rejected')
    expect(result.filedWithGovernment).toBe(false)
  })
})

describe('empty profile', () => {
  it('does not invent mapped values', () => {
    const spec = getSchemeApplicationSpec('pmegp')
    const mapped = mapProfileToFields(spec.fields, EMPTY_PROFILE)
    expect(mapped.every((f) => f.value === undefined || f.source === 'empty')).toBe(true)
  })
})
