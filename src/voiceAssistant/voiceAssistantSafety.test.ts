import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..')
const HERE = join(ROOT, 'src', 'voiceAssistant')
const TEXT = /\.(ts|tsx|js|mjs|css|html|json|md|txt|map)$/

function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const read = (path: string) => readFileSync(path, 'utf8')
const rel = (path: string) => relative(ROOT, path).replace(/\\/g, '/')
const self = rel(import.meta.filename)

const voiceScripts = files(join(ROOT, 'scripts')).filter((path) => /voice-assistant-/.test(path))
const sourceFiles = [
  ...files(HERE),
  ...files(join(ROOT, 'public', 'assistant')),
  ...voiceScripts,
  join(ROOT, 'voice-assistant', 'index.html'),
].filter((path) => TEXT.test(path))
const browserSourceFiles = files(join(ROOT, 'src')).filter((path) => TEXT.test(path))
const distFiles = files(join(ROOT, 'dist')).filter((path) => TEXT.test(path))

const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{35}/
const GEMINI_KEY_ENV = ['VITE', 'GEMINI', 'API', 'KEY'].join('_')
const GEMINI_ENV = ['VITE', 'GEMINI'].join('_')

describe('no Gemini key reaches the browser', () => {
  it('browser source contains no hardcoded Google API key or VITE Gemini variable', () => {
    const hardcodedKeyOffenders = browserSourceFiles
      .filter((path) => rel(path) !== self)
      .filter((path) => !/\.test\.[cm]?[jt]sx?$/.test(path))
      .filter((path) => GOOGLE_KEY.test(read(path)))
    const geminiEnvOffenders = sourceFiles
      .filter((path) => rel(path) !== self)
      .filter((path) => read(path).includes(GEMINI_ENV))
    const offenders = [...hardcodedKeyOffenders, ...geminiEnvOffenders]
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('any built bundle contains no browser Gemini key variable', () => {
    const offenders = distFiles
      .filter((path) => {
        const text = read(path)
        return text.includes(GEMINI_KEY_ENV)
      })
      .map(rel)
    expect(offenders).toEqual([])
  })
})

describe('advisor character', () => {
  it('no male asset exists or is referenced by the voice assistant', () => {
    const assets = readdirSync(join(ROOT, 'public', 'assistant'))
    expect(assets.filter((name) => /character-|\.mp4$|\.webm$|\.jpe?g$/.test(name))).toEqual([])
    const offenders = sourceFiles
      .filter((path) => rel(path) !== self)
      .filter((path) => /character-idle|character-speaking|\.mp4\b/.test(read(path)))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the female advisor portrait and both mouth layers are the ones wired in', () => {
    const component = read(join(HERE, 'assistant', 'AssistantCharacter.tsx'))
    for (const asset of ['advisor-base.webp', 'advisor-mouth-mid.webp', 'advisor-mouth-open.webp']) {
      expect(component).toContain(`/assistant/${asset}`)
      expect(existsSync(join(ROOT, 'public', 'assistant', asset))).toBe(true)
    }
    expect(component).not.toMatch(/<video/)
  })
})

describe('wired to the prototype engine', () => {
  it('the advisor ranks with the prototype ranking and the runtime uses the advisor', () => {
    expect(read(join(HERE, 'assistant', 'live', 'liveRuntime.ts'))).toContain("from '../advisor/advisor'")
    expect(read(join(HERE, 'assistant', 'advisor', 'advisor.ts'))).toContain("from '../../../assistant/ranking'")
  })

  it('no stale import of the sandbox engine copy remains', () => {
    const offenders = sourceFiles
      .filter((path) => /\.(ts|tsx|mjs)$/.test(path) && rel(path) !== self)
      .filter((path) => /['"][./]*engine\/|sih2026-local|ishaara-assistant-ui-lab/.test(read(path)))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('is its own page entry and uses the exact Ishaara logo file', () => {
    expect(read(join(ROOT, 'voice-assistant', 'index.html'))).toContain('/src/voiceAssistant/main.tsx')
    expect(read(join(HERE, 'components', 'TopNav.tsx'))).toContain('/brand/ishara-logo-white.png')
    expect(existsSync(join(ROOT, 'public', 'brand', 'ishara-logo-white.png'))).toBe(true)
  })
})

describe('demo mode isolation', () => {
  it('the live runtime never imports demo code, and the demo is only created for ?mode=demo', () => {
    const live = files(join(HERE, 'assistant', 'live')).filter((path) => !path.endsWith('.test.ts'))
    for (const path of live) expect(read(path)).not.toMatch(/demoController|demoData/)
    const app = read(join(HERE, 'App.tsx'))
    expect(app).toMatch(/get\('mode'\) === 'demo'/)
    expect(app).toMatch(/isDemoMode \? new DemoController\(\) : null/)
    expect(app).toMatch(/isDemoMode \? null : createLiveVoiceRuntime\(\)/)
  })
})
