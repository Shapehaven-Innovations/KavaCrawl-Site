// Cross-checks the committed dashboard data: mapdata/venue-stats.json and
// mapdata/events-stats.json must agree with mapdata/venues.json and with each other,
// and must never carry venue names, place ids or event titles.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const readText = (p) => readFileSync(here(p), 'utf8')

const venues = JSON.parse(readText('../mapdata/venues.json')).venues
const venueStatsText = readText('../mapdata/venue-stats.json')
const eventStatsText = readText('../mapdata/events-stats.json')
const venueStats = JSON.parse(venueStatsText)
const eventStats = JSON.parse(eventStatsText)
const statsFiles = [
  { file: 'venue-stats.json', text: venueStatsText, data: venueStats },
  { file: 'events-stats.json', text: eventStatsText, data: eventStats },
]

const trimmed = (s) => (typeof s === 'string' ? s.trim() : '')
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

// Every key name used anywhere in a JSON value.
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) for (const x of value) allKeys(x, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      allKeys(v, out)
    }
  }
  return out
}

test('venues.json holds a venue array', () => {
  assert.ok(Array.isArray(venues))
  assert.ok(venues.length > 0)
})

test('venue totals match venues.json', () => {
  assert.equal(venueStats.totals.venues, venues.length)
})

test('venue state count matches distinct non-empty st', () => {
  const states = new Set(venues.map((v) => trimmed(v.st)).filter(Boolean))
  assert.equal(venueStats.totals.states, states.size)
})

test('venue city count matches distinct (city, st) pairs', () => {
  const pairs = new Set(
    venues
      .filter((v) => trimmed(v.st) && trimmed(v.city))
      .map((v) => `${trimmed(v.city)}|${trimmed(v.st)}`),
  )
  assert.equal(venueStats.totals.cities, pairs.size)
})

test('venue byState rows add up to the venue total', () => {
  assert.equal(sum(venueStats.byState.map((r) => r.venues)), venueStats.totals.venues)
})

test('every events state is also a venue state', () => {
  const venueStates = new Set(venueStats.byState.map((r) => r.st))
  for (const r of eventStats.byState) {
    assert.ok(venueStates.has(r.st), `events state ${r.st} missing from venue-stats byState`)
  }
})

test('events cover no more states than venues', () => {
  assert.ok(eventStats.totals.states <= venueStats.totals.states)
})

test('events total equals weekday, type and state sums', () => {
  const total = eventStats.totals.events
  assert.equal(sum(eventStats.byWeekday), total, 'byWeekday sum')
  assert.equal(sum(eventStats.byType.map((r) => r.events)), total, 'byType sum')
  assert.equal(sum(eventStats.byState.map((r) => r.events)), total, 'byState sum')
})

test('stats files have no Unknown bucket and no Other key', () => {
  for (const { file, text, data } of statsFiles) {
    assert.ok(!text.includes('Unknown'), `${file} contains "Unknown"`)
    assert.ok(!allKeys(data).has('Other'), `${file} has a key named Other`)
  }
})

test('stats files carry no venue names or place ids', () => {
  for (const { file, text } of statsFiles) {
    for (const v of venues) {
      const name = trimmed(v.name)
      const id = trimmed(v.id ?? v.place_id)
      if (name) assert.ok(!text.includes(name), `${file} contains venue name ${JSON.stringify(name)}`)
      if (id) assert.ok(!text.includes(id), `${file} contains place id ${id}`)
    }
  }
})

test('stats files carry no event titles', () => {
  for (const { file, data } of statsFiles) {
    const keys = allKeys(data)
    assert.ok(!keys.has('title') && !keys.has('titles'), `${file} has a title key`)
  }
})
