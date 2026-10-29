// schema.org JSON-LD for a bar page: BarOrPub (+ Event nodes for dated one-offs) and a BreadcrumbList.
// Only fields that exist are emitted. The returned text goes straight inside
// <script type="application/ld+json">, so every "<" is escaped as <.

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

/** "/bars/fl/tampa/kava-haven/" -> { statePath: "/bars/fl/", cityPath: "/bars/fl/tampa/" }. */
export function crumbPaths(path) {
  const seg = path.split('/').filter(Boolean)
  return { statePath: `/${seg[0]}/${seg[1]}/`, cityPath: `/${seg[0]}/${seg[1]}/${seg[2]}/` }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HHMM = /^\d{2}:\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** JSON for embedding in a script element: "<" (and the JS line separators) escaped. */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function postalAddress(bar) {
  const a = { '@type': 'PostalAddress' }
  if (bar.street) a.streetAddress = bar.street
  a.addressLocality = bar.city
  a.addressRegion = bar.state
  if (bar.zip) a.postalCode = bar.zip
  a.addressCountry = 'US'
  return a
}

/** One spec per distinct open/close pair, days in week order (Mon first), pairs in first-seen order. */
function openingHours(hours) {
  const groups = new Map()
  const order = [...hours].sort((a, b) => (a.day + 6) % 7 - (b.day + 6) % 7 || (a.open < b.open ? -1 : a.open > b.open ? 1 : 0))
  for (const h of order) {
    const closes = h.close === '24:00' ? '23:59' : h.close
    const key = `${h.open}-${closes}`
    if (!groups.has(key)) groups.set(key, { '@type': 'OpeningHoursSpecification', dayOfWeek: [], opens: h.open, closes })
    const g = groups.get(key)
    if (!g.dayOfWeek.includes(DAY_NAMES[h.day])) g.dayOfWeek.push(DAY_NAMES[h.day])
  }
  return [...groups.values()]
}

function menu(items) {
  return {
    '@type': 'Menu',
    hasMenuItem: items.map((it) => {
      const item = { '@type': 'MenuItem', name: it.name }
      if (typeof it.size_oz === 'number' && it.size_oz > 0) item.description = `${it.size_oz} oz`
      if (typeof it.price === 'number' && Number.isFinite(it.price)) {
        item.offers = { '@type': 'Offer', price: it.price.toFixed(2), priceCurrency: 'USD' }
      }
      return item
    }),
  }
}

function eventNode(ev, bar, barId) {
  const node = { '@type': 'Event', name: ev.title }
  const time = HHMM.test(ev.start_time ?? '') ? `T${ev.start_time}` : ''
  node.startDate = ev.start_date + time
  const endDay = DATE.test(ev.end_date ?? '') ? ev.end_date : ev.start_date
  if (HHMM.test(ev.end_time ?? '')) node.endDate = `${endDay}T${ev.end_time}`
  else if (DATE.test(ev.end_date ?? '') && ev.end_date !== ev.start_date) node.endDate = ev.end_date
  node.location = { '@type': 'Place', '@id': barId, name: bar.name, address: postalAddress(bar) }
  node.organizer = { '@id': barId }
  return node
}

/** The JSON-LD payload (text) for one bar page. */
export function barJsonLd(bar, siteUrl) {
  const url = siteUrl + bar.path
  const barId = `${url}#bar`
  const node = { '@type': 'BarOrPub', '@id': barId, name: bar.name, url }
  if (bar.phone?.e164) node.telephone = bar.phone.e164
  node.address = postalAddress(bar)
  if (Number.isFinite(bar.lat) && Number.isFinite(bar.lng)) node.geo = { '@type': 'GeoCoordinates', latitude: bar.lat, longitude: bar.lng }
  if (Array.isArray(bar.hours) && bar.hours.length) node.openingHoursSpecification = openingHours(bar.hours)
  if (bar.menu?.items?.length) node.hasMenu = menu(bar.menu.items)
  if (bar.website) node.sameAs = bar.website

  const { statePath, cityPath } = crumbPaths(bar.path)
  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: STATE_NAMES[bar.state] ?? bar.state, item: siteUrl + statePath },
      { '@type': 'ListItem', position: 2, name: bar.city, item: siteUrl + cityPath },
      { '@type': 'ListItem', position: 3, name: bar.name, item: url },
    ],
  }

  const events = (bar.events ?? [])
    .filter((ev) => !ev.is_recurring && DATE.test(ev.start_date ?? '') && typeof ev.title === 'string' && ev.title)
    .map((ev) => eventNode(ev, bar, barId))

  return scriptJson({ '@context': 'https://schema.org', '@graph': [node, crumbs, ...events] })
}
