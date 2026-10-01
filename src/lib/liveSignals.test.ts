import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './assessmentSnapshot'
import { collectFailedSources, dataStatusFromFailures } from './liveSignals'
import type { ResolvedLocation } from './resolveLocation'
import type { WeatherSignal } from './lokScore'

const loc = (over: Partial<ResolvedLocation> = {}): ResolvedLocation =>
  ({
    id: 'x',
    name: 'Nashik',
    nameKn: 'Nashik',
    district: 'Nashik',
    districtKn: 'Nashik',
    block: 'Nashik',
    lat: 20,
    lng: 73,
    population: null,
    households: null,
    nearbyMandi: '',
    competitorDensity: {
      dairy: 0.5,
      retail: 0.5,
      food: 0.5,
      textiles: 0.5,
      poultry: 0.5,
      agri_processing: 0.5,
    },
    purchasingPowerIndex: null,
    milkCoopPresence: false,
    notes: '',
    notesKn: '',
    provenance: 'live_lookup',
    provenanceLabelEn: '',
    provenanceLabelKn: '',
    competitors: [],
    competitorQueryOk: true,
    geocodeOk: true,
    radiusKm: 7,
    hasCuratedSignals: false,
    ...over,
  }) as ResolvedLocation

const weather = (source: WeatherSignal['source']): WeatherSignal => ({
  tempMax: 30,
  tempMin: 20,
  precipProb: 10,
  precipMm: 0,
  code: 0,
  summary: 'ok',
  summaryKn: 'ok',
  source,
})

describe('live signal completeness', () => {
  it('is complete when live sources succeed', () => {
    const failed = collectFailedSources(loc(), weather('live'), false)
    expect(failed).toEqual([])
    expect(dataStatusFromFailures(failed)).toBe('complete')
  })

  it('marks overpass/weather/geocoding failures as incomplete', () => {
    const failed = collectFailedSources(
      loc({ competitorQueryOk: false, geocodeOk: false }),
      weather('unavailable'),
      false,
    )
    expect(failed).toEqual(['geocoding', 'overpass', 'weather'])
    expect(dataStatusFromFailures(failed)).toBe('incomplete')
  })

  it('names Google Places, not Overpass, when the competitor lookup that failed was Google Places', () => {
    expect(collectFailedSources(loc({ competitorQueryOk: false, competitorSource: 'google_places' }), weather('live'), false)).toEqual([
      'google_places',
    ])
    expect(collectFailedSources(loc({ competitorQueryOk: false, competitorSource: 'overpass' }), weather('live'), false)).toEqual([
      'overpass',
    ])
  })

  it('does not treat demo-skipped weather as a failure', () => {
    const failed = collectFailedSources(loc(), weather('unavailable'), true)
    expect(failed).toEqual([])
  })
})

describe('APP_VERSION', () => {
  it('is not the placeholder 0.0.0', () => {
    expect(APP_VERSION).not.toBe('0.0.0')
    expect(APP_VERSION.length).toBeGreaterThan(0)
  })
})
