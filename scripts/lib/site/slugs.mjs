// Stable URL paths for bar pages. slugs.json (place_id -> path) is append-only: a path, once assigned,
// is never changed or given to another bar, even after a rename or the bar leaving the list.

/** Kebab-case ASCII: diacritics stripped, "&" -> "and", apostrophes dropped. "" when nothing is left. */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** First 6 chars of the lowercased place_id after its "ChIJ" prefix. */
export function collisionSuffix(placeId) {
  return String(placeId).toLowerCase().replace(/^chij/, '').slice(0, 6)
}

const sortedObject = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

/**
 * bars: [{place_id, name, state, city}]. existing: slugs.json contents. Returns the merged map, keys sorted.
 * New bars are assigned in place_id order so the result does not depend on input order; on a collision
 * the path gets "-{suffix}", then "-{suffix}-2", "-{suffix}-3"... if even that is taken.
 */
export function assignPaths(bars, existing) {
  const out = { ...existing }
  const taken = new Set(Object.values(out))
  const fresh = bars.filter((b) => !Object.hasOwn(out, b.place_id)).sort((a, b) => (a.place_id < b.place_id ? -1 : a.place_id > b.place_id ? 1 : 0))
  for (const b of fresh) {
    if (Object.hasOwn(out, b.place_id)) continue // duplicate in input
    const base = `/bars/${String(b.state).toLowerCase()}/${slugify(b.city)}/`
    const name = slugify(b.name) || 'kava-bar'
    let path = `${base}${name}/`
    if (taken.has(path)) {
      const stem = `${name}-${collisionSuffix(b.place_id)}`
      path = `${base}${stem}/`
      for (let n = 2; taken.has(path); n++) path = `${base}${stem}-${n}/`
    }
    out[b.place_id] = path
    taken.add(path)
  }
  return sortedObject(out)
}
