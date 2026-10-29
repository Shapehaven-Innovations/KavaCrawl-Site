// Pure field normalizers for the bar pages: phone, address, hours, time zone, distance.
// Every function returns null (never throws) when its input cannot be trusted, so the caller can exclude
// the bar or omit the section.

/** US/Canada phone to E.164 plus "(813) 555-0100" display. Extensions are ignored; anything else is null. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null
  // Drop an extension: "ext", "ext.", "x", "#" or ";ext=" and everything after it.
  const main = raw.split(/\s*(?:;\s*ext\s*=|\bext\.?|\bx|#)\s*\d*\s*$/i)[0]
  let digits = main.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1)
  if (digits.length !== 10) return null
  return { e164: `+1${digits}`, display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` }
}

const COUNTRY = /^(?:USA|US|U\.S\.A?\.?|United States(?: of America)?)$/i
const STATE_ZIP = /^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/

/** "123 Sample St, Tampa, FL 33602, USA" -> parts. Null when the state or the city cannot be read. */
export function addressParts(formatted) {
  if (typeof formatted !== 'string') return null
  const parts = formatted.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length && COUNTRY.test(parts[parts.length - 1])) parts.pop()
  if (parts.length < 2) return null
  const m = STATE_ZIP.exec(parts[parts.length - 1])
  if (!m || !Object.hasOwn(STATE_ZONE, m[1])) return null
  const city = parts[parts.length - 2]
  if (!city || /\d{5}/.test(city)) return null
  return { street: parts.slice(0, -2).join(', '), city, state: m[1], zip: m[2] ?? '' }
}

function hhmm(t) {
  if (typeof t !== 'string' || !/^\d{4}$/.test(t)) return null
  const h = Number(t.slice(0, 2))
  const m = Number(t.slice(2))
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null
  return `${t.slice(0, 2)}:${t.slice(2)}`
}

const isDay = (d) => Number.isInteger(d) && d >= 0 && d <= 6

/**
 * Google `periods` JSON (an array, or an object with a `periods` array) to [{day, open, close}] with
 * HH:MM times, day 0 = Sunday, sorted by day then open. An overnight period keeps close < open. The
 * always-open shape (one period, open day 0 at 0000, no close) becomes 00:00-24:00 for all seven days.
 * Null on null, unparsable, empty or any malformed period.
 */
export function normalizeHours(hoursJson) {
  if (typeof hoursJson !== 'string' || !hoursJson.trim()) return null
  let data
  try { data = JSON.parse(hoursJson) } catch { return null }
  const periods = Array.isArray(data) ? data : data?.periods
  if (!Array.isArray(periods) || periods.length === 0) return null

  if (periods.length === 1 && !periods[0]?.close && periods[0]?.open?.day === 0 && periods[0]?.open?.time === '0000') {
    return [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' }))
  }

  const out = []
  for (const p of periods) {
    if (!isDay(p?.open?.day) || !isDay(p?.close?.day)) return null
    const open = hhmm(p.open.time)
    const close = hhmm(p.close.time)
    if (!open || !close) return null
    out.push({ day: p.open.day, open, close })
  }
  out.sort((a, b) => a.day - b.day || (a.open < b.open ? -1 : a.open > b.open ? 1 : 0))
  return out
}

// Time zones, ported as data from KavaCrawl/kava-proxy/tz-infer.js (keep the two in step).
const EASTERN = 'America/New_York'
const CENTRAL = 'America/Chicago'
const MOUNTAIN = 'America/Denver'
const PACIFIC = 'America/Los_Angeles'

// Dominant zone per state. Split states are refined by longitude below.
const STATE_ZONE = {
  CT: EASTERN, DE: EASTERN, DC: EASTERN, FL: EASTERN, GA: EASTERN, ME: EASTERN, MD: EASTERN, MA: EASTERN,
  MI: EASTERN, NH: EASTERN, NJ: EASTERN, NY: EASTERN, NC: EASTERN, OH: EASTERN, PA: EASTERN, RI: EASTERN,
  SC: EASTERN, VT: EASTERN, VA: EASTERN, WV: EASTERN, IN: EASTERN, KY: EASTERN, TN: EASTERN,
  AL: CENTRAL, AR: CENTRAL, IL: CENTRAL, IA: CENTRAL, LA: CENTRAL, MN: CENTRAL, MS: CENTRAL, MO: CENTRAL,
  OK: CENTRAL, WI: CENTRAL, TX: CENTRAL, KS: CENTRAL, NE: CENTRAL, ND: CENTRAL, SD: CENTRAL,
  CO: MOUNTAIN, MT: MOUNTAIN, NM: MOUNTAIN, UT: MOUNTAIN, WY: MOUNTAIN, ID: MOUNTAIN,
  AZ: 'America/Phoenix',
  CA: PACIFIC, NV: PACIFIC, OR: PACIFIC, WA: PACIFIC,
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
}

// state -> [longitude west of which the zone is the other one, that zone]
const LNG_SPLIT = {
  FL: [-85.0, CENTRAL],   // Pensacola -87.2 Central, Tallahassee -84.3 Eastern
  TN: [-85.45, CENTRAL],  // Cookeville -85.5 Central, Chattanooga -85.3 Eastern
  KY: [-86.0, CENTRAL],   // Bowling Green -86.44 Central, Louisville -85.76 Eastern
  MI: [-87.6, CENTRAL],
  TX: [-104.0, MOUNTAIN], // El Paso -106.4 Mountain
  KS: [-101.6, MOUNTAIN], NE: [-101.0, MOUNTAIN],
  ND: [-101.0, MOUNTAIN], // Mandan -100.9 Central, Dickinson -102.8 Mountain
  SD: [-100.4, MOUNTAIN],
}

/** IANA zone for a US state at a point; null for an unknown state. */
export function zoneOf(state, lng, lat) {
  const base = Object.hasOwn(STATE_ZONE, state) ? STATE_ZONE[state] : null
  if (!base) return null
  const hasLng = Number.isFinite(lng)
  const hasLat = Number.isFinite(lat)
  // Indiana is Eastern except the Chicago corner (NW) and the Evansville corner (SW), both west of -86.9.
  if (state === 'IN') return hasLng && hasLat && lng < -86.9 && (lat > 41.0 || lat < 38.5) ? CENTRAL : base
  // Northern Idaho (Coeur d'Alene, Lewiston) is Pacific; the rest is Mountain.
  if (state === 'ID') return hasLat && lat > 46.0 ? PACIFIC : base
  // Eastern Oregon (Malheur County) is Mountain; Burns and Baker City stay Pacific.
  if (state === 'OR') return hasLng && hasLat && lat < 44.3 && lng > -118.7 ? MOUNTAIN : base
  const split = LNG_SPLIT[state]
  if (split && hasLng && lng < split[0]) return split[1]
  return base
}

const EARTH_RADIUS_MI = 3958.8
const rad = (d) => (d * Math.PI) / 180

/** Great-circle (haversine) distance in miles. */
export function milesBetween(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)))
}
