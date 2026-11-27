import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkVenueList, loadVenueList, MAX_AGE_DAYS, VENUE_LIST_URL } from '../scripts/lib/venue-source.mjs'
import { planVenuesWrite } from '../scripts/lib/venues-file.mjs'

const NOW = new Date('2026-11-27T12:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()
const venue = (i) => ({ place_id: `p${i}`, name: `Bar ${i}`, city: 'Tampa', formatted_address: `${i} Main St, Tampa, FL 33602, USA` })
const list = (n, over = {}) => ({ schema_version: 1, generated_at: daysAgo(0), venues: Array.from({ length: n }, (_, i) => venue(i)), ...over })
const opts = { now: NOW, prevCount: 100 }
const sleep = async () => {}

test('the venue list is read over public HTTPS (no credential)', () => {
  assert.match(VENUE_LIST_URL, /^https:\/\/.+\/venues\/v1\.json$/)
})

test('checkVenueList accepts a fresh, complete list', () => {
  assert.equal(checkVenueList(list(100), opts).length, 100)
})

test('checkVenueList refuses a stale list so a dead publisher cannot pass green', () => {
  assert.ok(checkVenueList(list(100, { generated_at: daysAgo(MAX_AGE_DAYS - 0.5) }), opts))
  assert.throws(() => checkVenueList(list(100, { generated_at: daysAgo(MAX_AGE_DAYS + 0.5) }), opts), /days old/)
  assert.throws(() => checkVenueList(list(100, { generated_at: 'yesterday' }), opts), /generated_at/)
  assert.throws(() => checkVenueList(list(100, { generated_at: daysAgo(-3) }), opts), /future/)
})

test('checkVenueList refuses a list that shrank by more than 30%', () => {
  assert.ok(checkVenueList(list(70), opts))
  assert.throws(() => checkVenueList(list(69), opts), /69/)
  const noAddress = list(100)
  for (const v of noAddress.venues.slice(0, 40)) v.formatted_address = null
  assert.throws(() => checkVenueList(noAddress, opts), /60/)
})

test('checkVenueList refuses a wrong shape', () => {
  assert.throws(() => checkVenueList(null, opts), /schema_version/)
  assert.throws(() => checkVenueList(list(100, { schema_version: 2 }), opts), /schema_version/)
  assert.throws(() => checkVenueList(list(100, { venues: {} }), opts), /venues/)
  assert.throws(() => checkVenueList(list(0), { now: NOW, prevCount: 0 }), /no venues/)
  const bad = list(100)
  delete bad.venues[3].place_id
  assert.throws(() => checkVenueList(bad, opts), /place_id/)
})

test('loadVenueList fetches and checks a URL, and reports an HTTP error', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => list(100) })
  assert.equal((await loadVenueList('https://x.test/venues/v1.json', { ...opts, fetchFn, sleep })).length, 100)
  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) })
  await assert.rejects(loadVenueList('https://x.test/venues/v1.json', { ...opts, fetchFn: missing, sleep }), /HTTP 404/)
})

test('loadVenueList still reads a local pipeline file (a bare array)', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'venues-')), 'venues.json')
  writeFileSync(path, JSON.stringify(list(100).venues))
  assert.equal((await loadVenueList(path, opts)).length, 100)
  writeFileSync(path, JSON.stringify(list(5).venues))
  await assert.rejects(loadVenueList(path, opts), /5/)
})

test('planVenuesWrite refuses output that shrank by more than 30%', () => {
  const rows = (n) => ({ generated: '2026-11-27', venues: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) })
  assert.equal(planVenuesWrite(10, rows(100), rows(70)).action, 'write')
  const r = planVenuesWrite(10, rows(100), rows(69))
  assert.equal(r.action, 'refuse')
  assert.match(r.reason, /shrank/)
})
