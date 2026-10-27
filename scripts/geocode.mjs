// Street-level coordinates for bars, resolved at build time and cached in mapdata/geocache.json.
//
// Order: one US Census batch request for every address not already cached, then Nominatim
// (structured search, at most 1 request per second) for Census no-matches, ties and rejections,
// then the ZIP centroid (src "zip"). Every geocode must pass plausibility checks first: same state
// as the address and no more than MAX_MI from the address's ZIP centroid. Rejections are logged.
//
// Only public business street addresses are sent: street, city, state, ZIP. No other data.
// The cache is keyed by place_id and stores the address string used, so a rebuild only geocodes
// bars that are new or whose address changed; a normal rebuild makes no geocoding calls.
import { readFile, writeFile } from 'node:fs/promises'

const UA = 'KavaCrawl-build/1.0'
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const MAX_MI = 8
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (x) => Math.round(x * 1e5) / 1e5

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// "7550 Mission Hills Dr #310, Naples, FL 34119, USA" -> parts. Null if the address has no state and ZIP.
export function parseAddress(formatted) {
  const s = (formatted || '').replace(/,\s*USA\s*$/, '').trim()
  const m = /^(.*),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(s)
  if (!m) return null
  // Some street lines lead with a landmark ("Fountain Plaza ..., 245 Sebastian Blvd"); keep the numbered part.
  const parts = m[1].split(',').map((x) => x.trim()).filter(Boolean)
  const i = parts.findLastIndex((x) => /^\d/.test(x))
  const street = (i >= 0 ? parts.slice(i) : parts).join(', ')
  const [city, st, zip] = [m[2].trim(), m[3], m[4]]
  return { addr: `${street}, ${city}, ${st} ${zip}`, street, city, st, zip }
}

// Unit designators ("#310", "ste. B6", "Suite 4") confuse Nominatim; the building is what matters.
const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' }
const stateName = (st) => STATE_NAMES[st] || st
const noUnit = (street) => street.replace(/\s*(?:,\s*)?(?:#|\b(?:ste|suite|unit|bldg|building|apt)\b\.?)\s*[\w-]+.*$/i, '').trim() || street

function csvField(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }

function parseCsvLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

// Accepts a candidate only if it is in the address's state and near its ZIP centroid.
function check(e, cand, zipC, log) {
  if (cand.st && cand.st !== e.st) { log.push(`${e.id} ${cand.src}: state ${cand.st} != ${e.st} (${e.addr})`); return false }
  if (!cand.st) { log.push(`${e.id} ${cand.src}: no state in result (${e.addr})`); return false }
  if (zipC) {
    const d = miles([cand.lat, cand.lng], zipC)
    if (d > MAX_MI) { log.push(`${e.id} ${cand.src}: ${d.toFixed(1)} mi from ZIP ${e.zip} centroid (${e.addr})`); return false }
  }
  return true
}

async function censusBatch(entries) {
  const csv = entries.map((e, i) => [String(i), e.street, e.city, e.st, e.zip].map(csvField).join(',')).join('\n') + '\n'
  const fd = new FormData()
  fd.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv')
  fd.append('benchmark', 'Public_AR_Current')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(CENSUS, { method: 'POST', body: fd, headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const out = new Map()
      for (const line of (await res.text()).split(/\r?\n/)) {
        if (!line.trim()) continue
        const f = parseCsvLine(line)
        const e = entries[Number(f[0])]
        if (!e) continue
        const r = { status: f[2], type: f[3] || null }
        if (f[2] === 'Match' && f[5]) {
          const [lng, lat] = f[5].split(',').map(Number)
          const parts = (f[4] || '').split(',').map((s) => s.trim())
          Object.assign(r, { lat, lng, st: parts[parts.length - 2] || null })
        }
        out.set(e.id, r)
      }
      return out
    } catch (err) {
      console.log('census batch failed:', err.message, attempt < 2 ? '(retrying)' : '')
      await sleep(5000)
    }
  }
  return new Map()
}

let lastNominatim = 0
async function nominatim(params) {
  const wait = lastNominatim + 1100 - Date.now()
  if (wait > 0) await sleep(wait)
  lastNominatim = Date.now()
  const q = new URLSearchParams({ ...params, country: 'United States', countrycodes: 'us', format: 'jsonv2', addressdetails: '1', limit: '1' })
  try {
    const res = await fetch(`${NOMINATIM}?${q}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) { console.log('nominatim HTTP', res.status); return null }
    const j = await res.json()
    if (!j[0]) return null
    const iso = j[0].address?.['ISO3166-2-lvl4'] || ''
    return { lat: Number(j[0].lat), lng: Number(j[0].lon), st: iso.startsWith('US-') ? iso.slice(3) : null, type: j[0].addresstype || j[0].type || null }
  } catch (err) {
    console.log('nominatim failed:', err.message)
    return null
  }
}

// entries: [{ id, addr, street, city, st, zip }]. zipOf(zip) -> [lat, lng] or undefined.
// Returns Map id -> { lat, lng, src: 'census'|'nominatim'|'zip'|null, match, addr } and writes the cache.
export async function geocodeAll(entries, zipOf, cachePath) {
  let cache = {}
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')) } catch { /* first run */ }
  const todo = entries.filter((e) => cache[e.id]?.addr !== e.addr)
  const rejected = []
  const stats = { cached: entries.length - todo.length, census: 0, nominatim: 0, zip: 0, none: 0, calls: 0 }

  if (todo.length) {
    console.log(`geocoding ${todo.length} addresses (${stats.cached} cached)`)
    stats.calls++
    const census = await censusBatch(todo)
    for (const e of todo) {
      const zipC = zipOf(e.zip)
      const c = census.get(e.id)
      if (c?.lat != null && check(e, { ...c, src: `census ${c.type}` }, zipC, rejected)) {
        cache[e.id] = { lat: round(c.lat), lng: round(c.lng), src: 'census', match: c.type, addr: e.addr }
        stats.census++
        continue
      }
      let hit = null
      const tries = [
        { street: noUnit(e.street), city: e.city, state: stateName(e.st), postalcode: e.zip },
        { street: noUnit(e.street), city: e.city, state: stateName(e.st) },
        { street: noUnit(e.street), state: stateName(e.st), postalcode: e.zip },
      ]
      for (const t of tries) {
        stats.calls++
        const n = await nominatim(t)
        if (n && check(e, { ...n, src: 'nominatim' }, zipC, rejected)) { hit = n; break }
      }
      if (hit) {
        cache[e.id] = { lat: round(hit.lat), lng: round(hit.lng), src: 'nominatim', match: hit.type, addr: e.addr }
        stats.nominatim++
      } else if (zipC) {
        cache[e.id] = { lat: zipC[0], lng: zipC[1], src: 'zip', match: c ? `census ${c.status}` : null, addr: e.addr }
        stats.zip++
      } else {
        cache[e.id] = { lat: null, lng: null, src: null, match: null, addr: e.addr }
        stats.none++
      }
    }
    const sorted = Object.fromEntries(Object.keys(cache).sort().map((k) => [k, cache[k]]))
    await writeFile(cachePath, JSON.stringify(sorted, null, 1) + '\n')
  }
  if (rejected.length) console.log('rejected geocodes:\n  ' + rejected.join('\n  '))
  console.log('geocode', JSON.stringify(stats))
  return new Map(entries.map((e) => [e.id, cache[e.id]]))
}
