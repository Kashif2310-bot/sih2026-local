import { describe, expect, it } from 'vitest'
import { SEED_JOBS, prepareJobs, wageOf, type JobFilters } from './model'

const baseFilters = (): JobFilters => ({
  skills: [],
  rail: 'all',
  villageId: 'dinka-mandya',
  sort: 'pay',
  womenOnly: false,
})

describe('wageOf', () => {
  it('leaves the full wage with the worker on a direct job, and counts the agent cut as protected', () => {
    const paneer = SEED_JOBS.find((j) => j.id === 'paneer-dinka')!
    const pay = wageOf(paneer)
    expect(pay.gross).toBe(650 * 26)
    expect(pay.costs).toBe(0)
    expect(pay.inHand).toBe(pay.gross)
    expect(pay.protectedRupees).toBe(pay.agentKeeps)
    expect(pay.agentHand).toBe(pay.inHand - pay.agentKeeps)
    expect(pay.inHand).toBeGreaterThan(pay.agentHand)
  })

  it('shows a city daily rate that looks higher but leaves less in hand than work at home', () => {
    const home = wageOf(SEED_JOBS.find((j) => j.id === 'paneer-dinka')!)
    const city = wageOf(SEED_JOBS.find((j) => j.id === 'city-tiff')!)
    expect(city.gross).toBeGreaterThan(home.gross)
    expect(city.inHand).toBeLessThan(home.inHand)
    expect(city.realDaily).toBeLessThan(950)
    expect(city.bus + city.room + city.food).toBe(city.costs)
  })

  it('keeps a city wage whole when stay and food are already included', () => {
    const mysuru = wageOf(SEED_JOBS.find((j) => j.id === 'city-mason')!)
    expect(mysuru.room).toBe(0)
    expect(mysuru.food).toBe(0)
    expect(mysuru.costs).toBe(190 * 2)
    expect(mysuru.inHand).toBe(mysuru.gross - mysuru.costs)
    expect(mysuru.realDaily).toBeGreaterThan(800)
  })

  it('puts the agent cut, the joining fee, and the auto inside an agent listing', () => {
    const agent = wageOf(SEED_JOBS.find((j) => j.id === 'agent-mandya')!)
    expect(agent.protectedRupees).toBe(0)
    expect(agent.inHand).toBe(agent.agentHand)
    expect(agent.joiningFee).toBe(3000)
    expect(agent.agentCut).toBe(Math.round(700 * 26 * 0.3))
    expect(agent.localTravel).toBe(14 * 4 * 26)
    expect(agent.realDaily).toBeLessThan(400)
    expect(agent.belowUsual).toBe(true)
  })

  it('separates the auto fare from an agent cut on a direct job outside the village', () => {
    const loading = wageOf(SEED_JOBS.find((j) => j.id === 'load-kunigal')!)
    expect(loading.localTravel).toBe(9 * 4 * 26)
    expect(loading.inHand).toBe(loading.gross - loading.localTravel)
    expect(loading.protectedRupees).toBeGreaterThan(0)
  })
})

describe('prepareJobs', () => {
  it('keeps near-home results inside 30 km of the worker’s village', () => {
    const rows = prepareJobs(SEED_JOBS, { ...baseFilters(), rail: 'near' })
    expect(rows.map((r) => r.job.id).sort()).toEqual(['agent-mandya', 'milk-dinka', 'paneer-dinka'])
    expect(rows.every((r) => r.km <= 30)).toBe(true)
  })

  it('lists only city workplaces on the city rail', () => {
    const rows = prepareJobs(SEED_JOBS, { ...baseFilters(), rail: 'city' })
    expect(rows.every((r) => r.job.workplace === 'city')).toBe(true)
    expect(rows.map((r) => r.job.id).sort()).toEqual(['city-mason', 'city-tiff'])
  })

  it('drops jobs that do not match the skills the worker marked', () => {
    const rows = prepareJobs(SEED_JOBS, { ...baseFilters(), skills: ['stitching'] })
    expect(rows.map((r) => r.job.id)).toEqual(['stitch-sulebhavi'])
  })

  it('sorts by money in hand, with the agent listing below direct pay', () => {
    const rows = prepareJobs(SEED_JOBS, { ...baseFilters(), rail: 'near', sort: 'pay' })
    const hands = rows.map((r) => r.pay.inHand)
    expect([...hands].sort((a, b) => b - a)).toEqual(hands)
    expect(rows[rows.length - 1].job.channel).toBe('agent')
  })

  it('hides jobs that are not open to women when that filter is on', () => {
    const rows = prepareJobs(SEED_JOBS, { ...baseFilters(), womenOnly: true })
    expect(rows.every((r) => r.job.womenWelcome)).toBe(true)
    expect(rows.some((r) => r.job.id === 'agent-mandya')).toBe(false)
    expect(rows.some((r) => r.job.id === 'city-mason')).toBe(false)
  })
})
