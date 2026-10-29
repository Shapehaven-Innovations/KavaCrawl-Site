// Rollout admission: which bar pages are indexable. Admitted bars stay admitted while they have a page;
// each run adds at most `max` new ones, Index total descending (null last), then place_id ascending.

const byAdmissionOrder = (a, b) => {
  const an = a.indexTotal == null
  const bn = b.indexTotal == null
  if (an !== bn) return an ? 1 : -1
  if (!an && a.indexTotal !== b.indexTotal) return b.indexTotal - a.indexTotal
  return a.place_id < b.place_id ? -1 : a.place_id > b.place_id ? 1 : 0
}

/** Returns alreadyAdmitted ∩ candidates (place_id order) followed by up to `max` new ids in admission order. */
export function admit(candidates, alreadyAdmitted, max) {
  const kept = candidates.filter((c) => alreadyAdmitted.has(c.place_id)).map((c) => c.place_id).sort()
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  const fresh = candidates.filter((c) => !alreadyAdmitted.has(c.place_id)).sort(byAdmissionOrder).slice(0, limit)
  return new Set([...kept, ...fresh.map((c) => c.place_id)])
}
