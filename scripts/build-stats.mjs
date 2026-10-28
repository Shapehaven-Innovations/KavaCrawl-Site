// Builds the dashboard aggregates mapdata/venue-stats.json and mapdata/events-stats.json.
// Usage: node scripts/build-stats.mjs [--dry-run] [--events-file path] [--root dir]
//
// - Venues come from mapdata/venues.json, so counts match the home page map.
// - Event rows come from --events-file (JSON array of {place_id, title, day_of_week}) or, when absent,
//   from Cloudflare D1 (env CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID). Hidden places
//   are filtered out in the SQL (a NULL hidden flag counts as visible).
// - A file is written only when its numbers changed and both guards pass (no zero totals, no drop of
//   more than 30% and no rise of more than 2x from the previous file). Prints one line per file: wrote, unchanged or refused.
//   Exits non-zero on a refusal or a failed query. --dry-run writes nothing.
// - Outputs hold aggregates only: no venue names, event titles or place ids.
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVenueStats } from './lib/venue-stats.mjs'
import { buildEventStats } from './lib/event-stats.mjs'
import { loadRules } from './lib/event-types.mjs'
import { checkTotals, sameNumbers } from './lib/guard.mjs'

export const SQL = 'SELECT place_id, title, day_of_week FROM venue_events WHERE place_id IN (SELECT place_id FROM places WHERE IFNULL(hidden, 0) = 0)'

const VENUE_OUT = 'mapdata/venue-stats.json'
const EVENTS_OUT = 'mapdata/events-stats.json'

// The only network call: run SQL against D1 through the Cloudflare REST API.
export async function fetchEventRows(env, fetchFn = fetch) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_DATABASE_ID: db } = env
  if (!token || !account || !db) throw new Error('D1 query needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID')
  const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: SQL }),
  })
  let json = null
  try { json = await res.json() } catch {}
  const errors = (json?.errors ?? []).map((e) => e.message).join('; ')
  if (!res.ok) throw new Error(`D1 query failed: HTTP ${res.status}${errors ? ` (${errors})` : ''}`)
  if (!json || json.success === false) throw new Error(`D1 query failed${errors ? `: ${errors}` : ''}`)
  const first = json.result?.[0]
  if (!first || first.success === false || !Array.isArray(first.results)) throw new Error('D1 query failed: unexpected response shape')
  return first.results
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

function parseArgs(argv) {
  const opts = { dryRun: false, eventsFile: null, root: fileURLToPath(new URL('..', import.meta.url)) }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--events-file') opts.eventsFile = argv[++i]
    else if (a === '--root') opts.root = argv[++i]
    else throw new Error(`unknown argument ${a}`)
    if (opts.eventsFile === undefined || opts.root === undefined) throw new Error(`${a} needs a value`)
  }
  opts.root = resolve(opts.root)
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const at = (p) => join(opts.root, p)
  const asOf = new Date().toISOString().slice(0, 19) + 'Z'

  const venues = (await readJson(at('mapdata/venues.json')))?.venues
  if (!Array.isArray(venues)) throw new Error('mapdata/venues.json is missing or has no venues array')
  const population = await readJson(at('mapdata/state-population.json'))
  if (!population?.pop) throw new Error('mapdata/state-population.json is missing or has no pop table')
  const rules = loadRules(at('scripts/event-rules.json'))

  let events
  if (opts.eventsFile) {
    events = JSON.parse(await readFile(resolve(opts.eventsFile), 'utf8'))
    if (!Array.isArray(events)) throw new Error('--events-file must hold a JSON array')
  } else {
    events = await fetchEventRows(process.env)
  }

  const venueIndex = new Map()
  let noLocation = 0
  for (const v of venues) {
    const st = typeof v?.st === 'string' ? v.st.trim() : ''
    const city = typeof v?.city === 'string' ? v.city.trim() : ''
    if (!st || !city) { noLocation++; continue }
    venueIndex.set(v.id, { st, city })
  }

  const venueStats = { ...buildVenueStats(venues, population.pop, asOf), vintage: population.vintage, excluded: { noLocation } }
  const eventStats = { ...buildEventStats(events, venueIndex, rules, asOf), vintage: population.vintage }

  const outputs = [
    { file: VENUE_OUT, next: venueStats, total: (s) => s?.totals?.venues, label: 'venue' },
    { file: EVENTS_OUT, next: eventStats, total: (s) => s?.totals?.events, label: 'event' },
  ]
  for (const o of outputs) {
    o.prev = await readJson(at(o.file))
    const prevTotal = o.total(o.prev)
    o.guard = checkTotals(typeof prevTotal === 'number' ? prevTotal : null, o.total(o.next))
  }

  // Both guards must pass before either file is written.
  const failed = outputs.filter((o) => !o.guard.ok)
  if (failed.length) {
    const why = failed.map((o) => `${o.label} ${o.guard.reason}`).join('; ')
    for (const o of outputs) console.log(`refused: ${o.file}: ${why}`)
    return 1
  }

  for (const o of outputs) {
    if (sameNumbers(o.prev, o.next)) {
      console.log(`unchanged ${o.file}`)
      continue
    }
    if (!opts.dryRun) await writeFile(at(o.file), JSON.stringify(o.next, null, 2) + '\n')
    console.log(`wrote ${o.file}${opts.dryRun ? ' (dry run, not saved)' : ''}`)
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code },
    (e) => {
      console.log(`refused: ${e.message}`)
      process.exitCode = 1
    },
  )
}
