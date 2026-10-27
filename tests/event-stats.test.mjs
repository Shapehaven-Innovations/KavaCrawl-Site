import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadRules } from '../scripts/lib/event-types.mjs'
import { buildEventStats } from '../scripts/lib/event-stats.mjs'

const rules = loadRules(fileURLToPath(new URL('../scripts/event-rules.json', import.meta.url)))

const venueIndex = new Map([
  ['ChIJfixtureFL1', { st: 'FL', city: 'Miami' }],
  ['ChIJfixtureTX1', { st: 'TX', city: 'Austin' }],
])

const events = [
  { place_id: 'ChIJfixtureFL1', title: 'Trivia Night', day_of_week: 2 },
  { place_id: 'ChIJfixtureFL1', title: 'Music Bingo', day_of_week: 2 },
  { place_id: 'ChIJfixtureFL1', title: 'Ladies Night', day_of_week: 5 },
  { place_id: 'ChIJfixtureTX1', title: 'Karaoke Thursday', day_of_week: 4 },
  { place_id: 'ChIJfixtureTX1', title: null, day_of_week: 0 },
  { place_id: 'ChIJfixtureFL1', title: 'Weekly Schedule', day_of_week: 1 },
  { place_id: 'ChIJfixtureZZ9', title: 'DJ Night Downtown', day_of_week: 3 },
  { place_id: 'ChIJfixtureTX1', title: 'Pajama Movie Night Party', day_of_week: -1 },
]

const s = buildEventStats(events, venueIndex, rules, '2026-10-27')

test('generated and totals count only kept events', () => {
  assert.equal(s.generated, '2026-10-27')
  assert.deepEqual(s.totals, { events: 5, bars: 2, states: 2, cities: 2 })
})

test('byWeekday starts on Sunday', () => {
  assert.deepEqual(s.byWeekday, [1, 0, 2, 0, 1, 1, 0])
})

test('byType follows rules.types order and keeps zero counts', () => {
  assert.deepEqual(s.byType.map((t) => t.type), rules.types)
  const by = Object.fromEntries(s.byType.map((t) => [t.type, t.events]))
  assert.deepEqual(by, {
    Games: 1,
    Specials: 1,
    Community: 1,
    Trivia: 1,
    'Open mic': 0,
    Music: 0,
    Karaoke: 1,
    'Movie night': 0,
    Art: 0,
  })
})

test('typeByWeekday has a 7-slot array for every type', () => {
  assert.deepEqual(Object.keys(s.typeByWeekday), rules.types)
  for (const arr of Object.values(s.typeByWeekday)) assert.equal(arr.length, 7)
  assert.deepEqual(s.typeByWeekday.Trivia, [0, 0, 1, 0, 0, 0, 0])
  assert.deepEqual(s.typeByWeekday.Games, [0, 0, 1, 0, 0, 0, 0])
  assert.deepEqual(s.typeByWeekday.Specials, [0, 0, 0, 0, 0, 1, 0])
  assert.deepEqual(s.typeByWeekday.Karaoke, [0, 0, 0, 0, 1, 0, 0])
  assert.deepEqual(s.typeByWeekday.Community, [1, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(s.typeByWeekday.Music, [0, 0, 0, 0, 0, 0, 0])
})

test('byState sorted by events desc with names and distinct bars', () => {
  assert.deepEqual(s.byState, [
    { st: 'FL', name: 'Florida', events: 3, bars: 1 },
    { st: 'TX', name: 'Texas', events: 2, bars: 1 },
  ])
})

test('byState ties break on state code', () => {
  const r = buildEventStats(
    [
      { place_id: 'ChIJfixtureTX1', title: 'Trivia', day_of_week: 1 },
      { place_id: 'ChIJfixtureFL1', title: 'Trivia', day_of_week: 1 },
    ],
    venueIndex,
    rules,
    '2026-10-27',
  )
  assert.deepEqual(r.byState.map((x) => x.st), ['FL', 'TX'])
})

test('excluded counts listings, off-map and invalid weekdays separately', () => {
  assert.deepEqual(s.excluded, { duplicates: 0, listings: 1, outsideMap: 1, invalid: 1 })
})

test('output holds no titles and no place ids', () => {
  const json = JSON.stringify(s)
  for (const e of events) {
    if (e.title) assert.ok(!json.includes(e.title), `title leaked: ${e.title}`)
    assert.ok(!json.includes(e.place_id), `place id leaked: ${e.place_id}`)
  }
  assert.ok(!json.includes('ChIJ'))
})

test('no Unknown or Other keys', () => {
  for (const bad of ['Unknown', 'Other']) {
    assert.ok(!s.byType.some((t) => t.type === bad))
    assert.ok(!s.byState.some((x) => x.st === bad || x.name === bad))
    assert.ok(!(bad in s.typeByWeekday))
  }
})

const dupEvents = [
  { place_id: 'ChIJfixtureFL1', title: 'Karaoke Night', day_of_week: 3 },
  { place_id: 'ChIJfixtureFL1', title: 'Karaoke Night', day_of_week: 3 },
  { place_id: 'ChIJfixtureFL1', title: '  karaoke NIGHT ', day_of_week: 3 },
  { place_id: 'ChIJfixtureFL1', title: 'Karaoke Night', day_of_week: 4 },
  { place_id: 'ChIJfixtureTX1', title: 'Karaoke Night', day_of_week: 3 },
]
const d = buildEventStats(dupEvents, venueIndex, rules, '2026-10-27')

test('duplicate rows (same place, title ignoring case and spaces, weekday) collapse to one', () => {
  assert.equal(d.totals.events, 3)
  assert.deepEqual(d.byWeekday, [0, 0, 0, 2, 1, 0, 0])
  assert.deepEqual(d.typeByWeekday.Karaoke, [0, 0, 0, 2, 1, 0, 0])
  assert.deepEqual(d.byState, [
    { st: 'FL', name: 'Florida', events: 2, bars: 1 },
    { st: 'TX', name: 'Texas', events: 1, bars: 1 },
  ])
})

test('excluded.duplicates counts the removed rows', () => {
  assert.equal(d.excluded.duplicates, 2)
  assert.equal(typeof d.excluded.duplicates, 'number')
})

test('dedupe output holds no titles and no place ids', () => {
  const json = JSON.stringify(d).toLowerCase()
  assert.ok(!json.includes('karaoke night'))
  assert.ok(!json.includes('chij'))
})
