import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { submitOnChannel } from './channels'
import { buildSubmissionPackage, freezeSnapshot } from './application'
import { containsForbiddenHeroCopy } from './trackingPresentation'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('demo-ready presentation lockdown', () => {
  it('guided and assisted copy never tells the citizen to submit themselves', async () => {
    const packet = {
      schemeId: 'pm-mudra-yojana',
      schemeName: 'MUDRA',
      channel: 'guided' as const,
      fields: { applicant_name: 'Lakshmi' },
      documents: [],
      officialApplicationUrl: 'https://www.udyamimitra.in/',
      generatedAt: '2026-09-18T00:00:00.000Z',
    }
    const guided = await submitOnChannel('guided', packet, { simulate: false, config: { randomId: () => 'G1' } })
    const assisted = await submitOnChannel('assisted', packet, { simulate: false, config: { randomId: () => 'A1' } })
    for (const result of [guided, assisted]) {
      expect(result.filedWithGovernment).toBe(false)
      expect(containsForbiddenHeroCopy(result.honestLabel)).toBe(false)
      expect(containsForbiddenHeroCopy(result.detail)).toBe(false)
      expect(containsForbiddenHeroCopy(result.nextSteps.join(' '))).toBe(false)
      expect(result.officialPortalUrl).toMatch(/^https:\/\//)
    }
  })

  it('keeps packet SHA-256 and approval digest as different objects in the handoff note', async () => {
    const snapshot = await freezeSnapshot(
      {
        applicationId: 'LP-APP-0123456789ABCDEF',
        schemeId: 'nsfdc-term-loan',
        schemeName: 'NSFDC Term Loan',
        channel: 'guided',
        conversation: null,
        fields: {},
        documents: [],
        consentText: 'ok',
        simulate: false,
        officialApplicationUrl: 'https://nsfdc.nic.in/',
      },
      '2026-09-18T00:00:00.000Z',
    )
    const pkg = buildSubmissionPackage({
      applicationId: 'LP-APP-0123456789ABCDEF',
      filedWithGovernment: false,
      snapshot,
    })
    expect(containsForbiddenHeroCopy(pkg.handoff.note)).toBe(false)
    expect(pkg.handoff.note.toLowerCase()).toMatch(/ready for review/)
    expect(pkg.snapshotHash.startsWith('sha256:')).toBe(true)
  })

  it('ships demo:lan and friend-access documentation', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['demo:lan']).toBe('vite --host 0.0.0.0')
    const access = readFileSync(join(ROOT, 'docs/DEMO_ACCESS.md'), 'utf8')
    const script = readFileSync(join(ROOT, 'docs/DEMO_SCRIPT.md'), 'utf8')
    expect(access).toMatch(/npm run demo:lan/)
    expect(access).toMatch(/integration\/final-lokpulse/)
    expect(access).toMatch(/do not share/i)
    expect(script).toMatch(/small dairy business in Kerala/)
    expect(script).toMatch(/LP-APP-/)
  })
})

describe('runtime localhost audit', () => {
  it('does not hardcode loopback hosts in presentation runtime except optional local Ollama', () => {
    const allowed = new Set(['src/assistant/aiConfig.ts', 'src/assistant/ai/ollamaProvider.ts'])
    const files: string[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue
        files.push(full)
      }
    }
    walk(join(ROOT, 'src'))

    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      if (rel.startsWith('src/backend/')) continue
      const text = readFileSync(file, 'utf8')
      if (!/\b127\.0\.0\.1\b|\blocalhost\b/.test(text)) continue
      if (allowed.has(rel)) continue
      offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
