// Runs scripts/build-data.mjs on a throwaway copy with the network stubbed out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scripts = fileURLToPath(new URL('../scripts', import.meta.url))
const ids = Array.from({ length: 20 }, (_, i) => `p${i}`)
const street = (i) => `${i + 1} Main St, Tampa, FL 33602`
const pipeline = ids.map((id, i) => ({ place_id: id, name: `Bar ${i}`, city: 'Tampa', formatted_address: `${street(i)}, USA` }))
const committed = { generated: '2026-01-01', venues: ids.map((id, i) => ({ id, name: `Bar ${i}`, st: 'FL', addr: `${i + 1} Main St`, idx: null, price: 7, updated: '2026-01-01' })) }

// STUB_RANKINGS / STUB_VENUES: HTTP status to answer with. STUB_BAD: comma list of ids that answer 500.
// STUB_EXTRA: number of ranked bars the API knows that the venue list does not.
const stub = `
const real = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => real(fn, 0, ...a)
const answer = (status, body) => new Response(JSON.stringify(body), { status })
globalThis.fetch = async (url) => {
  const u = new URL(url)
  if (u.pathname === '/rankings') {
    console.log('asked for state ' + u.searchParams.get('state'))
    const bar = (id) => ({ place_id: id, name: id, state: 'FL', metro: 'Tampa', lat_r: 27.9, lng_r: -82.4, total: 50, shell_price: 5 })
    const extra = Array.from({ length: Number(process.env.STUB_EXTRA ?? 0) }, (_, i) => bar('x' + i))
    const venues = u.searchParams.get('state') === 'FL' ? [bar('p0'), ...extra] : []
    return answer(Number(process.env.STUB_RANKINGS ?? 200), { venues })
  }
  if (u.pathname.startsWith('/venues/')) {
    const bad = (process.env.STUB_BAD ?? '').split(',').includes(u.pathname.split('/').pop())
    return answer(bad ? 500 : Number(process.env.STUB_VENUES ?? 200), { prices: { items: [{ category: 'kava_shell', price: 6 }], observed_on: '2026-02-02' } })
  }
  throw new Error('unexpected request ' + url)
}
`

function run(env = {}, list = pipeline, before = committed) {
  const root = mkdtempSync(join(tmpdir(), 'build-data-'))
  cpSync(scripts, join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'mapdata'))
  const put = (p, v) => writeFileSync(join(root, p), typeof v === 'string' ? v : JSON.stringify(v))
  put('mapdata/zips.json', { z: [['33602', 2795, -8245, 0]], c: ['Tampa'] })
  put('mapdata/geocache.json', Object.fromEntries(ids.map((id, i) => [id, { lat: 27.95, lng: -82.45, src: 'census', addr: street(i) }])))
  put('mapdata/venues.json', before)
  put('list.json', list)
  put('stub.mjs', stub)
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'stub.mjs')).href, join(root, 'scripts/build-data.mjs'), join(root, 'list.json')],
    { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 })
  const written = JSON.parse(readFileSync(join(root, 'mapdata/venues.json'), 'utf8'))
  return { status: r.status, out: r.stdout + r.stderr, written, row: (id) => written.venues.find((v) => v.id === id) }
}

test('build-data writes the refreshed list', () => {
  const r = run()
  assert.equal(r.status, 0, r.out)
  assert.equal(r.row('p1').price, 6)
})

test('build-data refuses a list much smaller than the committed one', () => {
  const r = run({}, pipeline.slice(0, 5))
  assert.notEqual(r.status, 0)
  assert.match(r.out, /below 70%/)
  assert.deepEqual(r.written, committed)
})

test('build-data stops when the rankings call keeps failing', () => {
  const r = run({ STUB_RANKINGS: '503' })
  assert.notEqual(r.status, 0)
  assert.match(r.out, /HTTP 503/)
  assert.deepEqual(r.written, committed)
})

test('build-data keeps the committed values for a few bars whose lookup fails, and says so', () => {
  const r = run({ STUB_BAD: 'p1,p2' })
  assert.equal(r.status, 0, r.out)
  assert.deepEqual([r.row('p1').price, r.row('p1').updated, r.row('p3').price], [7, '2026-01-01', 6])
  assert.match(r.out, /::warning::.*HTTP 500/)
})

test('build-data stops when many lookups fail', () => {
  const r = run({ STUB_VENUES: '503' })
  assert.notEqual(r.status, 0)
  assert.match(r.out, /HTTP 503/)
  assert.deepEqual(r.written, committed)
})

test('build-data asks for rankings in every state the lists mention, with no fixed state list', () => {
  const list = [...pipeline, { place_id: 'tn1', name: 'Nashville Bar', formatted_address: '9 Broadway, Nashville, TN 37203, USA' }]
  const before = { ...committed, venues: [...committed.venues, { id: 'old', name: 'Boise Bar', st: 'ID', addr: '1 A St' }] }
  const r = run({}, list, before)
  for (const st of ['FL', 'TN', 'ID']) assert.match(r.out, new RegExp(`asked for state ${st}\\b`), r.out)
  assert.doesNotMatch(r.out, /asked for state WI/)
})

test('build-data does not count ranked-only bars against the venue list size', () => {
  // 12 committed rows came from rankings alone (no street address); the list was never meant to hold them.
  const rankedOnly = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, name: 'x' + i, st: 'FL', addr: null }))
  const r = run({ STUB_EXTRA: '12' }, pipeline, { ...committed, venues: [...committed.venues, ...rankedOnly] })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.written.venues.length, 32)
})
