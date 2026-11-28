import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkToken } from '../scripts/check-token.mjs'

const env = { CLOUDFLARE_API_TOKEN: 'secret-value', CLOUDFLARE_ACCOUNT_ID: 'acct' }
const now = new Date('2026-11-27T12:00:00Z')
const reply = (status, result) => new Response(JSON.stringify({ result }), { status })
const run = (answer) => checkToken(env, { now, sleep: async () => {}, fetchFn: async (url) => answer(url) })

test('an active token with no expiry, or a distant one, passes', async () => {
  assert.deepEqual(await run(() => reply(200, { status: 'active' })), { ok: true, message: 'active, no expiry' })
  assert.equal((await run(() => reply(200, { status: 'active', expires_on: '2027-03-01T00:00:00Z' }))).ok, true)
})

test('a user token is verified on the user endpoint', async () => {
  const r = await run((url) => (url.includes('/user/') ? reply(200, { status: 'active' }) : reply(401, null)))
  assert.equal(r.ok, true)
})

test('an expiring, disabled or rejected token fails, without printing it', async () => {
  for (const [answer, text] of [
    [() => reply(200, { status: 'active', expires_on: '2026-12-10T00:00:00Z' }), /expires in 12 days/],
    [() => reply(200, { status: 'disabled' }), /disabled/],
    [() => reply(401, null), /HTTP 401/],
  ]) {
    const r = await run(answer)
    assert.equal(r.ok, false)
    assert.match(r.message, text)
    assert.doesNotMatch(r.message, /secret-value/)
  }
  assert.equal((await checkToken({}, { now })).ok, false)
})

test('an empty answer from one endpoint falls through to the other', async () => {
  const r = await run((url) => (url.includes('/user/') ? reply(200, { status: 'active' }) : reply(200, null)))
  assert.deepEqual(r, { ok: true, message: 'active, no expiry' })
})
