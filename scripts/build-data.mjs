// Snapshots public KavaCrawl data into mapdata/venues.json for the landing page map.
// Usage: node scripts/build-data.mjs <path to menu_pipeline/venues.json>
//
// - Ranked bars come from /rankings (Index score, shell price). Every other bar in the pipeline list
//   is read from /venues/:id (shell price only).
// - Every bar is placed by geocoding its street address at build time (scripts/geocode.mjs, cached in
//   mapdata/geocache.json): US Census first, then Nominatim, then the ZIP centroid. Only ZIP-centroid rows
//   carry approx:true. A ranked bar whose address cannot be geocoded keeps the API's lat_r/lng_r.
//   Each row's geo field names the source: census, nominatim, zip or lat_r.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { geocodeAll, parseAddress } from './geocode.mjs'

const API = 'https://api.kavacrawl.shapehaveninnovations.com'
const STATES = 'AZ,CA,CO,FL,MD,ME,MI,MO,NC,OH,OR,PA,SC,TX,WA,WI'.split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const here = (p) => new URL(p, import.meta.url)

async function get(path) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(API + path, { headers: { 'User-Agent': 'KavaCrawl-build/1.0' } })
    if (res.ok) return res.json()
    if (res.status === 429) { await sleep(5000); continue }
    return null
  }
  return null
}

const pipeline = JSON.parse(await readFile(process.argv[2], 'utf8'))
const zj = JSON.parse(await readFile(here('../mapdata/zips.json'), 'utf8'))
const zip = new Map(zj.z.map((r) => [r[0], [r[1] / 100, r[2] / 100]]))

// Ranked bars missing from the pipeline list only have a region label (for example "Space Coast"),
// so take the real city from the nearest ZIP centroid.
function nearestCity(lat, lng) {
  let best = null, bd = Infinity
  for (const r of zj.z) {
    const d = (r[1] / 100 - lat) ** 2 + ((r[2] / 100 - lng) * Math.cos(lat * Math.PI / 180)) ** 2
    if (d < bd) { bd = d; best = r }
  }
  return zj.c[best[3]]
}

// The pipeline's own city field is sometimes a region label, so prefer the city in the street address.
const addrCity = (p) => /,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/.exec(p?.formatted_address || '')?.[1]?.trim()

// Street line only (no city, state or ZIP): tells same-name stores in one city apart, such as chain locations.
const street = (p) => (p?.formatted_address || '').split(',')[0].trim() || null

const pipeById = new Map(pipeline.map((p) => [p.place_id, p]))

const ranked = []
for (const st of STATES) {
  const j = await get(`/rankings?state=${st}`)
  for (const v of j?.venues ?? []) if (v.lat_r != null) ranked.push(v)
  await sleep(300)
}
console.log('ranked', ranked.length)

// Geocode every pipeline address (cached; only new or changed addresses reach the network).
const entries = pipeline.map((p) => {
  const a = parseAddress(p.formatted_address)
  return a && { id: p.place_id, ...a }
}).filter(Boolean)
const geo = await geocodeAll(entries, (z) => zip.get(z), fileURLToPath(here('../mapdata/geocache.json')))
const located = (id) => { const g = geo.get(id); return g && (g.src === 'census' || g.src === 'nominatim') ? g : null }

const byId = new Map()
const latrFallback = []
for (const v of ranked) {
  const g = located(v.place_id)
  if (!g) latrFallback.push(`${v.place_id} ${v.name}`)
  byId.set(v.place_id, {
    id: v.place_id, name: v.name, city: addrCity(pipeById.get(v.place_id)) ?? nearestCity(v.lat_r, v.lng_r), metro: v.metro, addr: street(pipeById.get(v.place_id)), st: v.state,
    lat: g ? g.lat : v.lat_r, lng: g ? g.lng : v.lng_r, geo: g ? g.src : 'lat_r',
    idx: v.total, price: v.shell_price > 0 ? v.shell_price : null, updated: v.price_updated,
  })
}
if (latrFallback.length) console.log('ranked bars kept at API lat_r/lng_r (no plausible geocode):\n  ' + latrFallback.join('\n  '))

let approx = 0, skipped = 0
for (const p of pipeline) {
  if (byId.has(p.place_id)) continue
  const m = /,\s*([A-Z]{2})\s+(\d{5})/.exec(p.formatted_address || '')
  const g = geo.get(p.place_id)
  if (!m || !g || g.lat == null) { skipped++; continue }
  const d = await get(`/venues/${p.place_id}`)
  // Only real prices: a null, missing or non-numeric price must not become 0 in Math.min.
  const shells = (d?.prices?.items ?? []).filter((i) => i.category === 'kava_shell' && i.price != null)
    .map((i) => Number(i.price)).filter((p) => Number.isFinite(p) && p > 0)
  const row = {
    id: p.place_id, name: p.name, city: addrCity(p) ?? p.city, addr: street(p), metro: d?.metro ?? null, st: m[1], lat: g.lat, lng: g.lng,
  }
  if (g.src === 'zip') { row.approx = true; approx++ }
  row.geo = g.src
  Object.assign(row, {
    idx: d?.score?.ranked ? d.score.total : null,
    price: shells.length ? Math.min(...shells) : null,
    updated: shells.length ? d.prices.observed_on : null,
  })
  byId.set(p.place_id, row)
  await sleep(250)
}
const venues = [...byId.values()]
await writeFile(here('../mapdata/venues.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), venues }))
const bySrc = {}
for (const v of venues) bySrc[v.geo] = (bySrc[v.geo] || 0) + 1
console.log('total', venues.length, 'approx', approx, 'skipped (no geocode or zip)', skipped, 'by source', JSON.stringify(bySrc),
  'priced', venues.filter((v) => v.price != null).length, 'ranked', venues.filter((v) => v.idx != null).length)
