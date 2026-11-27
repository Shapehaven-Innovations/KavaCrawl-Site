// The curated venue list that build-data starts from. The KavaCrawl app repository publishes it
// to a public bucket (menu_pipeline/publish_venue_list.py, daily and on every change), so this
// site needs no credential for that repository. Nothing here can expire.
import { readFile } from 'node:fs/promises'
import { fetchRetry } from './http.mjs'

export const VENUE_LIST_URL = 'https://pub-1508556f20d5428ca799c30e81fc0944.r2.dev/venues/v1.json'
// The publisher runs daily; an older list means it has stopped.
export const MAX_AGE_DAYS = 4
const MIN_KEEP = 0.7
const DAY = 86400000

// Every state to ask the rankings API about: those in the venue list and in the committed snapshot.
// Derived, so a bar discovered in a new state is covered without editing any list.
export function statesIn(pipeline, prevRows = []) {
  const found = pipeline.map((v) => /,\s*([A-Z]{2})\s+\d{5}/.exec(v.formatted_address || '')?.[1])
  return [...new Set([...found, ...prevRows.map((v) => v.st)].filter((s) => /^[A-Z]{2}$/.test(s ?? '')))].sort()
}

// Refuses a list with far fewer usable (addressed) bars than the committed snapshot.
function checkRows(rows, prevCount) {
  if (!Array.isArray(rows)) throw new Error('venue list has no venues array')
  if (rows.length === 0) throw new Error('venue list has no venues')
  if (rows.some((v) => typeof v?.place_id !== 'string' || !v.place_id || typeof v.name !== 'string')) {
    throw new Error('venue list has an entry without a place_id or name')
  }
  const usable = rows.filter((v) => typeof v.formatted_address === 'string' && v.formatted_address).length
  if (usable < MIN_KEEP * prevCount) {
    throw new Error(`venue list has only ${usable} bars with an address, below 70% of the committed ${prevCount}`)
  }
  return rows
}

// The published document: { schema_version: 1, generated_at, venues: [...] }.
export function checkVenueList(doc, { now = new Date(), prevCount = 0 } = {}) {
  if (doc?.schema_version !== 1) throw new Error('venue list: unexpected schema_version')
  const made = Date.parse(doc.generated_at)
  if (!Number.isFinite(made)) throw new Error('venue list: missing or unreadable generated_at')
  const age = (now - made) / DAY
  if (age > MAX_AGE_DAYS) {
    throw new Error(`venue list is ${age.toFixed(1)} days old (limit ${MAX_AGE_DAYS}); check the "Publish venue list" workflow in the KavaCrawl repository`)
  }
  if (age < -1) throw new Error('venue list: generated_at is in the future')
  return checkRows(doc.venues, prevCount)
}

// source: an https URL of the published list, or a local menu_pipeline/venues.json (a bare array).
export async function loadVenueList(source, { prevCount = 0, now, fetchFn, sleep } = {}) {
  if (!/^https:\/\//.test(source)) return checkRows(JSON.parse(await readFile(source, 'utf8')), prevCount)
  const { res, body } = await fetchRetry(source, { headers: { 'User-Agent': 'KavaCrawl-build/1.0' } },
    { fetchFn, sleep, read: (r) => (r.ok ? r.json() : null) })
  if (!res.ok) throw new Error(`venue list fetch failed: HTTP ${res.status}`)
  return checkVenueList(body, { now, prevCount })
}
