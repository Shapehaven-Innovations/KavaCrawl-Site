#!/usr/bin/env node
// Parity check (manual): the live public API's Index total and menu item count for one bar, next to
// what the site snapshot builds for the same bar.
//
//   node scripts/dev/compare-venue.mjs <place_id> [--input <d1.json>] [--venues <venues.json>]
//
// --input: a JSON file shaped { places, scores, latestPrices, shellHistory, events } (the five SQL result
// sets, e.g. tests/fixtures/site/d1.json). Without it the snapshot side reads D1 with the read-only SQL,
// which needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID.
// --venues: the curated list (default mapdata/venues.json).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SQL } from '../lib/site/queries.mjs'
import { queryD1 } from '../lib/site/d1.mjs'
import { buildBars, curatedIds } from '../lib/site/snapshot.mjs'

export const API_BASE = 'https://api.kavacrawl.shapehaveninnovations.com'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Pure: rows of [field, api, snapshot, match]. api is the /venues/:id body; bar a Bar or null. */
export function compareRows(api, bar) {
  const apiTotal = api?.score?.total ?? null
  const apiMenu = Array.isArray(api?.prices?.items) ? api.prices.items.length : 0
  const snapTotal = bar?.index?.total ?? null
  const snapMenu = bar?.menu?.items?.length ?? 0
  return [
    ['Index total', apiTotal, snapTotal, apiTotal === snapTotal],
    ['Menu items', apiMenu, snapMenu, apiMenu === snapMenu],
  ]
}

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function loadInput(argv, env, fetchFn) {
  const file = arg(argv, '--input')
  if (file) return { input: JSON.parse(readFileSync(resolve(file), 'utf8')), rowsRead: 0 }
  const input = {}
  let rowsRead = 0
  for (const [key, sql] of Object.entries(SQL)) {
    const r = await queryD1(env, sql, undefined, fetchFn)
    input[key] = r.rows
    rowsRead += r.rowsRead
  }
  return { input, rowsRead }
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchFn = fetch) {
  const id = argv.find((a, i) => !a.startsWith('--') && !['--input', '--venues'].includes(argv[i - 1]))
  if (!id) {
    console.error('usage: node scripts/dev/compare-venue.mjs <place_id> [--input <d1.json>] [--venues <venues.json>]')
    return 2
  }
  const venuesPath = resolve(arg(argv, '--venues') ?? resolve(ROOT, 'mapdata/venues.json'))
  const curated = curatedIds(JSON.parse(readFileSync(venuesPath, 'utf8')))
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'scripts/site-config.json'), 'utf8'))
  const { input, rowsRead } = await loadInput(argv, env, fetchFn)
  const today = new Date().toISOString().slice(0, 10) // dev tool only; the build passes `now` in
  const { bars, skipped } = buildBars(input, curated, {}, cfg, today)
  const bar = bars.find((b) => b.place_id === id) ?? null

  const res = await fetchFn(`${API_BASE}/venues/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
  const api = res.ok ? await res.json() : null

  console.log(`place_id   ${id}`)
  console.log(`api        ${res.ok ? `${api?.name ?? '?'}` : `HTTP ${res.status}`}`)
  console.log(`snapshot   ${bar ? `${bar.name} ${bar.path}` : `not built (${skipped.find((s) => s.place_id === id)?.reason ?? 'not curated'})`}`)
  if (rowsRead) console.log(`D1 rows read ${rowsRead}`)
  console.log('')
  console.log(`${'field'.padEnd(12)} ${'api'.padStart(8)} ${'snapshot'.padStart(9)}  match`)
  const rows = compareRows(api, bar)
  for (const [field, a, s, ok] of rows) console.log(`${field.padEnd(12)} ${String(a).padStart(8)} ${String(s).padStart(9)}  ${ok ? 'yes' : 'NO'}`)
  return rows.every((r) => r[3]) ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }, (err) => { console.error(err.message); process.exitCode = 1 })
}
