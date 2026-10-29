import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePhone, addressParts, normalizeHours, zoneOf, milesBetween } from '../scripts/lib/site/normalize.mjs'
import { queryD1 } from '../scripts/lib/site/d1.mjs'

const tampaPhone = { e164: '+18135550100', display: '(813) 555-0100' }

test('normalizePhone handles "+1 813-555-0100" and "(813) 555-0100"', () => {
  assert.deepEqual(normalizePhone('+1 813-555-0100'), tampaPhone)
  assert.deepEqual(normalizePhone('(813) 555-0100'), tampaPhone)
  assert.deepEqual(normalizePhone('813.555.0100'), tampaPhone)
  assert.deepEqual(normalizePhone('18135550100'), tampaPhone)
})

test('normalizePhone strips an extension', () => {
  assert.deepEqual(normalizePhone('(813) 555-0100 ext. 12'), tampaPhone)
  assert.deepEqual(normalizePhone('+1 813-555-0100 x4'), tampaPhone)
  assert.deepEqual(normalizePhone('813-555-0100;ext=9'), tampaPhone)
})

test('normalizePhone returns null for "555-0100", "", null', () => {
  assert.equal(normalizePhone('555-0100'), null)
  assert.equal(normalizePhone(''), null)
  assert.equal(normalizePhone(null), null)
  assert.equal(normalizePhone(undefined), null)
  assert.equal(normalizePhone('28135550100'), null, '11 digits not starting with 1')
  assert.equal(normalizePhone('+44 20 7946 0958'), null)
  assert.equal(normalizePhone('call us'), null)
})

test('addressParts parses street, city, state, zip', () => {
  assert.deepEqual(addressParts('123 Sample St, Tampa, FL 33602, USA'), { street: '123 Sample St', city: 'Tampa', state: 'FL', zip: '33602' })
  assert.deepEqual(addressParts('500 Main St Suite 4, St. Petersburg, FL 33701-1234, United States'),
    { street: '500 Main St Suite 4', city: 'St. Petersburg', state: 'FL', zip: '33701-1234' })
  assert.deepEqual(addressParts('Unit 2, 9 Elm Ave, Portland, ME 04101'), { street: 'Unit 2, 9 Elm Ave', city: 'Portland', state: 'ME', zip: '04101' })
})

test('addressParts returns null without a state', () => {
  assert.equal(addressParts('123 Sample St, Tampa, USA'), null)
  assert.equal(addressParts('Tampa'), null)
  assert.equal(addressParts(''), null)
  assert.equal(addressParts(null), null)
  assert.equal(addressParts('FL 33602, USA'), null, 'no city')
})

const p = (od, ot, cd, ct) => ({ open: { day: od, time: ot }, close: { day: cd, time: ct } })

test('normalizeHours converts Google periods', () => {
  const json = JSON.stringify([p(1, '1100', 1, '2200'), p(2, '0930', 2, '2100')])
  assert.deepEqual(normalizeHours(json), [
    { day: 1, open: '11:00', close: '22:00' },
    { day: 2, open: '09:30', close: '21:00' },
  ])
  // Already-parsed object with a periods key is accepted too.
  assert.deepEqual(normalizeHours(JSON.stringify({ periods: [p(5, '1600', 5, '2300')] })), [{ day: 5, open: '16:00', close: '23:00' }])
})

test('normalizeHours keeps overnight close earlier than open', () => {
  const json = JSON.stringify([p(5, '1800', 6, '0200'), p(6, '1800', 0, '0200')])
  assert.deepEqual(normalizeHours(json), [
    { day: 5, open: '18:00', close: '02:00' },
    { day: 6, open: '18:00', close: '02:00' },
  ])
})

test('normalizeHours returns 24h for the always-open shape', () => {
  const json = JSON.stringify([{ open: { day: 0, time: '0000' } }])
  const out = normalizeHours(json)
  assert.equal(out.length, 7)
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' })))
})

test('normalizeHours returns null for null and for []', () => {
  assert.equal(normalizeHours(null), null)
  assert.equal(normalizeHours('[]'), null)
  assert.equal(normalizeHours(''), null)
  assert.equal(normalizeHours('not json'), null)
  assert.equal(normalizeHours('{}'), null)
  assert.equal(normalizeHours(JSON.stringify([{ open: { day: 9, time: '1100' }, close: { day: 9, time: '2200' } }])), null)
  assert.equal(normalizeHours(JSON.stringify([{ open: { day: 1, time: '2500' }, close: { day: 1, time: '2200' } }])), null)
  assert.equal(normalizeHours(JSON.stringify([{ open: { day: 1, time: '1100' } }])), null, 'missing close is only valid for the always-open shape')
})

test('zoneOf FL is America/New_York; TX El Paso lng -106.4 is America/Denver; unknown state is null', () => {
  assert.equal(zoneOf('FL', -82.46, 27.95), 'America/New_York')
  assert.equal(zoneOf('FL', -87.2, 30.42), 'America/Chicago', 'Pensacola')
  assert.equal(zoneOf('TX', -106.4, 31.76), 'America/Denver')
  assert.equal(zoneOf('TX', -95.37, 29.76), 'America/Chicago')
  assert.equal(zoneOf('ZZ', -80, 30), null)
  assert.equal(zoneOf('', -80, 30), null)
  assert.equal(zoneOf('AZ', -111.9, 33.4), 'America/Phoenix')
  // Special cases ported from kava-proxy/tz-infer.js.
  assert.equal(zoneOf('IN', -87.5, 41.6), 'America/Chicago', 'Gary')
  assert.equal(zoneOf('IN', -86.16, 39.77), 'America/New_York', 'Indianapolis')
  assert.equal(zoneOf('ID', -116.78, 47.68), 'America/Los_Angeles', "Coeur d'Alene")
  assert.equal(zoneOf('ID', -116.2, 43.6), 'America/Denver', 'Boise')
  assert.equal(zoneOf('OR', -116.96, 44.03), 'America/Denver', 'Ontario (Malheur County)')
  assert.equal(zoneOf('OR', -117.83, 44.77), 'America/Los_Angeles', 'Baker City stays Pacific')
  assert.equal(zoneOf('OR', -122.68, 45.52), 'America/Los_Angeles', 'Portland')
})

test('milesBetween Tampa to Orlando is about 77 miles (within 2)', () => {
  // Straight-line (haversine) distance between downtown Tampa and downtown Orlando. The brief's
  // "about 84" is the driving distance; great-circle is ~77.
  const d = milesBetween({ lat: 27.9506, lng: -82.4572 }, { lat: 28.5383, lng: -81.3792 })
  assert.ok(Math.abs(d - 77) <= 2, `got ${d}`)
  assert.equal(milesBetween({ lat: 27.9506, lng: -82.4572 }, { lat: 27.9506, lng: -82.4572 }), 0)
})

test('site-config.json holds the canonical values', () => {
  const cfg = JSON.parse(readFileSync(new URL('../scripts/site-config.json', import.meta.url), 'utf8'))
  assert.deepEqual(cfg, {
    SITE_URL: 'https://kavacrawl.app',
    neighbors: 3,
    radiusMiles: 25,
    maxNewPages: 25,
    appStoreUrl: 'https://apps.apple.com/us/app/kavacrawl/id6772610237',
  })
})

const env = { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc', D1_DATABASE_ID: 'db' }
const reply = (status, body, calls = []) => async (url, opts) => {
  calls.push({ url, opts })
  return { ok: status < 400, status, json: async () => body }
}

test('queryD1 posts sql and params and returns rows and rowsRead', async () => {
  const calls = []
  const out = await queryD1(env, 'SELECT * FROM places WHERE place_id = ?', ['x'],
    reply(200, { success: true, result: [{ success: true, results: [{ a: 1 }], meta: { rows_read: 42 } }] }, calls))
  assert.deepEqual(out, { rows: [{ a: 1 }], rowsRead: 42 })
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query')
  assert.equal(calls[0].opts.method, 'POST')
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(calls[0].opts.body), { sql: 'SELECT * FROM places WHERE place_id = ?', params: ['x'] })
})

test('queryD1 omits params when none are given and rowsRead defaults to 0', async () => {
  const calls = []
  const out = await queryD1(env, 'SELECT 1', undefined, reply(200, { success: true, result: [{ success: true, results: [] }] }, calls))
  assert.deepEqual(out, { rows: [], rowsRead: 0 })
  assert.deepEqual(JSON.parse(calls[0].opts.body), { sql: 'SELECT 1' })
})

test('queryD1 throws on HTTP errors, API errors, bad shapes and missing env', async () => {
  await assert.rejects(queryD1(env, 'SELECT 1', [], reply(403, { success: false, errors: [{ message: 'denied' }] })), /HTTP 403 \(denied\)/)
  await assert.rejects(queryD1(env, 'SELECT 1', [], reply(200, { success: false, errors: [{ message: 'bad sql' }] })), /bad sql/)
  await assert.rejects(queryD1(env, 'SELECT 1', [], reply(200, { success: true, result: [] })), /unexpected response shape/)
  await assert.rejects(queryD1({ ...env, CLOUDFLARE_API_TOKEN: '' }, 'SELECT 1', [], reply(200, {})), /needs CLOUDFLARE_API_TOKEN/)
})
