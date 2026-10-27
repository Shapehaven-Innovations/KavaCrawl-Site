// Refresh guards: refuse a total of 0, a drop of more than 30% or a rise of more
// than 2x from the previous file, and detect when a rebuilt file has the same numbers.
import { isDeepStrictEqual } from 'node:util'

export function checkTotals(prev, next) {
  if (!(next > 0)) return { ok: false, reason: `total is ${next}` }
  if (typeof prev === 'number' && prev > 0 && next < prev * 0.7) {
    return { ok: false, reason: `total dropped from ${prev} to ${next} (more than 30%)` }
  }
  if (typeof prev === 'number' && prev > 0 && next > prev * 2) {
    return { ok: false, reason: `total rise from ${prev} to ${next} (more than 2x)` }
  }
  return { ok: true }
}

const strip = (o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o
  const { generated, ...rest } = o
  return rest
}

export function sameNumbers(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return isDeepStrictEqual(strip(a), strip(b))
}
