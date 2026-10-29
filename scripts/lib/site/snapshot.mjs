// Joins the five D1 result sets into one Bar per eligible curated bar. Pure: no clock (`now` is a
// parameter), no randomness, stable sorts, so the same inputs give the same output.
import { normalizeHours, zoneOf } from './normalize.mjs'
import { evaluate } from './gate.mjs'
import { assignPaths } from './slugs.mjs'
import { nearest } from './neighbors.mjs'
import { HISTORY_DAYS } from './queries.mjs'

const SHELL_CATS = new Set(['kava_shell', 'kava_double', 'kava_brew', 'kava_shot'])
const ONE_OFF_GRACE_DAYS = 7
const MIN_METRO_SHELLS = 3

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const r1 = (n) => Math.round(n * 10) / 10
const r2 = (n) => Math.round(n * 100) / 100
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** YYYY-MM-DD minus n days (UTC). */
function daysBefore(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
}

// --- Ported from KavaCrawl/kava-proxy (ingest.js shellEquiv, venues.js median/weekStart/obsValue). ---

/** Price per ~4oz shell; null when the row cannot be converted. Same as the worker's ingest.js. */
export function shellEquiv(category, price, size) {
  const big = size != null && size > 8
  if ((category === 'kava_shell' || category === 'kava_double') && big) return (price / size) * 4
  if (category === 'kava_shell') return price
  if (category === 'kava_double') return price / 2
  if ((category === 'kava_brew' || category === 'kava_shot') && size) return (price / size) * 4
  return null
}

export function median(vals) {
  const s = [...vals].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Monday (UTC) of the week containing a YYYY-MM-DD date. */
export function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function obsValue(r) {
  if (typeof r.shell_equiv === 'number') return r.shell_equiv
  if (!SHELL_CATS.has(r.category)) return r.price_usd
  const size = typeof r.size_oz === 'number' && r.size_oz > 0 ? r.size_oz : null
  return shellEquiv(r.category, r.price_usd, size)
}

// --- end of port ---

/** Curated place_ids from a parsed mapdata/venues.json. */
export function curatedIds(venuesDoc) {
  return new Set((venuesDoc?.venues ?? []).map((v) => v?.id).filter((id) => typeof id === 'string' && id))
}

function groupBy(rows, key = 'place_id') {
  const m = new Map()
  for (const r of rows ?? []) {
    if (!m.has(r[key])) m.set(r[key], [])
    m.get(r[key]).push(r)
  }
  return m
}

function httpUrl(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null
}

/** Lowest listed `price_usd` among a bar's latest kava_shell rows (the menu's own price, not a per-4oz equivalent); null if none. */
function shellOf(latest) {
  let best = null
  for (const r of latest ?? []) {
    if (r.category !== 'kava_shell') continue
    const v = num(r.price_usd)
    if (v != null && (best == null || v < best)) best = v
  }
  return best == null ? null : r2(best)
}

function menuOf(latest) {
  if (!latest?.length) return null
  const items = latest.map((r) => ({
    name: r.item_name, category: r.category, price: r.price_usd, size_oz: r.size_oz ?? null, shell_equiv: r.shell_equiv ?? null,
  }))
  items.sort((a, b) => cmp(a.category, b.category) || a.price - b.price || cmp(a.name, b.name))
  return { items }
}

/** Weekly lowest listed kava_shell price (the same measure as the headline shell price), Monday-start UTC weeks. */
function historyOf(rows, cutoff) {
  const weeks = new Map()
  for (const r of rows ?? []) {
    if (r.category !== 'kava_shell' || typeof r.observed_on !== 'string' || r.observed_on < cutoff) continue
    const v = num(r.price_usd)
    if (v == null) continue
    const w = weekStart(r.observed_on)
    if (!weeks.has(w)) weeks.set(w, [])
    weeks.get(w).push(v)
  }
  return [...weeks].sort((a, b) => cmp(a[0], b[0])).map(([week, vals]) => ({ week, median: r2(Math.min(...vals)) }))
}

function eventsOf(rows, dropBefore) {
  const out = []
  for (const r of rows ?? []) {
    const recurring = r.is_recurring === 1 || r.is_recurring === true
    if (!recurring && typeof r.end_date === 'string' && r.end_date < dropBefore) continue
    out.push({
      title: r.title, day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time ?? null,
      is_recurring: recurring, start_date: r.start_date ?? null, end_date: r.end_date ?? null,
    })
  }
  out.sort((a, b) => a.day_of_week - b.day_of_week || cmp(a.start_time, b.start_time) || cmp(a.title, b.title)
    || cmp(a.start_date ?? '', b.start_date ?? ''))
  return out
}

function indexOf(score) {
  if (!score || num(score.total) == null) return null
  const components = parse(score.components_json)
  return { total: score.total, components: components && typeof components === 'object' && !Array.isArray(components) ? components : {} }
}

/** rank 1 = cheapest; ties share the lower rank. Null with fewer than 3 shells in the metro. */
function compareOf(shell, pool) {
  if (shell == null || !pool || pool.length < MIN_METRO_SHELLS) return null
  const med = median(pool)
  return {
    metroMedianShell: r2(med),
    pctVsMetro: r1(((shell - med) / med) * 100) || 0,
    rank: 1 + pool.filter((s) => s < shell).length,
    total: pool.length,
  }
}

/**
 * input: the five SQL result sets. curated: Set of place_ids. existingPaths: slugs.json. cfg: site-config.json.
 * now: YYYY-MM-DD. Bar.phone is { e164, display } or null (phone is optional).
 * Returns { bars, skipped, paths } — bars sorted by path, skipped by place_id, paths is
 * the merged slugs.json (existing entries untouched).
 */
export function buildBars(input, curated, existingPaths, cfg, now) {
  const places = new Map((input.places ?? []).map((p) => [p.place_id, p]))
  const scores = new Map((input.scores ?? []).map((s) => [s.place_id, s]))
  const latest = groupBy(input.latestPrices)
  const history = groupBy(input.shellHistory)
  const events = groupBy(input.events)
  const historyCutoff = daysBefore(now, HISTORY_DAYS)
  const dropBefore = daysBefore(now, ONE_OFF_GRACE_DAYS)

  const skipped = []
  const eligible = []
  // Metro shell pools: every curated bar that is in D1, not hidden and operating, with a metro and a shell.
  const pools = new Map()
  for (const id of [...curated].sort()) {
    const place = places.get(id)
    if (!place) { skipped.push({ place_id: id, reason: 'not-in-d1' }); continue }
    const metro = scores.get(id)?.metro ?? null
    const shell = shellOf(latest.get(id))
    if (Number(place.hidden) === 0 && place.business_status === 'OPERATIONAL' && metro && shell != null) {
      if (!pools.has(metro)) pools.set(metro, [])
      pools.get(metro).push(shell)
    }
    const g = evaluate(place, curated)
    if (!g.ok) { skipped.push({ place_id: id, reason: g.reason }); continue }
    eligible.push({ place, parts: g.parts, phone: g.phone, metro, shell })
  }

  const paths = assignPaths(eligible.map((e) => ({ place_id: e.place.place_id, name: e.place.name, state: e.parts.state, city: e.parts.city })), existingPaths ?? {})

  const bars = eligible.map(({ place, parts, phone, metro, shell }) => {
    const id = place.place_id
    const path = paths[id]
    return {
      place_id: id,
      name: place.name.trim(),
      path,
      slug: path.split('/').filter(Boolean).pop(),
      street: parts.street,
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
      metro,
      lat: place.lat,
      lng: place.lng,
      phone,
      website: httpUrl(place.website),
      tz: zoneOf(parts.state, place.lng, place.lat),
      hours: normalizeHours(place.hours_json),
      events: eventsOf(events.get(id), dropBefore),
      menu: menuOf(latest.get(id)),
      shell,
      index: indexOf(scores.get(id)),
      compare: compareOf(shell, metro ? pools.get(metro) : null),
      history: historyOf(history.get(id), historyCutoff),
      neighbors: [],
    }
  })

  const byId = new Map(bars.map((b) => [b.place_id, b]))
  for (const b of bars) {
    b.neighbors = nearest(b, bars, cfg).map(({ place_id, miles }) => {
      const n = byId.get(place_id)
      return { place_id, path: n.path, name: n.name, miles: r1(miles), shell: n.shell, indexTotal: n.index?.total ?? null }
    })
  }

  bars.sort((a, b) => cmp(a.path, b.path))
  skipped.sort((a, b) => cmp(a.place_id, b.place_id))
  return { bars, skipped, paths }
}
