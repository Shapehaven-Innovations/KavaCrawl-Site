import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STATE_NAMES } from '../scripts/lib/states.mjs'

const file = new URL('../mapdata/state-population.json', import.meta.url)

test('state population table covers every venue state', () => {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(typeof data.vintage, 'string')
  assert.ok(data.vintage.length > 0)
  assert.equal(typeof data.source, 'string')
  assert.ok(data.source.length > 0)
  for (const code of Object.keys(STATE_NAMES)) {
    const n = data.pop[code]
    assert.ok(Number.isInteger(n) && n > 0, `${code}: ${n}`)
  }
  assert.ok(data.pop.FL > data.pop.MD)
})
