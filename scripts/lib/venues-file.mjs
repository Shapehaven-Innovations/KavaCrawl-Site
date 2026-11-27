// Decides whether build-data may write mapdata/venues.json.
// - No ranked rows means the rankings fetch failed: refuse, keep the old file.
// - More than 30% fewer rows than the existing file: refuse, keep the old file.
// - Same rows as the existing file (ignoring the top-level generated date): skip the rewrite.
import { sameNumbers } from './guard.mjs'

export function planVenuesWrite(rankedCount, prev, next) {
  if (!(rankedCount > 0)) return { action: 'refuse', reason: 'the rankings API returned no bars; treating it as a failed fetch' }
  const before = prev?.venues?.length ?? 0
  if (before && next.venues.length < 0.7 * before) return { action: 'refuse', reason: `the venue list shrank from ${before} to ${next.venues.length} rows` }
  if (sameNumbers(prev, next)) return { action: 'unchanged' }
  return { action: 'write' }
}
