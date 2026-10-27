import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVenueStats } from '../scripts/lib/venue-stats.mjs'
import { STATE_NAMES } from '../scripts/lib/states.mjs'

const venues = [
  { st: 'FL', city: 'Miami' },
  { st: 'FL', city: 'Miami' },
  { st: 'FL', city: 'Tampa' },
  { st: 'TX', city: 'Austin' },
  { st: 'TX', city: 'Austin' },
  { st: 'CA', city: 'Los Angeles' },
]
const population = { FL: 1000000, TX: 2000000 }

test('totals count venues, distinct (city, st) pairs and states', () => {
  const s = buildVenueStats(venues, population, '2026-10-27')
  assert.equal(s.generated, '2026-10-27')
  assert.equal(s.totals.venues, 6)
  assert.equal(s.totals.cities, 4)
  assert.equal(s.totals.states, 3)
  assert.deepEqual(s.totals.lead, { st: 'FL', share: 0.5 })
})

test('byState sorted by venues desc with names and per100k', () => {
  const s = buildVenueStats(venues, population, '2026-10-27')
  assert.deepEqual(s.byState.map((r) => r.st), ['FL', 'TX', 'CA'])
  assert.deepEqual(s.byState[0], { st: 'FL', name: 'Florida', venues: 3, cities: 2, per100k: 0.3 })
  assert.equal(s.byState[1].per100k, 0.1)
  assert.equal(s.byState[2].per100k, null)
})

test('topCities ranks by venues desc then city name', () => {
  const s = buildVenueStats(venues, population, '2026-10-27')
  assert.deepEqual(s.topCities[0], { city: 'Austin', st: 'TX', venues: 2 })
  assert.deepEqual(s.topCities[1], { city: 'Miami', st: 'FL', venues: 2 })
  assert.equal(s.topCities.length, 4)
})

test('topCities is capped at 10', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ st: 'FL', city: `C${String(i).padStart(2, '0')}` }))
  assert.equal(buildVenueStats(many, {}, 'x').topCities.length, 10)
})

test('stateCities lists cities per state sorted desc', () => {
  const s = buildVenueStats(venues, population, '2026-10-27')
  assert.deepEqual(s.stateCities.FL, [{ city: 'Miami', venues: 2 }, { city: 'Tampa', venues: 1 }])
})

test('rows with missing city or state are skipped without bogus keys', () => {
  const dirty = [...venues, { st: 'FL', city: null }, { st: '', city: 'Nowhere' }, { st: null, city: 'Void' }, { st: undefined, city: undefined }]
  const s = buildVenueStats(dirty, population, '2026-10-27')
  assert.equal(s.totals.venues, 6)
  assert.equal(s.totals.cities, 4)
  assert.equal(s.totals.states, 3)
  for (const bad of ['null', 'undefined', '']) {
    assert.ok(!(bad in s.stateCities), `unexpected key ${JSON.stringify(bad)}`)
    assert.ok(!s.byState.some((r) => r.st === bad))
  }
  assert.ok(!s.stateCities.FL.some((c) => c.city === null || c.city === 'null'))
})

test('STATE_NAMES covers every state code in the venue data', () => {
  for (const code of ['AZ', 'CA', 'CO', 'FL', 'MD', 'ME', 'MI', 'MO', 'NC', 'OH', 'OR', 'PA', 'SC', 'TX', 'WA', 'WI']) {
    assert.equal(typeof STATE_NAMES[code], 'string', code)
  }
})
