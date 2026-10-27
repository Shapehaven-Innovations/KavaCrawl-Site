import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planVenuesWrite } from '../scripts/lib/venues-file.mjs'

const rows = [{ id: 'a', st: 'FL', price: 5 }]

test('planVenuesWrite refuses when no ranked bars came back', () => {
  const r = planVenuesWrite(0, null, { generated: '2026-10-27', venues: rows })
  assert.equal(r.action, 'refuse')
  assert.match(r.reason, /no bars/)
})

test('planVenuesWrite skips a date-only change', () => {
  const prev = { generated: '2026-10-26', venues: rows }
  const next = { generated: '2026-10-27', venues: rows.map((v) => ({ ...v })) }
  assert.equal(planVenuesWrite(10, prev, next).action, 'unchanged')
})

test('planVenuesWrite writes when rows differ or there is no previous file', () => {
  const prev = { generated: '2026-10-26', venues: rows }
  assert.equal(planVenuesWrite(10, prev, { generated: '2026-10-27', venues: [{ ...rows[0], price: 6 }] }).action, 'write')
  assert.equal(planVenuesWrite(10, null, { generated: '2026-10-27', venues: rows }).action, 'write')
})
