import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchRetry, getApiJson } from '../scripts/lib/http.mjs'
import { queryD1 } from '../scripts/lib/site/d1.mjs'

const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
// Plays one step per call: an Error is thrown, anything else is returned.
function script(...steps) {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length, steps.length) - 1]
    if (step instanceof Error) throw step
    return step
  }
  return { fetchFn, calls }
}
const waits = []
const sleep = async (ms) => { waits.push(ms) }
const reset = () => new TypeError('fetch failed', { cause: new Error('read ECONNRESET') })

test('fetchRetry retries a dropped connection, then returns the response', async () => {
  const s = script(reset(), reply(200, { a: 1 }))
  const { res } = await fetchRetry('https://x.test', {}, { fetchFn: s.fetchFn, sleep })
  assert.equal(res.status, 200)
  assert.equal(s.calls.length, 2)
})

test('fetchRetry retries 429 and 5xx with growing waits', async () => {
  waits.length = 0
  const s = script(reply(429), reply(503), reply(200))
  const { res } = await fetchRetry('https://x.test', {}, { fetchFn: s.fetchFn, sleep })
  assert.equal(res.status, 200)
  assert.equal(s.calls.length, 3)
  assert.ok(waits[1] > waits[0], `waits should grow: ${waits}`)
})

test('fetchRetry does not retry a client error', async () => {
  const s = script(reply(401))
  const { res } = await fetchRetry('https://x.test', {}, { fetchFn: s.fetchFn, sleep })
  assert.equal(res.status, 401)
  assert.equal(s.calls.length, 1)
})

test('fetchRetry gives up: last error is thrown, last bad status is returned', async () => {
  const dead = script(reset())
  await assert.rejects(fetchRetry('https://x.test', {}, { fetchFn: dead.fetchFn, sleep, attempts: 3 }), /fetch failed/)
  assert.equal(dead.calls.length, 3)
  const down = script(reply(500))
  const { res } = await fetchRetry('https://x.test', {}, { fetchFn: down.fetchFn, sleep, attempts: 3 })
  assert.equal(res.status, 500)
  assert.equal(down.calls.length, 3)
})

test('fetchRetry retries when the body read fails, and sets a timeout signal', async () => {
  const broken = { ok: true, status: 200, json: async () => { throw new TypeError('terminated') } }
  const s = script(broken, reply(200, { a: 2 }))
  const { body } = await fetchRetry('https://x.test', {}, { fetchFn: s.fetchFn, sleep, read: (r) => r.json() })
  assert.deepEqual(body, { a: 2 })
  assert.ok(s.calls[0].init.signal instanceof AbortSignal)
  // A signal shared between attempts would abort every retry once the first timed out.
  assert.notEqual(s.calls[0].init.signal, s.calls[1].init.signal)
})

test('getApiJson returns data, null for 404, and throws for everything else', async () => {
  assert.deepEqual(await getApiJson('https://x.test/a', { fetchFn: script(reply(200, { v: 1 })).fetchFn, sleep }), { v: 1 })
  assert.equal(await getApiJson('https://x.test/a', { fetchFn: script(reply(404)).fetchFn, sleep }), null)
  // A persistent outage must never look like "no data".
  await assert.rejects(getApiJson('https://x.test/a', { fetchFn: script(reply(503)).fetchFn, sleep }), /HTTP 503/)
  await assert.rejects(getApiJson('https://x.test/a', { fetchFn: script(reply(429)).fetchFn, sleep }), /HTTP 429/)
  await assert.rejects(getApiJson('https://x.test/a', { fetchFn: script(reply(403)).fetchFn, sleep }), /HTTP 403/)
})

const env = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', D1_DATABASE_ID: 'd' }

test('queryD1 survives a transient failure', async () => {
  const ok = reply(200, { success: true, result: [{ success: true, results: [{ n: 1 }] }] })
  const s = script(reset(), reply(502), ok)
  const out = await queryD1(env, 'SELECT 1', undefined, s.fetchFn, sleep)
  assert.deepEqual(out.rows, [{ n: 1 }])
  assert.equal(s.calls.length, 3)
})

test('queryD1 retries a broken body on a good status, but not a refusal', async () => {
  const broken = { ok: true, status: 200, json: async () => { throw new TypeError('terminated') } }
  const ok = reply(200, { success: true, result: [{ success: true, results: [] }] })
  const s = script(broken, ok)
  await queryD1(env, 'SELECT 1', undefined, s.fetchFn, sleep)
  assert.equal(s.calls.length, 2)
  const page = { ok: false, status: 403, json: async () => { throw new SyntaxError('not JSON') } }
  const denied = script(page)
  await assert.rejects(queryD1(env, 'SELECT 1', undefined, denied.fetchFn, sleep), /HTTP 403/)
  assert.equal(denied.calls.length, 1)
})
