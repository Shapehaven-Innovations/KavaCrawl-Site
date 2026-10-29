// Eligibility gate for a bar page, applied on top of the curated list (mapdata/venues.json).
import { normalizePhone, addressParts } from './normalize.mjs'
import { slugify } from './slugs.mjs'

const blank = (s) => typeof s !== 'string' || !s.trim()

/**
 * place: a row of SQL.places. curated: Set of curated place_ids.
 * Checks run in a fixed order, so a bar failing several reports the first:
 * not-curated, hidden, not-operational, no-address (also a blank name), no-coords, no-state-city.
 * Phone is optional: `phone` is the normalized { e164, display } or null when absent or unparsable.
 */
export function evaluate(place, curated) {
  if (!place || !curated.has(place.place_id)) return { ok: false, reason: 'not-curated' }
  if (Number(place.hidden) !== 0) return { ok: false, reason: 'hidden' }
  if (place.business_status !== 'OPERATIONAL') return { ok: false, reason: 'not-operational' }
  if (blank(place.formatted_address) || blank(place.name)) return { ok: false, reason: 'no-address' }
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return { ok: false, reason: 'no-coords' }
  const parts = addressParts(place.formatted_address)
  // A city that slugs to nothing (non-Latin only) cannot form a URL either.
  if (!parts || !slugify(parts.city)) return { ok: false, reason: 'no-state-city' }
  return { ok: true, parts, phone: normalizePhone(place.phone) }
}
