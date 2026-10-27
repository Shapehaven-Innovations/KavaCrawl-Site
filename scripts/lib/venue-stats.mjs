// Aggregate venue counts by state and city. Output holds aggregates only:
// no venue names or ids.
import { STATE_NAMES } from './states.mjs'

const round = (x, places) => {
  const f = 10 ** places
  return Math.round(x * f) / f
}

const clean = (s) => (typeof s === 'string' ? s.trim() : '')

export function buildVenueStats(venues, population, asOf) {
  const states = new Map() // st -> Map(city -> count)
  let total = 0
  for (const v of venues) {
    const st = clean(v?.st)
    const city = clean(v?.city)
    if (!st || !city) continue
    if (!states.has(st)) states.set(st, new Map())
    const cities = states.get(st)
    cities.set(city, (cities.get(city) ?? 0) + 1)
    total++
  }

  const byCount = (a, b) => b.venues - a.venues
  const byState = []
  const stateCities = {}
  const allCities = []
  for (const [st, cities] of states) {
    let n = 0
    const list = []
    for (const [city, count] of cities) {
      n += count
      list.push({ city, venues: count })
      allCities.push({ city, st, venues: count })
    }
    list.sort((a, b) => byCount(a, b) || a.city.localeCompare(b.city))
    stateCities[st] = list
    const pop = population?.[st]
    byState.push({
      st,
      name: STATE_NAMES[st] ?? st,
      venues: n,
      cities: cities.size,
      per100k: pop > 0 ? round(n / (pop / 100000), 2) : null,
    })
  }
  byState.sort((a, b) => byCount(a, b) || a.st.localeCompare(b.st))
  allCities.sort((a, b) => byCount(a, b) || a.city.localeCompare(b.city) || a.st.localeCompare(b.st))

  const lead = byState[0]
  return {
    generated: asOf,
    totals: {
      venues: total,
      cities: allCities.length,
      states: byState.length,
      lead: lead ? { st: lead.st, share: round(lead.venues / total, 3) } : { st: '', share: 0 },
    },
    byState,
    topCities: allCities.slice(0, 10),
    stateCities,
  }
}
