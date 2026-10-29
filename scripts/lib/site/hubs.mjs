// Hub pages: /bars/ (landing), /bars/{st}/ (state), /bars/{st}/{city}/ (city), built to the approved hub mockups.
// Pure and deterministic: no clock, no dates printed, stable tie-breaks. Hubs exist for every rendered bar (so every
// breadcrumb target resolves) but list and count only admitted bars; a hub listing none is generated noindex with an
// honest empty line. Uses the bar page shell and bar.css, plus assets/hubs.css inlined on hub pages only. City pages
// with hours data also inline assets/bar-client.mjs + assets/hubs-client.mjs for the Open/Closed badges.
import { readFileSync } from 'node:fs'
import { documentShell, escapeHtml as e } from './render.mjs'
import { scriptJson, STATE_NAMES } from './jsonld.mjs'

const asset = (name) => readFileSync(new URL(`../../../assets/${name}`, import.meta.url), 'utf8')
const HUB_CSS = asset('hubs.css').trim()
// bar-client.mjs minus its own auto-run line (it would look for #bar-data), then hubs-client.mjs minus its import,
// so the badge runs the one shared openState / pillText.
const BAR_AUTORUN = /^if \(typeof document !== 'undefined'\) init\(document, new Date\(\)\)[ \t]*$/m
const barClient = asset('bar-client.mjs')
if (!BAR_AUTORUN.test(barClient)) throw new Error('bar-client.mjs auto-run line not found')
const HUB_CLIENT = [barClient.replace(BAR_AUTORUN, ''), asset('hubs-client.mjs').replace(/^import [^\n]*\n/gm, '')]
  .map((s) => s.replace(/^export /gm, '').trim())
  .join('\n\n')
if (/^\s*(import|export)\b/m.test(HUB_CLIENT)) throw new Error('hub client must not keep import/export lines')
if (/<\/?script|<!--/i.test(HUB_CLIENT) || /<\/style/i.test(HUB_CSS)) throw new Error('hubs.css / hub client must not contain <script, </script, <!-- or </style')

const ICON = {
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  call: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h2.3l1.2 3-1.6 1.1a8 8 0 0 0 4.5 4.5L11 9l3 1.2v2.3A1.5 1.5 0 0 1 12.5 14 11.5 11.5 0 0 1 2 3.5 1.5 1.5 0 0 1 3.5 2z"/></svg>',
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
const money = (n) => `$${n.toFixed(2)}`
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const word = (n, w, ws = `${w}s`) => (n === 1 ? w : ws)
const plural = (n, w, ws) => `${n} ${word(n, w, ws)}`
const segs = (path) => path.split('/').filter(Boolean) // ['bars', st, city, slug]
const stateKeyOf = (b) => segs(b.path)[1]
const cityKeyOf = (b) => segs(b.path)[2]
const stateName = (key) => STATE_NAMES[key.toUpperCase()] ?? key.toUpperCase()
const cityName = (list) => list.map((b) => b.city).sort()[0]
const indexOf = (b) => (isNum(b.index?.total) ? b.index.total : null)
const shells = (list) => list.map((b) => b.shell).filter(isNum)
const hasHours = (b) => Boolean(b.tz) && Array.isArray(b.hours) && b.hours.length > 0

function group(list, keyOf) {
  const m = new Map()
  for (const x of list) {
    const k = keyOf(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}

const minOrNull = (nums) => (nums.length ? Math.min(...nums) : null)

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 100) / 100
}

// ---------- aggregates (pure; callers pass admitted bars only) ----------

/** Per city, sorted by state key, then name: { key, stateKey, name, state, count, cheapestShell, medianShell }. */
export function cityStats(bars) {
  return [...group(bars, (b) => `${stateKeyOf(b)}/${cityKeyOf(b)}`).values()]
    .map((list) => ({
      key: cityKeyOf(list[0]),
      stateKey: stateKeyOf(list[0]),
      name: cityName(list),
      state: stateKeyOf(list[0]).toUpperCase(),
      count: list.length,
      cheapestShell: minOrNull(shells(list)),
      medianShell: median(shells(list)),
    }))
    .sort((a, b) => cmp(a.stateKey, b.stateKey) || cmp(a.name, b.name) || cmp(a.key, b.key))
}

/** Per state, sorted by name: { key, code, name, count, cities, topCity (most bars; tie: name asc), cheapestShell }. */
export function stateStats(bars) {
  return [...group(bars, stateKeyOf).entries()]
    .map(([key, list]) => {
      const cities = cityStats(list)
      const top = [...cities].sort((a, b) => b.count - a.count || cmp(a.name, b.name) || cmp(a.key, b.key))[0]
      return { key, code: key.toUpperCase(), name: stateName(key), count: list.length, cities: cities.length, topCity: top.name, cheapestShell: minOrNull(shells(list)) }
    })
    .sort((a, b) => cmp(a.name, b.name) || cmp(a.key, b.key))
}

/** { bars, states, cities } counts. */
export function nationalStats(bars) {
  return {
    bars: bars.length,
    states: new Set(bars.map(stateKeyOf)).size,
    cities: new Set(bars.map((b) => `${stateKeyOf(b)}/${cityKeyOf(b)}`)).size,
  }
}

/** Up to n bars with a shell price, lowest first; ties by place_id. */
export function cheapestBars(bars, n = 4) {
  return bars.filter((b) => isNum(b.shell)).sort((a, b) => a.shell - b.shell || cmp(a.place_id, b.place_id)).slice(0, n)
}

/** Up to n bars with an Index total, highest first; ties by place_id. */
export function topRated(bars, n = 3) {
  return bars.filter((b) => indexOf(b) != null).sort((a, b) => indexOf(b) - indexOf(a) || cmp(a.place_id, b.place_id)).slice(0, n)
}

/** Up to n largest cities by bar count across states: { key, stateKey, name, state, count }; ties by state, then name. */
export function popularCities(bars, n = 8) {
  return cityStats(bars)
    .map(({ key, stateKey, name, state, count }) => ({ key, stateKey, name, state, count }))
    .sort((a, b) => b.count - a.count || cmp(a.stateKey, b.stateKey) || cmp(a.name, b.name) || cmp(a.key, b.key))
    .slice(0, n)
}

// ---------- markup pieces (labels passed in are already escaped HTML) ----------

const crumbHtml = (items) => `<p class="crumb">${items.map(([name, href]) => (href ? `<a href="${e(href)}">${e(name)}</a>` : e(name))).join(' &rsaquo; ')}</p>`
const score = (b) => (indexOf(b) != null ? `<span class="score" title="KavaCrawl Index">${Math.round(indexOf(b))}</span>` : '')
const countSmall = (n) => (n ? plural(n, 'bar') : 'No bars yet')
const sech = (id, h, p) => `<div class="sech"><h2 id="${id}">${h}</h2><p>${p}</p></div>`
const byCount = (a, b) => b.count - a.count || cmp(a.name, b.name) || cmp(a.key, b.key)

function hero({ crumbs, h1, lead, tiles, empty }) {
  const shown = tiles.filter(([v]) => v != null)
  const stats = shown.length
    ? `\n      <div class="stats${shown.length < 3 ? ` n${shown.length}` : ''}">\n${shown.map(([v, label]) => `        <div class="stat"><b>${v}</b><span>${label}</span></div>`).join('\n')}\n      </div>`
    : ''
  return `<header class="hub-head">
      ${crumbHtml(crumbs)}
      <h1>${h1}</h1>
      <p class="lead">${lead}</p>${empty ? '\n      <p class="sub empty">No bars listed here yet.</p>' : ''}${stats}
    </header>`
}

/** chips: [{ hot, href, label (html), small (html) }]. */
function chipsHtml(chips) {
  return `<ul class="chips">\n${chips.map((c) => `        <li${c.hot ? ' class="hot"' : ''}><a href="${e(c.href)}">${c.label}<small>${c.small}</small></a></li>`).join('\n')}\n      </ul>`
}

function azHtml(rows) {
  return `<ul class="az">\n${rows.map((r) => `        <li><a href="${e(r.href)}">${e(r.name)}<small>${r.small}</small></a></li>`).join('\n')}\n      </ul>`
}

const section = (cls, id, head, inner) => `<section class="${cls}" aria-labelledby="${id}">
      ${head}
      ${inner}
    </section>`
const grid = (cls, rows) => `<div class="${cls}">\n${rows.join('\n')}\n      </div>`

function page({ path, title, description, crumbs, selfName, items, body, listed, ctx, afterFooter = '' }) {
  const trail = [...crumbs.filter(([, href]) => href).map(([name, href]) => ({ name, path: href })), { name: selfName, path }]
  const graph = [
    {
      '@type': 'ItemList',
      name: title,
      numberOfItems: items.length,
      itemListElement: items.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: ctx.siteUrl + r.href })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: ctx.siteUrl + t.path })),
    },
  ]
  const indexable = listed > 0
  const main = `<main class="hub">\n    ${body.filter(Boolean).join('\n\n    ')}\n  </main>`
  const html = documentShell(title, description, path, main, {
    ...ctx,
    indexable,
    jsonLd: scriptJson({ '@context': 'https://schema.org', '@graph': graph }),
    extraCss: HUB_CSS,
    afterFooter,
  })
  return { path: path + 'index.html', html, indexable }
}

// ---------- pages ----------

function landingPage({ live, stateKeys, liveByState, ctx }) {
  const nat = nationalStats(live)
  const cards = stateStats(live).sort(byCount).map((s) => `        <a class="card" href="/bars/${e(s.key)}/"><span class="ab" aria-hidden="true">${e(s.code)}</span><span class="t">${e(s.name)}</span><span class="k">Most bars in <b>${e(s.topCity)}</b></span><span class="m">${isNum(s.cheapestShell) ? `<span class="from">shells from<b>${money(s.cheapestShell)}</b></span>` : ''}<span class="n"><b>${s.count}</b>${word(s.count, 'bar')}</span></span></a>`)
  const cheap = cheapestBars(live, 4).map((b) => `        <a class="fcard" href="${e(b.path)}">${score(b)}<span class="tp">${money(b.shell)}<small>shell</small></span><span class="tn">${e(b.name)}</span><span class="ts">${e(b.city)}, ${e(b.state)}</span></a>`)
  const popular = popularCities(live, 8).map((c, i) => ({ hot: i < 3, href: `/bars/${c.stateKey}/${c.key}/`, label: i < 3 ? `<b>${e(c.name)}</b>` : e(c.name), small: plural(c.count, 'bar') }))
  const az = stateKeys.map((k) => ({ name: stateName(k), href: `/bars/${k}/`, small: countSmall(liveByState(k)) }))
  // JSON-LD ItemList: only states with an admitted bar (their hubs are the indexable ones); the A-Z list shows all.
  const listedStates = stateKeys.filter((k) => liveByState(k) > 0).map((k) => ({ name: stateName(k), href: `/bars/${k}/` }))
  const crumbs = [['Home', '/'], ['Bars', null]]

  const body = [
    hero({
      crumbs,
      h1: 'Kava bars, <span class="hl">state by state.</span>',
      lead: 'Every bar we list, grouped by state and city, with shell prices and the KavaCrawl Index where we have them. Pick a state to drill down.',
      tiles: nat.bars ? [[nat.bars, word(nat.bars, 'bar listed', 'bars listed')], [nat.states, word(nat.states, 'state')], [nat.cities, word(nat.cities, 'city', 'cities')]] : [],
      empty: !nat.bars,
    }),
    cards.length ? section('sec', 'h-states', sech('h-states', 'Browse by state', 'Bars, busiest city and the lowest shell we know'), grid('cards', cards)) : '',
    cheap.length ? section('sec band', 'h-cheap', sech('h-cheap', 'Cheapest shell right now', 'Lowest listed shell price across every state'), grid('fcards', cheap)) : '',
    popular.length ? section('sec', 'h-cities', sech('h-cities', 'Popular cities', 'By number of bars listed'), chipsHtml(popular)) : '',
    section('sec panel', 'h-az', `<header><h2 id="h-az">All states A&ndash;Z</h2><p>${plural(nat.bars, 'bar')}</p></header>`, azHtml(az)),
  ]
  return page({
    path: '/bars/',
    title: 'Kava bars by state | KavaCrawl',
    description: nat.bars
      ? `Find kava bars near you: ${plural(nat.bars, 'bar')} across ${plural(nat.states, 'state')}, with hours, events and shell prices.`
      : 'Find kava bars near you. No bars are listed here yet.',
    crumbs,
    selfName: 'Kava bars by state',
    items: listedStates,
    body,
    listed: nat.bars,
    ctx,
  })
}

function statePage({ sk, cityGroups, live, total, stateKeys, liveByState, ctx }) {
  const sName = stateName(sk)
  const stats = cityStats(live)
  const byKey = new Map(stats.map((c) => [c.key, c]))
  // Every city with a rendered bar gets a card (its hub exists); counts and prices come from admitted bars only.
  const cities = [...cityGroups.entries()]
    .map(([ck, list]) => byKey.get(ck) ?? { key: ck, name: cityName(list), count: 0, cheapestShell: null, medianShell: null })
    .sort(byCount)
  const top = topRated(live, 4)
  const cheapest = minOrNull(shells(live))

  const cards = cities.map((c) => {
    const k = !c.count ? 'No bars listed yet' : isNum(c.medianShell) ? `Median shell <b>${money(c.medianShell)}</b>` : 'No listed prices yet'
    const from = isNum(c.cheapestShell) ? `<span class="from">shells from<b>${money(c.cheapestShell)}</b></span>` : ''
    const n = c.count ? `<span class="n"><b>${c.count}</b>${word(c.count, 'bar')}</span>` : ''
    const ab = c.count ? `<span class="ab" aria-hidden="true">${c.count}</span>` : ''
    return `        <a class="card" href="/bars/${e(sk)}/${e(c.key)}/">${ab}<span class="t">${e(c.name)}</span><span class="k">${k}</span>${from || n ? `<span class="m">${from}${n}</span>` : ''}</a>`
  })
  const topCards = top.map((b) => `        <a class="fcard rk" href="${e(b.path)}">${score(b)}<span class="tp">${e(b.name)}</span><span class="ts">${e(b.city)}${isNum(b.shell) ? ` &middot; ${money(b.shell)} shell` : ''}</span></a>`)
  const cheapChips = cheapestBars(live, 5).map((b, i) => ({ hot: i < 2, href: b.path, label: `<b>${money(b.shell)}</b>${e(b.name)}`, small: e(b.city) }))
  const others = stateKeys.filter((k) => k !== sk).map((k) => ({ name: stateName(k), href: `/bars/${k}/`, small: countSmall(liveByState(k)) }))
  const liveStates = stateKeys.filter((k) => liveByState(k) > 0).length
  const crumbs = [['All states', '/bars/'], [sName, null]]

  const body = [
    hero({
      crumbs,
      h1: `Kava bars in <span class="hl">${e(sName)}.</span>`,
      lead: live.length
        ? `${plural(live.length, 'kava bar')} across ${stats.length} ${e(sName)} ${word(stats.length, 'city', 'cities')}, with hours, events and shell prices. ${top.length ? 'Pick a city, or jump straight to the top-rated bars in the state.' : 'Pick a city to see every bar.'}`
        : `Every kava bar we list in ${e(sName)}, city by city.`,
      tiles: live.length
        ? [[live.length, `${word(live.length, 'bar')} in ${e(sName)}`], [stats.length, word(stats.length, 'city', 'cities')], [isNum(cheapest) ? money(cheapest) : null, 'cheapest shell']]
        : [],
      empty: !live.length,
    }),
    section('sec', 'h-cities', sech('h-cities', `Cities in ${e(sName)}`, 'Bars and the lowest shell we know in each'), grid('cards', cards)),
    topCards.length ? section('sec band', 'h-top', sech('h-top', `Top-rated in ${e(sName)}`, 'Highest KavaCrawl Index, statewide'), grid('fcards', topCards)) : '',
    cheapChips.length ? section('sec', 'h-cheap', sech('h-cheap', `Cheapest shells in ${e(sName)}`, 'Lowest listed price first'), chipsHtml(cheapChips)) : '',
    section('sec panel', 'h-more', `<header><h2 id="h-more">More states</h2><p>${plural(total, 'bar')} in ${plural(liveStates, 'state')}</p></header>`,
      azHtml([...others, { name: 'All states', href: '/bars/', small: plural(total, 'bar') }])),
  ]
  return page({
    path: `/bars/${sk}/`,
    title: `Kava bars in ${sName} | KavaCrawl`,
    description: live.length
      ? `${plural(live.length, 'kava bar')} in ${plural(stats.length, 'city', 'cities')} across ${sName}, with hours, events and shell prices.`
      : `Kava bars in ${sName}. No bars are listed here yet.`,
    crumbs,
    selfName: `Kava bars in ${sName}`,
    items: cities.map((c) => ({ name: c.name, href: `/bars/${sk}/${c.key}/` })),
    body,
    listed: live.length,
    ctx,
  })
}

/** One ranked bar card. The Call link is a sibling of the card link (never nested), only when there is a phone. */
function barCard(b, i) {
  const phone = b.phone?.e164 ? b.phone : null
  const k = b.street ? `<span class="k">${e(b.street)}</span>` : ''
  const pr = isNum(b.shell) ? `<span class="pr"><b>${money(b.shell)}</b><small>shell</small></span>` : '<span class="pr na"><b>No listed price</b></span>'
  const badge = hasHours(b) ? `<span class="badge" data-badge="${e(b.place_id)}" hidden></span>` : ''
  const foot = badge || score(b) || phone ? `<span class="foot">${badge}${score(b)}</span>` : ''
  const call = phone ? `\n          <a class="call" href="tel:${e(phone.e164)}" aria-label="Call ${e(b.name)}">${ICON.call}Call</a>` : ''
  return `        <li${phone ? ' class="tel"' : ''}>
          <a class="bcard" href="${e(b.path)}"><span class="t"><span class="rk">#${i + 1}</span>${e(b.name)}</span>${k}${pr}${foot}</a>${call}
        </li>`
}

function cityPage({ sk, ck, list, cName, stateLiveStats, stateLive, ctx }) {
  const sName = stateName(sk)
  const ST = sk.toUpperCase()
  const med = median(shells(list))
  const cheapest = minOrNull(shells(list))
  const chips = [
    ...stateLiveStats.filter((c) => c.key !== ck).sort(byCount)
      .map((c) => ({ hot: false, href: `/bars/${sk}/${c.key}/`, label: e(c.name), small: plural(c.count, 'bar') })),
    { hot: false, href: `/bars/${sk}/`, label: `All of ${e(sName)}`, small: countSmall(stateLive) },
  ]

  // Open/Closed badge data: listed (admitted) bars with a time zone and hours, keyed by place_id in sorted order.
  const blob = {}
  for (const b of [...list].sort((x, y) => cmp(x.place_id, y.place_id))) if (hasHours(b)) blob[b.place_id] = { tz: b.tz, hours: b.hours }
  const afterFooter = Object.keys(blob).length
    ? `<script type="application/json" id="hub-data">${scriptJson(blob)}</script>
<script type="module">
${HUB_CLIENT}
</script>
`
    : ''
  const crumbs = [['All states', '/bars/'], [sName, `/bars/${sk}/`], [cName, null]]

  const body = [
    hero({
      crumbs,
      h1: `Kava bars in <span class="hl">${e(cName)}, ${e(ST)}.</span>`,
      lead: list.length
        ? `${plural(list.length, 'kava bar')} in ${e(cName)}, ${e(sName)}, cheapest shell first, with hours, events and the KavaCrawl Index.`
        : `Every kava bar we list in ${e(cName)}, ${e(sName)}.`,
      tiles: list.length
        ? [[isNum(med) ? money(med) : null, `${e(cName)} median shell`], [isNum(cheapest) ? money(cheapest) : null, 'cheapest shell'], [list.length, word(list.length, 'bar listed', 'bars listed')]]
        : [],
      empty: !list.length,
    }),
    list.length
      ? section('sec', 'h-bars', sech('h-bars', `Every bar in ${e(cName)}`, 'Cheapest shell first; bars without a listed price last'), `<ul class="bars">\n${list.map(barCard).join('\n')}\n      </ul>`)
      : '',
    section('sec', 'h-other', sech('h-other', `Other cities in ${e(sName)}`, `${e(sName)} cities with bars listed`), chipsHtml(chips)),
    `<section class="cta-card" aria-label="Get the app">
      <div class="cta-copy">
        <span class="cta-tag">KavaCrawl for iPhone</span>
        <b>Set a budget, see every ${e(cName)} bar on the map.</b>
        <p>Price heat, bar density and a budget slider, all without an account.</p>
      </div>
      <div class="cta-act">
        <a class="btn go big" href="${e(ctx.appStoreUrl)}">Get the app ${ICON.arrow}</a>
        <small>Free on the App Store</small>
      </div>
    </section>`,
  ]
  return page({
    path: `/bars/${sk}/${ck}/`,
    title: `Kava bars in ${cName}, ${ST} | KavaCrawl`,
    description: list.length
      ? `${plural(list.length, 'kava bar')} in ${cName}, ${sName}, cheapest shell first, with hours, events and the KavaCrawl Index.`
      : `Kava bars in ${cName}, ${sName}. No bars are listed here yet.`,
    crumbs,
    selfName: `Kava bars in ${cName}, ${ST}`,
    items: list.map((b) => ({ name: b.name, href: b.path })),
    body,
    listed: list.length,
    ctx,
    afterFooter,
  })
}

/**
 * Hub pages: [{ path, html, indexable }] for '/bars/index.html', '/bars/{st}/index.html', '/bars/{st}/{city}/index.html'.
 * `bars` are all rendered bars (every breadcrumb target gets a page); only `admitted` ones are listed and counted.
 * A hub is indexable only when it lists at least one admitted bar; otherwise it is noindex.
 */
export function buildHubs(bars, admitted, ctx) {
  const out = []
  if (!bars.length) return out
  const isLive = (b) => admitted.has(b.place_id)
  const live = bars.filter(isLive)
  const states = group(bars, stateKeyOf)
  const stateKeys = [...states.keys()].sort((a, b) => cmp(stateName(a), stateName(b)) || cmp(a, b))
  const liveCount = new Map(stateKeys.map((k) => [k, states.get(k).filter(isLive).length]))
  const liveByState = (k) => liveCount.get(k) ?? 0

  out.push(landingPage({ live, stateKeys, liveByState, ctx }))
  for (const sk of stateKeys) {
    const inState = states.get(sk)
    const stateLiveBars = inState.filter(isLive)
    const cityGroups = group(inState, cityKeyOf)
    out.push(statePage({ sk, cityGroups, live: stateLiveBars, total: live.length, stateKeys, liveByState, ctx }))
    const stateLiveStats = cityStats(stateLiveBars)
    const cityKeys = [...cityGroups.keys()].sort((a, b) => cmp(cityName(cityGroups.get(a)), cityName(cityGroups.get(b))) || cmp(a, b))
    for (const ck of cityKeys) {
      const list = cityGroups.get(ck).filter(isLive).sort((a, b) =>
        (isNum(a.shell) ? 0 : 1) - (isNum(b.shell) ? 0 : 1) || (isNum(a.shell) && isNum(b.shell) ? a.shell - b.shell : 0)
        || cmp(a.name, b.name) || cmp(a.place_id, b.place_id))
      out.push(cityPage({ sk, ck, list, cName: cityName(cityGroups.get(ck)), stateLiveStats, stateLive: stateLiveBars.length, ctx }))
    }
  }
  return out
}
