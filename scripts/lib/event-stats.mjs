// Aggregate weekly events by weekday, night type and state. Output holds
// aggregates only: no event titles and no place ids.
import { STATE_NAMES } from './states.mjs'
import { classify, LISTING } from './event-types.mjs'

const clean = (s) => (typeof s === 'string' ? s.trim() : '')
const week = () => [0, 0, 0, 0, 0, 0, 0]

export function buildEventStats(events, venueIndex, rules, asOf) {
  const byWeekday = week()
  const typeCounts = new Map(rules.types.map((t) => [t, 0]))
  const typeByWeekday = Object.fromEntries(rules.types.map((t) => [t, week()]))
  const states = new Map() // st -> { events, bars: Set }
  const bars = new Set()
  const cities = new Set()
  const excluded = { listings: 0, outsideMap: 0, invalid: 0 }
  let total = 0

  for (const e of events ?? []) {
    const dow = e?.day_of_week
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      excluded.invalid++
      continue
    }
    const venue = venueIndex.get(e.place_id)
    const st = clean(venue?.st)
    if (!st) {
      excluded.outsideMap++
      continue
    }
    const type = classify(e.title, rules)
    if (type === LISTING) {
      excluded.listings++
      continue
    }
    if (!typeCounts.has(type)) throw new Error(`event-stats: classifier returned undeclared type "${type}"`)

    total++
    byWeekday[dow]++
    typeCounts.set(type, typeCounts.get(type) + 1)
    typeByWeekday[type][dow]++
    bars.add(e.place_id)
    const city = clean(venue.city)
    if (city) cities.add(`${city}|${st}`)
    if (!states.has(st)) states.set(st, { events: 0, bars: new Set() })
    const s = states.get(st)
    s.events++
    s.bars.add(e.place_id)
  }

  const byState = [...states].map(([st, s]) => ({
    st,
    name: STATE_NAMES[st] ?? st,
    events: s.events,
    bars: s.bars.size,
  }))
  byState.sort((a, b) => b.events - a.events || a.st.localeCompare(b.st))

  return {
    generated: asOf,
    totals: { events: total, bars: bars.size, states: byState.length, cities: cities.size },
    byWeekday,
    byType: rules.types.map((type) => ({ type, events: typeCounts.get(type) })),
    byState,
    typeByWeekday,
    excluded,
  }
}
