import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, shouldProbeLocalOllama } from './aiConfig'

describe('optional local Ollama probe', () => {
  it('still probes on localhost development', () => {
    expect(shouldProbeLocalOllama('localhost', 'http://localhost:11434')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
  })

  it('does not send LAN browsers to their own loopback Ollama', () => {
    expect(shouldProbeLocalOllama('192.168.1.24', 'http://localhost:11434')).toBe(false)
    expect(shouldProbeLocalOllama('10.0.0.8', 'http://127.0.0.1:11434')).toBe(false)
  })
})
