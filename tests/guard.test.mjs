import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTotals, sameNumbers } from '../scripts/lib/guard.mjs'

test('checkTotals passes with no previous total', () => {
  assert.equal(checkTotals(null, 5).ok, true)
})

test('checkTotals refuses a zero total', () => {
  const r = checkTotals(100, 0)
  assert.equal(r.ok, false)
  assert.ok(r.reason)
  assert.equal(checkTotals(null, 0).ok, false)
})

test('checkTotals refuses a drop of more than 30%', () => {
  assert.equal(checkTotals(100, 69).ok, false)
  assert.equal(checkTotals(100, 70).ok, true)
  assert.equal(checkTotals(100, 150).ok, true)
})

test('sameNumbers ignores only the top-level generated field', () => {
  const a = { generated: '2026-10-26', totals: { venues: 3 }, list: [{ generated: 'x', n: 1 }] }
  const b = { generated: '2026-10-27', totals: { venues: 3 }, list: [{ generated: 'x', n: 1 }] }
  assert.equal(sameNumbers(a, b), true)
  assert.equal(sameNumbers(a, { ...b, totals: { venues: 4 } }), false)
  assert.equal(sameNumbers(a, { ...b, list: [{ generated: 'y', n: 1 }] }), false)
  assert.equal(sameNumbers(a, null), false)
})
