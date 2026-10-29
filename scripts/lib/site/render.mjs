// One bar page (/bars/{st}/{city}/{slug}/) as a complete HTML document. Pure and deterministic: no clock,
// no randomness, no dates printed. CSS (assets/bar.css) and the client module (assets/bar-client.mjs) are
// inlined so the page makes no extra requests beyond the icon images. Every dynamic string goes through
// escapeHtml; JSON in script elements goes through scriptJson ("<" as <).
import { readFileSync } from 'node:fs'
import { barJsonLd, scriptJson, STATE_NAMES, crumbPaths } from './jsonld.mjs'
import { DAYS, fmtTime } from '../../../assets/bar-client.mjs'

const CSS = readFileSync(new URL('../../../assets/bar.css', import.meta.url), 'utf8').trim()
const CLIENT = readFileSync(new URL('../../../assets/bar-client.mjs', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
  .trim()
if (/<\/?script|<!--/i.test(CLIENT) || /<\/style/i.test(CSS)) throw new Error('bar.css / bar-client.mjs must not contain <script, </script, <!-- or </style')

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** HTML-escape any value for text or a double-quoted attribute; null/undefined become "". */
export function escapeHtml(v) {
  if (v == null) return ''
  return String(v).replace(/[&<>"']/g, (c) => ESC[c])
}

const e = escapeHtml
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon first, as the mockup
const money = (n) => `$${n.toFixed(2)}`
const isNum = (n) => typeof n === 'number' && Number.isFinite(n)
const hasItems = (a) => Array.isArray(a) && a.length > 0

const ICON = {
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  call: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h2.3l1.2 3-1.6 1.1a8 8 0 0 0 4.5 4.5L11 9l3 1.2v2.3A1.5 1.5 0 0 1 12.5 14 11.5 11.5 0 0 1 2 3.5 1.5 1.5 0 0 1 3.5 2z"/></svg>',
  directions: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 14.5 8 8 14.5 1.5 8z"/><path d="M6 9.5V7h3.5L8 5.5M9.5 7 8 8.5"/></svg>',
  web: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13"/></svg>',
}

/** A plain https Google Maps search URL pinned to the place_id (works in any browser and opens the app). */
function directionsUrl(bar) {
  const q = [bar.name, bar.street, bar.city, `${bar.state} ${bar.zip}`.trim()].filter(Boolean).join(', ')
  const p = new URLSearchParams({ api: '1', query: q, query_place_id: bar.place_id })
  return `https://www.google.com/maps/search/?${p}`
}

/** Events in display order (Mon first, then start time, as snapshot sorted the rest). */
function orderedEvents(events) {
  const key = (d) => (Number.isInteger(d) ? (d + 6) % 7 : 7)
  return [...(events ?? [])].map((ev, i) => [ev, i])
    .sort((a, b) => key(a[0].day_of_week) - key(b[0].day_of_week) || a[1] - b[1])
    .map(([ev]) => ev)
}

function timeRange(start, end, short) {
  const s = fmtTime(start, short)
  const t = fmtTime(end, short)
  return s && t ? `${s} &ndash; ${t}` : s
}

// ---------- sections ----------

function headerBlock(bar, { statePath, cityPath }, hasHours) {
  const stateName = STATE_NAMES[bar.state] ?? bar.state
  let status = ''
  if (!hasHours) status = '<div class="status"><span class="rbox na">Hours not listed yet</span></div>'
  else if (bar.tz) status = '<div class="status"><span class="pill" id="open-now" hidden></span></div>'
  const street = bar.street ? `<b>${e(bar.street)}</b><br>` : ''
  const locality = `${e(bar.city)}, ${e(bar.state)}${bar.zip ? ` ${e(bar.zip)}` : ''}`
  const website = bar.website
    ? `\n      <a class="btn ghost" href="${e(bar.website)}" rel="noopener">${ICON.web}Website</a>`
    : ''
  // Phone is optional (most curated bars have none): no Call button, no tel: link, no phone text then,
  // and Directions takes the primary (mint) button style instead of ghost.
  const phone = bar.phone?.e164 ? bar.phone : null
  const phoneLine = phone ? `<br><a href="tel:${e(phone.e164)}">${e(phone.display)}</a>` : ''
  const call = phone ? `\n      <a class="btn" href="tel:${e(phone.e164)}">${ICON.call}Call</a>` : ''
  return `<header class="bar-head">
    <p class="crumb"><a href="${e(statePath)}">${e(stateName)}</a> &rsaquo; <a href="${e(cityPath)}">${e(bar.city)}</a></p>
    <h1>${e(bar.name)}</h1>
    ${status}
    <p class="addr">${street}${locality}${phoneLine}</p>
    <div class="actions">${call}
      <a class="${phone ? 'btn ghost' : 'btn'}" href="${e(directionsUrl(bar))}" rel="noopener">${ICON.directions}Directions</a>${website}
    </div>
  </header>`
}

function hoursPanel(hours) {
  const rows = WEEK_ORDER.map((day) => {
    const periods = hours.filter((h) => h.day === day)
    let text
    if (!periods.length) text = '<span class="closed">Closed</span>'
    else if (periods.length === 1 && periods[0].open === '00:00' && periods[0].close === '24:00') text = '<span>Open 24 hours</span>'
    else text = `<span>${periods.map((p) => timeRange(p.open, p.close, false)).join(', ')}</span>`
    return `      <li data-day="${day}"><b>${DAYS[day]}</b>${text}</li>`
  })
  return `<section class="panel" id="hours" aria-labelledby="hours-h">
    <header><h2 id="hours-h">Hours</h2><p>Local time</p></header>
    <ul class="hours">
${rows.join('\n')}
    </ul>
  </section>`
}

function eventsPanel(events) {
  const weekly = events.every((ev) => ev.is_recurring)
  const rows = events.map((ev, i) => {
    const d = Number.isInteger(ev.day_of_week) ? DAYS[ev.day_of_week] : ''
    const sub = ev.is_recurring ? '' : '<span class="sub">One-time</span>'
    return `      <li data-i="${i}"><span class="d">${e(d)}</span><span><span class="nm">${e(ev.title)}</span>${sub}</span><span class="t">${timeRange(ev.start_time, ev.end_time, true)}</span></li>`
  })
  return `<section class="panel" id="events" aria-labelledby="events-h">
    <header><h2 id="events-h">Events</h2><p>${weekly ? 'Weekly, as posted by the bar' : 'As posted by the bar'}</p></header>
    <ul class="chips" id="tonight" aria-label="Tonight" hidden></ul>
    <ul class="events">
${rows.join('\n')}
    </ul>
  </section>`
}

function menuPanel(menu, shell) {
  const selIdx = shell == null ? -1
    : menu.items.findIndex((it) => it.category === 'kava_shell' && isNum(it.price) && Math.round(it.price * 100) === Math.round(shell * 100))
  const items = selIdx < 0 ? menu.items : [menu.items[selIdx], ...menu.items.filter((_, i) => i !== selIdx)]
  const rows = items.map((it, i) => {
    const sel = selIdx >= 0 && i === 0
    const subs = []
    if (isNum(it.size_oz) && it.size_oz > 0) subs.push(`${e(it.size_oz)} oz`)
    if (sel) {
      subs.push('The price the map uses')
    }
    const name = `<span class="nm">${e(it.name)}</span>`
    const label = subs.length ? `<span>${name}<span class="sub">${subs.join(' &middot; ')}</span></span>` : name
    const price = isNum(it.price) ? `<span class="price">${money(it.price)}</span>` : ''
    return `      <li${sel ? ' class="sel"' : ''}>${label}${price}</li>`
  })
  return `<section class="panel" id="menu" aria-labelledby="menu-h">
    <header><h2 id="menu-h">Menu</h2><p>Latest prices we have</p></header>
    <ul class="menu">
${rows.join('\n')}
    </ul>
  </section>`
}

const f1 = (n) => n.toFixed(1)

function sparkline(history) {
  const vals = history.map((h) => h.median)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pts = vals.map((v, i) => {
    const x = 4 + (i * 142) / (vals.length - 1)
    const y = hi === lo ? 22 : 32 - ((v - lo) / (hi - lo)) * 20
    return [f1(x), f1(y)]
  })
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} L146.0 44 L4.0 44 Z`
  const [lx, ly] = pts[pts.length - 1]
  const first = money(vals[0])
  const last = money(vals[vals.length - 1])
  return `<div class="stat">
      <div class="spark">
        <svg viewBox="0 0 150 44" role="img" aria-label="Shell price over the last six months, from ${first} to ${last}">
          <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ece8d" stop-opacity=".28"/><stop offset="1" stop-color="#6ece8d" stop-opacity="0"/></linearGradient></defs>
          <path d="${area}" fill="url(#sg)"/>
          <polyline points="${line}" fill="none" stroke="#6ece8d" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${lx}" cy="${ly}" r="3.5" fill="#6ece8d" stroke="#0b1d19" stroke-width="2"/>
          <text x="4" y="6" fill="#7d9a8c" font-size="9" font-family="ui-monospace,Menlo,monospace">${first}</text>
          <text x="146" y="42" fill="#9db8ac" font-size="9" text-anchor="end" font-family="ui-monospace,Menlo,monospace">${last}</text>
        </svg>
      </div>
      <span>Shell price, last 6 months</span>
    </div>`
}

function comparePanel(bar) {
  const stats = []
  const metro = bar.metro ? e(bar.metro) : ''
  if (bar.index && isNum(bar.index.total)) {
    stats.push(`<div class="stat"><b>${Math.round(bar.index.total)}</b><span>KavaCrawl Index</span></div>`)
  }
  if (bar.compare) {
    stats.push(`<div class="stat"><b>${e(bar.compare.rank)} <small>of ${e(bar.compare.total)}</small></b><span>Shell price rank in ${metro}, cheapest first</span></div>`)
  }
  if (isNum(bar.shell)) {
    let line = 'Lowest shell price on the menu'
    if (bar.compare) {
      const p = bar.compare.pctVsMetro
      const rel = p === 0 ? 'right at' : `${e(Math.abs(p))}% ${p < 0 ? 'under' : 'over'}`
      line = `Shell, <strong>${rel}</strong> the ${metro} median of ${money(bar.compare.metroMedianShell)}`
    }
    stats.push(`<div class="stat"><b>${money(bar.shell)}</b><span>${line}</span></div>`)
  }
  if (hasItems(bar.history) && bar.history.length >= 2) stats.push(sparkline(bar.history))
  if (stats.length % 2 === 1) stats[stats.length - 1] = stats[stats.length - 1].replace('<div class="stat">', '<div class="stat span2">')
  return `<section id="compare" aria-labelledby="compare-h">
    <div class="divider"><h2 class="cta-tag" id="compare-h">// how it compares</h2></div>
    <div class="cmp">
    ${stats.join('\n    ')}
    </div>
  </section>`
}

function knownPanel(bar) {
  const missing = ['Hours', 'Events', ...(isNum(bar.shell) ? [] : ['Shell price']), 'Menu']
  const score = bar.index ? '' : '\n      <div><span class="rbox na">Not yet scored</span></div>'
  return `<section class="panel" id="known" aria-labelledby="known-h">
    <header><h2 id="known-h">What we know</h2></header>
    <div class="unavail">
      <b>Hours, events and menu aren't listed yet</b>
      <p>We list only what we've checked. ${bar.phone?.e164 ? "Call ahead, or check the bar's own listing before you go." : "Check the bar's own listing before you go."}</p>
      <ul class="chips" aria-label="Missing details">${missing.map((m) => `<li>${m}</li>`).join('')}</ul>${score}
    </div>
  </section>`
}

function nearbyPanel(neighbors) {
  const rows = neighbors.map((n) => {
    const meta = [
      isNum(n.shell) ? `<span class="price">${money(n.shell)}</span>` : '',
      isNum(n.indexTotal) ? `<span class="score" title="KavaCrawl Index">${Math.round(n.indexTotal)}</span>` : '',
    ].join('')
    return `      <li><a href="${e(n.path)}"><span class="nm">${e(n.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}<span class="sub">${e(n.miles)} mi</span></a></li>`
  })
  return `<section class="panel near-panel" id="nearby" aria-labelledby="nearby-h">
    <header><h2 id="nearby-h">Nearby bars</h2><p>Closest, in a straight line</p></header>
    <ul class="near">
${rows.join('\n')}
    </ul>
  </section>`
}

function ctaCard(bar, appStoreUrl) {
  const thin = !isNum(bar.shell)
  const tag = thin ? '// help build the map' : '// take it with you'
  const head = thin ? `Been to ${e(bar.name)}? Add the shell price` : `See ${e(bar.name)} on the map`
  const copy = thin
    ? 'One price lights this bar up on the map for the next person.'
    : 'Set a budget, compare every bar nearby and get directions, all without an account.'
  return `<section class="cta-card">
    <div class="cta-copy">
      <div class="cta-tag">${tag}</div>
      <b>${head}</b>
      <p>${copy}</p>
    </div>
    <div class="cta-act">
      <a class="btn go big" href="${e(appStoreUrl)}">Open in KavaCrawl ${ICON.arrow}</a>
      <small>Free for iPhone</small>
    </div>
  </section>`
}

function describe(bar, has) {
  const where = [bar.street, bar.city].filter(Boolean).join(', ')
  const parts = []
  if (has.hours) parts.push('hours')
  if (has.events) parts.push('events')
  if (has.menu) parts.push('menu prices')
  if (bar.compare && bar.metro) parts.push(`how its shell price compares in ${bar.metro}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  const fallback = bar.phone?.e164 ? 'Call, get directions and see nearby kava bars.' : 'Get directions and see nearby kava bars.'
  const tail = list ? `See ${list}, plus nearby kava bars.` : fallback
  return `${bar.name} is a kava bar at ${where}, ${bar.state}. ${tail}`
}

/**
 * The shared document: head (title, description, robots, canonical, icons, social tags, inline CSS, JSON-LD),
 * the brand nav, `bodyHtml` (a complete <main>), the footer fragment, then optional `ctx.afterFooter`.
 * ctx: { siteUrl, appStoreUrl, footerFragment, indexable, jsonLd?: string (already scriptJson-safe), afterFooter?: string,
 * extraCss?: string (appended after bar.css in the same style element; hub pages only, bar pages pass none) }.
 */
export function documentShell(title, description, canonicalPath, bodyHtml, ctx) {
  const url = ctx.siteUrl + canonicalPath
  const robots = ctx.indexable ? '' : '\n<meta name="robots" content="noindex">'
  const image = `${ctx.siteUrl}/assets/lifestyle.png`
  const ld = ctx.jsonLd ? `\n<script type="application/ld+json">${ctx.jsonLd}</script>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">${robots}
<link rel="canonical" href="${e(url)}">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="apple-touch-icon" href="/assets/icon-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="KavaCrawl">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(image)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${e(image)}">
<style>
${CSS}${ctx.extraCss ? `\n${ctx.extraCss}` : ''}
</style>${ld}
</head>
<body>
<div class="wrap">
  <nav><a class="brand" href="/"><img src="/assets/icon.webp" alt="" width="40" height="40"><span class="wm">KavaCrawl</span></a><a class="btn go" href="${e(ctx.appStoreUrl)}">Get the app ${ICON.arrow}</a></nav>
  ${bodyHtml}
</div>
${ctx.footerFragment}${ctx.footerFragment.endsWith('\n') ? '' : '\n'}${ctx.afterFooter ?? ''}</body>
</html>
`
}

/** Full HTML document for one bar. ctx: { siteUrl, appStoreUrl, footerFragment, indexable }. */
export function renderBar(bar, ctx) {
  const events = orderedEvents(bar.events)
  const has = {
    hours: hasItems(bar.hours),
    events: events.length > 0,
    menu: hasItems(bar.menu?.items),
    compare: Boolean(bar.index || bar.compare || isNum(bar.shell) || (hasItems(bar.history) && bar.history.length >= 2)),
  }
  const none = !has.hours && !has.events && !has.menu && !has.compare
  const title = `${bar.name} in ${bar.city}, ${bar.state} | KavaCrawl`
  const description = describe(bar, has)

  const stack = [
    has.hours ? hoursPanel(bar.hours) : '',
    has.events ? eventsPanel(events) : '',
    has.menu ? menuPanel(bar.menu, bar.shell) : '',
    none ? knownPanel(bar) : '',
  ].filter(Boolean)

  const body = [
    headerBlock(bar, crumbPaths(bar.path), has.hours),
    stack.length ? `<div class="stack">\n  ${stack.join('\n  ')}\n  </div>` : '',
    has.compare ? comparePanel(bar) : '',
    hasItems(bar.neighbors) ? nearbyPanel(bar.neighbors) : '',
    ctaCard(bar, ctx.appStoreUrl),
  ].filter(Boolean)

  const data = scriptJson({
    tz: bar.tz ?? null,
    hours: has.hours ? bar.hours : null,
    events: events.map((ev) => ({
      day: Number.isInteger(ev.day_of_week) ? ev.day_of_week : null,
      start: ev.start_time ?? null,
      end: ev.end_time ?? null,
      is_recurring: Boolean(ev.is_recurring),
      start_date: ev.start_date ?? null,
      end_date: ev.end_date ?? null,
    })),
  })

  return documentShell(title, description, bar.path, `<main class="bar${none ? ' thin' : ''}">
  ${body.join('\n  ')}
  </main>`, {
    ...ctx,
    jsonLd: barJsonLd(bar, ctx.siteUrl),
    extraCss: '',
    afterFooter: `<script type="application/json" id="bar-data">${data}</script>
<script type="module">
${CLIENT}
</script>
`,
  })
}
