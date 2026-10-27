import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchEventRows, SQL } from '../scripts/build-stats.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const cli = join(repo, 'scripts/build-stats.mjs')
const venues = JSON.parse(readFileSync(join(repo, 'mapdata/venues.json'), 'utf8')).venues

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'build-stats-'))
  mkdirSync(join(root, 'mapdata'))
  mkdirSync(join(root, 'scripts'))
  copyFileSync(join(repo, 'mapdata/venues.json'), join(root, 'mapdata/venues.json'))
  copyFileSync(join(repo, 'mapdata/state-population.json'), join(root, 'mapdata/state-population.json'))
  copyFileSync(join(repo, 'scripts/event-rules.json'), join(root, 'scripts/event-rules.json'))
  return root
}

function eventsFile(root, rows, name = 'events.json') {
  const p = join(root, name)
  writeFileSync(p, JSON.stringify(rows))
  return p
}

const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
const lines = (r) => r.stdout.trim().split('\n')

const rows = [
  { place_id: venues[0].id, title: 'Trivia Night', day_of_week: 2 },
  { place_id: venues[0].id, title: 'Open Mic', day_of_week: 4 },
  { place_id: venues[1].id, title: 'Karaoke', day_of_week: 5 },
  { place_id: venues[1].id, title: 'Weekly schedule', day_of_week: 1 },
  { place_id: 'not-on-map', title: 'Trivia', day_of_week: 3 },
]

test('writes both files, then reports unchanged without touching them', () => {
  const root = makeRoot()
  const ev = eventsFile(root, rows)
  const first = run(['--root', root, '--events-file', ev])
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(lines(first), ['wrote mapdata/venue-stats.json', 'wrote mapdata/events-stats.json'])

  const vs = JSON.parse(readFileSync(join(root, 'mapdata/venue-stats.json'), 'utf8'))
  const es = JSON.parse(readFileSync(join(root, 'mapdata/events-stats.json'), 'utf8'))
  assert.match(vs.generated, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(vs.totals.venues, venues.length)
  assert.ok(vs.vintage)
  assert.deepEqual(vs.excluded, { noLocation: 0 })
  assert.equal(es.totals.events, 3)
  assert.deepEqual(es.excluded, { listings: 1, outsideMap: 1, invalid: 0 })
  assert.ok(es.vintage)
  const text = readFileSync(join(root, 'mapdata/events-stats.json'), 'utf8')
  assert.ok(!text.includes(venues[0].id), 'no place ids in output')
  assert.ok(!text.includes('Trivia Night'), 'no titles in output')
  assert.ok(!text.includes(venues[0].name), 'no venue names in output')

  const m1 = statSync(join(root, 'mapdata/venue-stats.json')).mtimeMs
  const m2 = statSync(join(root, 'mapdata/events-stats.json')).mtimeMs
  const second = run(['--root', root, '--events-file', ev])
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(lines(second), ['unchanged mapdata/venue-stats.json', 'unchanged mapdata/events-stats.json'])
  assert.equal(statSync(join(root, 'mapdata/venue-stats.json')).mtimeMs, m1)
  assert.equal(statSync(join(root, 'mapdata/events-stats.json')).mtimeMs, m2)
})

test('an empty events file is refused and leaves the files alone', () => {
  const root = makeRoot()
  run(['--root', root, '--events-file', eventsFile(root, rows)])
  const before = readFileSync(join(root, 'mapdata/events-stats.json'), 'utf8')
  const m1 = statSync(join(root, 'mapdata/venue-stats.json')).mtimeMs
  const m2 = statSync(join(root, 'mapdata/events-stats.json')).mtimeMs

  const r = run(['--root', root, '--events-file', eventsFile(root, [], 'empty.json')])
  assert.notEqual(r.status, 0)
  assert.ok(lines(r).length === 2 && lines(r).every((l) => l.startsWith('refused: ')), r.stdout)
  assert.equal(readFileSync(join(root, 'mapdata/events-stats.json'), 'utf8'), before)
  assert.equal(statSync(join(root, 'mapdata/venue-stats.json')).mtimeMs, m1)
  assert.equal(statSync(join(root, 'mapdata/events-stats.json')).mtimeMs, m2)
})

test('--dry-run writes nothing', () => {
  const root = makeRoot()
  const r = run(['--root', root, '--events-file', eventsFile(root, rows), '--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(lines(r).length, 2)
  assert.equal(existsSync(join(root, 'mapdata/venue-stats.json')), false)
  assert.equal(existsSync(join(root, 'mapdata/events-stats.json')), false)
})

const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc', D1_DATABASE_ID: 'db' }

test('fetchEventRows posts the SQL and returns result[0].results', async () => {
  let call
  const fakeFetch = async (url, opts) => {
    call = { url, opts }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [{ success: true, results: [{ place_id: 'a', title: 't', day_of_week: 1 }] }] }),
    }
  }
  const out = await fetchEventRows(env, fakeFetch)
  assert.deepEqual(out, [{ place_id: 'a', title: 't', day_of_week: 1 }])
  assert.equal(call.url, 'https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query')
  assert.equal(call.opts.method, 'POST')
  assert.equal(call.opts.headers.Authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(call.opts.body), { sql: SQL })
  assert.equal(SQL, 'SELECT place_id, title, day_of_week FROM venue_events WHERE place_id IN (SELECT place_id FROM places WHERE hidden = 0)')
})

test('fetchEventRows throws on HTTP errors, API errors, bad shapes and missing env', async () => {
  const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })
  await assert.rejects(fetchEventRows(env, reply(403, { success: false, errors: [{ message: 'denied' }] })))
  await assert.rejects(fetchEventRows(env, reply(200, { success: false, errors: [{ message: 'bad sql' }] })))
  await assert.rejects(fetchEventRows(env, reply(200, { success: true, result: [] })))
  await assert.rejects(fetchEventRows(env, reply(200, { success: true, result: [{ success: false, results: [] }] })))
  await assert.rejects(fetchEventRows({ ...env, D1_DATABASE_ID: '' }, reply(200, {})))
})
