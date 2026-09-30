import { beforeEach, describe, expect, it } from 'vitest'
import { createPostedJob } from './model'
import { addInterest, emptyStore, loadStore, saveStore } from './storage'

describe('jobs storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a worker profile, an interest, and a posted opening', () => {
    const posted = createPostedJob({
      employer: 'Lakshmi S.',
      villageId: 'dinka-mandya',
      skill: 'paneer',
      dailyWage: 700,
      seats: 2,
      days: 26,
      workplace: 'village',
      city: '',
      busFare: 0,
      stayIncluded: false,
      foodIncluded: false,
      work: 'Extra paneer hands for the evening batch.',
      womenWelcome: true,
      crew: 1,
    })
    const store = addInterest(
      { ...emptyStore(), posted: [posted], profile: { name: 'Ravi', phone: '9845012345', villageId: 'dinka-mandya', skills: ['paneer'] } },
      {
        jobId: posted.id,
        employer: posted.employer,
        title: posted.title,
        dailyWage: posted.dailyWage,
        days: posted.days,
        inHand: 700 * 26,
        agentWouldKeep: 1000,
        channel: 'direct',
        name: 'Ravi',
        phone: '9845012345',
        villageId: 'dinka-mandya',
      },
    )
    saveStore(store)
    const loaded = loadStore()
    expect(loaded.profile.name).toBe('Ravi')
    expect(loaded.profile.skills).toEqual(['paneer'])
    expect(loaded.posted).toHaveLength(1)
    expect(loaded.posted[0].dailyWage).toBe(700)
    expect(loaded.posted[0].channel).toBe('direct')
    expect(loaded.interests).toHaveLength(1)
    expect(loaded.interests[0].inHand).toBe(18200)
    expect(loaded.interests[0].jobId).toBe(posted.id)
  })

  it('drops a corrupt store instead of throwing', () => {
    localStorage.setItem('ishara.jobs.v1', '{not json')
    expect(loadStore().profile.villageId).toBe('dinka-mandya')
    expect(loadStore().interests).toEqual([])
  })
})
