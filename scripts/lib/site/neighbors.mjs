// Nearby bars: the cfg.neighbors nearest bars within cfg.radiusMiles (haversine), self excluded.
import { milesBetween } from './normalize.mjs'

/** bar, all: {place_id, lat, lng}. Returns [{place_id, miles}] by distance, then place_id ascending. */
export function nearest(bar, all, cfg) {
  const limit = cfg?.neighbors ?? 3
  const radius = cfg?.radiusMiles ?? 25
  const out = []
  for (const o of all) {
    if (o.place_id === bar.place_id) continue
    const miles = milesBetween(bar, o)
    if (miles <= radius) out.push({ place_id: o.place_id, miles })
  }
  out.sort((a, b) => a.miles - b.miles || (a.place_id < b.place_id ? -1 : a.place_id > b.place_id ? 1 : 0))
  return out.slice(0, limit)
}
