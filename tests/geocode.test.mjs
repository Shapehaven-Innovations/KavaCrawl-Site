import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { geocodeAll } from '../scripts/geocode.mjs'

const entry = { id: 'p1', addr: '1 Main St, Tampa, FL 33602', street: '1 Main St', city: 'Tampa', st: 'FL', zip: '33602' }
const zipOf = () => [27.95, -82.45]

async function geocode(t, censusReply, nominatimReply) {
  t.mock.method(globalThis, 'fetch', async (url) => (String(url).includes('census') ? censusReply() : nominatimReply()))
  const cache = join(mkdtempSync(join(tmpdir(), 'geo-')), 'cache.json')
  const out = await geocodeAll([entry], zipOf, cache, { pause: async () => {} })
  return { hit: out.get('p1'), saved: JSON.parse(readFileSync(cache, 'utf8')).p1 }
}
const noMatch = () => new Response('"0","x","No_Match"\n')
const empty = () => new Response('[]')
const down = () => new Response('down', { status: 503 })
const reset = () => { throw new TypeError('fetch failed') }

test('a ZIP centroid is cached when both geocoders answered with no match', async (t) => {
  const r = await geocode(t, noMatch, empty)
  assert.equal(r.hit.src, 'zip')
  assert.equal(r.saved.src, 'zip')
})

for (const [name, census, nominatim] of [['Census', reset, empty], ['Nominatim', noMatch, down], ['both', down, reset]]) {
  test(`an outage (${name}) gives a ZIP centroid for this run only, so it is retried`, async (t) => {
    const r = await geocode(t, census, nominatim)
    assert.equal(r.hit.src, 'zip')
    assert.equal(r.saved, undefined)
  })
}
