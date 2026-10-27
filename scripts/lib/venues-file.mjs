// Decides whether build-data may write mapdata/venues.json.
// - No ranked rows means the rankings fetch failed: refuse, keep the old file.
// - Same rows as the existing file (ignoring the top-level generated date): skip the rewrite.
import { sameNumbers } from './guard.mjs'

export function planVenuesWrite(rankedCount, prev, next) {
  if (!(rankedCount > 0)) return { action: 'refuse', reason: 'the rankings API returned no bars; treating it as a failed fetch' }
  if (sameNumbers(prev, next)) return { action: 'unchanged' }
  return { action: 'write' }
}
