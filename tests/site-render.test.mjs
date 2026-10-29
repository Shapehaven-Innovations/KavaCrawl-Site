import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBars, curatedIds } from '../scripts/lib/site/snapshot.mjs'
import { renderBar, escapeHtml } from '../scripts/lib/site/render.mjs'
import { barJsonLd } from '../scripts/lib/site/jsonld.mjs'
import * as C from '../assets/bar-client.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/site/${name}`, import.meta.url), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('../scripts/site-config.json', import.meta.url), 'utf8'))
const footerFragment = readFileSync(new URL('../assets/footer.fragment.html', import.meta.url), 'utf8')
const { bars } = buildBars(fixture('d1.json'), curatedIds(fixture('venues.json')), {}, cfg, '2026-10-28')
const full = bars.find((b) => b.place_id === 'ChIJAaaaaa111')
const ctx = { siteUrl: cfg.SITE_URL, appStoreUrl: cfg.appStoreUrl, footerFragment, indexable: true }
const render = (bar = full, extra = {}) => renderBar(bar, { ...ctx, ...extra })
const thin = { ...full, hours: null, events: [], menu: null, shell: null, index: null, compare: null, history: [] }
const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
const withoutFooter = (html) => html.replace(footerFragment, '')
const ldOf = (html) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])

test('fixture bar is the full-data bar the render tests expect', () => {
  assert.ok(full.hours && full.events.length && full.menu && full.compare && full.neighbors.length)
  assert.equal(full.tz, 'America/New_York')
})

test('escapeHtml escapes markup, ampersands and quotes, and blanks null', () => {
  assert.equal(escapeHtml(`A&B <b>"x"</b> 'y'`), 'A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt; &#39;y&#39;')
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(5), '5')
})

test('renderBar output has exactly one h1, a canonical equal to siteUrl+path, and the footer fragment', () => {
  const html = render()
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)]
  assert.equal(canon.length, 1)
  assert.equal(canon[0][1], cfg.SITE_URL + full.path)
  assert.ok(html.includes(footerFragment), 'footer fragment included verbatim')
  assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/)
})

test('renderBar is byte-identical across two calls', () => {
  assert.equal(render(), render())
  assert.equal(render(thin), render(thin))
})

test('renderBar prints no date-like strings (YYYY-MM-DD, "verified", "prices seen")', () => {
  for (const html of [render(), render(thin)]) {
    const visible = stripScripts(html)
    assert.doesNotMatch(visible, /\d{4}-\d{2}-\d{2}/)
    assert.doesNotMatch(visible, /verified/i)
    assert.doesNotMatch(visible, /prices seen/i)
    assert.doesNotMatch(visible, /last updated/i)
  }
})

test('section order is hours, events, menu, compare, nearby', () => {
  const html = render()
  const at = ['id="hours"', 'id="events"', 'id="menu"', 'id="compare"', 'id="nearby"', 'class="cta-card"'].map((s) => html.indexOf(s))
  for (const i of at) assert.ok(i > 0)
  assert.deepEqual([...at].sort((a, b) => a - b), at)
  assert.ok(html.indexOf('class="bar-head"') < at[0])
  assert.ok(!html.includes('id="known"'), 'no What we know panel on a full bar')
})

test('a bar with no hours/events/menu/compare renders the What we know panel and still renders Call, Directions and nearby', () => {
  const html = render(thin)
  assert.ok(html.includes('id="known"'))
  assert.match(html, /What we know/)
  for (const id of ['hours', 'events', 'menu', 'compare']) assert.ok(!html.includes(`id="${id}"`), id)
  assert.match(html, /href="tel:\+18135550100"[^>]*>[\s\S]*?Call<\/a>/)
  assert.match(html, />Directions<\/a>/)
  assert.ok(html.includes('id="nearby"'))
  assert.match(html, /Hours not listed yet/)
  assert.ok(!html.includes('id="open-now"'))
})

test('Call button is tel:+18135550100 and Directions is a plain https maps url', () => {
  const html = render()
  const call = /<a class="btn" href="([^"]+)"[^>]*>[\s\S]*?Call<\/a>/.exec(html)
  assert.equal(call[1], 'tel:+18135550100')
  const dir = /<a class="btn ghost" href="([^"]+)"[^>]*>[\s\S]*?Directions<\/a>/.exec(html)
  const url = new URL(dir[1].replaceAll('&amp;', '&'))
  assert.equal(url.protocol, 'https:')
  assert.equal(url.host, 'www.google.com')
  assert.equal(url.searchParams.get('query_place_id'), 'ChIJAaaaaa111')
  assert.match(html, /href="https:\/\/kavahaven\.example"[^>]*>[\s\S]*?Website<\/a>/)
})

test('name "A&B <b>{{x}}</b>" is escaped in html and json-ld', () => {
  const name = 'A&B <b>{{x}}</b>'
  const bar = { ...full, name, street: '1 "Q" <St>' }
  const html = render(bar)
  assert.ok(!html.includes('<b>{{x}}'), 'raw markup never appears')
  assert.ok(html.includes('A&amp;B &lt;b&gt;{{x}}&lt;/b&gt;'))
  assert.ok(html.includes('1 &quot;Q&quot; &lt;St&gt;'))
  const ldText = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.ok(!ldText.includes('<'), 'json-ld has no raw <')
  assert.ok(ldText.includes('\\u003cb>'))
  const ld = JSON.parse(ldText)
  assert.equal(ld['@graph'][0].name, name)
  // the data blob never carries free text
  const blob = /<script type="application\/json" id="bar-data">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.ok(!blob.includes('<'))
})

test('indexable false adds noindex; true has no robots meta', () => {
  assert.ok(!/name="robots"/.test(render()))
  const off = render(full, { indexable: false })
  assert.equal((off.match(/<meta name="robots" content="noindex">/g) ?? []).length, 1)
})

test('the page has no "Correct this page" text and no mailto: link', () => {
  for (const html of [render(), render(thin)]) {
    assert.doesNotMatch(html, /correct this page/i)
    assert.doesNotMatch(html, /something wrong/i)
    // The shared footer fragment (included verbatim, owned by the SEO repo) carries the site-wide
    // "Email us" link; nothing the bar page itself adds may contain mailto:.
    assert.doesNotMatch(withoutFooter(html), /mailto:/i)
  }
})

test('barJsonLd parses as JSON, has telephone and BreadcrumbList, and no Event for a one-off without start_date', () => {
  const ld = JSON.parse(barJsonLd(full, cfg.SITE_URL))
  assert.equal(ld['@context'], 'https://schema.org')
  const graph = ld['@graph']
  const bar = graph.find((n) => n['@type'] === 'BarOrPub')
  assert.equal(bar.telephone, '+18135550100')
  assert.equal(bar.url, cfg.SITE_URL + full.path)
  assert.equal(bar.address['@type'], 'PostalAddress')
  assert.equal(bar.address.addressRegion, 'FL')
  assert.deepEqual(bar.geo, { '@type': 'GeoCoordinates', latitude: full.lat, longitude: full.lng })
  assert.ok(Array.isArray(bar.openingHoursSpecification) && bar.openingHoursSpecification.length)
  assert.deepEqual(bar.openingHoursSpecification[0], { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday'], opens: '17:00', closes: '02:00' })
  assert.equal(bar.hasMenu['@type'], 'Menu')
  const item = bar.hasMenu.hasMenuItem[0]
  assert.equal(item['@type'], 'MenuItem')
  assert.equal(item.offers['@type'], 'Offer')
  assert.equal(item.offers.priceCurrency, 'USD')

  const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList')
  assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.name, i.item]), [
    [1, 'Florida', `${cfg.SITE_URL}/bars/fl/`],
    [2, 'Tampa', `${cfg.SITE_URL}/bars/fl/tampa/`],
    [3, 'Kava Haven', cfg.SITE_URL + full.path],
  ])

  const events = graph.filter((n) => n['@type'] === 'Event').map((e) => e.name).sort()
  assert.deepEqual(events, ['Edge One-off', 'Recent One-off'])
  const recent = graph.find((n) => n.name === 'Recent One-off')
  assert.equal(recent.startDate, '2026-10-24T20:00')
  assert.equal(recent.endDate, '2026-10-24T23:00')

  // only fields present
  const bare = JSON.parse(barJsonLd(thin, cfg.SITE_URL))['@graph'][0]
  assert.ok(!('openingHoursSpecification' in bare) && !('hasMenu' in bare))
  assert.equal(JSON.parse(barJsonLd(thin, cfg.SITE_URL))['@graph'].filter((n) => n['@type'] === 'Event').length, 0)
})

test('open-now pill is omitted when tz is null', () => {
  assert.ok(render().includes('id="open-now"'))
  const html = render({ ...full, tz: null })
  assert.ok(!html.includes('id="open-now"'))
  assert.equal(C.openState(full.hours, null, new Date('2026-10-27T02:00:00Z')), null)
})

test('the page has no external script src and no tracking markers', () => {
  for (const html of [render(), render(thin, { indexable: false })]) {
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/i)
    for (const bad of [/cloudflareinsights/i, /gtag|googletagmanager|google-analytics/i, /document\.cookie/, /localStorage|sessionStorage|indexedDB/,
      /\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/]) assert.doesNotMatch(html, bad)
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim())
    assert.deepEqual(scripts, ['type="application/ld+json"', 'type="application/json" id="bar-data"', 'type="module"'])
  }
})

test('the inline client module is the shipped bar-client.mjs with exports stripped', () => {
  const html = render()
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.doesNotMatch(mod, /^export /m)
  assert.match(mod, /function openState\(/)
  const css = readFileSync(new URL('../assets/bar.css', import.meta.url), 'utf8')
  assert.ok(html.includes(css.trim()), 'bar.css inlined')
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /color-scheme:dark/)
})

// ---------- client logic (pure, `now` passed in) ----------

const NY = 'America/New_York'
// 2026-10-26 is a Monday; New York is UTC-4 (EDT) until 2026-11-01.
const ny = (local) => new Date(`${local}-04:00`)

test('fmtTime formats HH:MM as 12-hour, long and short', () => {
  assert.equal(C.fmtTime('17:00'), '5:00 PM')
  assert.equal(C.fmtTime('00:00'), '12:00 AM')
  assert.equal(C.fmtTime('24:00'), '12:00 AM')
  assert.equal(C.fmtTime('12:30'), '12:30 PM')
  assert.equal(C.fmtTime('23:00', true), '11 PM')
  assert.equal(C.fmtTime('19:30', true), '7:30 PM')
  assert.equal(C.fmtTime('bad'), '')
})

test('localParts reads weekday, minutes and date in the bar time zone', () => {
  assert.deepEqual(C.localParts(new Date('2026-10-27T02:00:00Z'), NY), { day: 1, minutes: 22 * 60, date: '2026-10-26' })
})

test('openState handles overnight, week wrap, closed-today and 24 hours', () => {
  const mon = [{ day: 1, open: '17:00', close: '02:00' }]
  assert.deepEqual(C.openState(mon, NY, ny('2026-10-26T22:00')), { open: true, closes: '02:00' })
  assert.deepEqual(C.openState(mon, NY, ny('2026-10-27T01:30')), { open: true, closes: '02:00' })
  assert.deepEqual(C.openState(mon, NY, ny('2026-10-27T03:00')), { open: false, opens: '17:00', opensDay: 1, today: 2 })
  assert.deepEqual(C.openState(mon, NY, ny('2026-10-26T16:00')), { open: false, opens: '17:00', opensDay: 1, today: 1 })
  const sat = [{ day: 6, open: '20:00', close: '02:00' }]
  assert.deepEqual(C.openState(sat, NY, ny('2026-11-01T01:00')), { open: true, closes: '02:00' })
  const always = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' }))
  assert.deepEqual(C.openState(always, NY, ny('2026-10-28T03:00')), { open: true, allDay: true })
  // back-to-back periods chain: Mon 16-24 then Tue 00-02 closes at 2
  const chained = [{ day: 1, open: '16:00', close: '24:00' }, { day: 2, open: '00:00', close: '02:00' }]
  assert.deepEqual(C.openState(chained, NY, ny('2026-10-26T23:00')), { open: true, closes: '02:00' })
  assert.equal(C.openState(null, NY, ny('2026-10-26T22:00')), null)
  assert.equal(C.openState([], NY, ny('2026-10-26T22:00')), null)
})

test('pillText words the open and closed states', () => {
  assert.deepEqual(C.pillText({ open: true, closes: '23:00' }), { open: true, text: 'Open now', sep: 'closes 11 PM' })
  assert.deepEqual(C.pillText({ open: true, allDay: true }), { open: true, text: 'Open now', sep: 'open 24 hours' })
  assert.deepEqual(C.pillText({ open: false, opens: '17:00', opensDay: 1, today: 1 }), { open: false, text: 'Closed', sep: 'opens 5 PM' })
  assert.deepEqual(C.pillText({ open: false, opens: '17:00', opensDay: 1, today: 2 }), { open: false, text: 'Closed', sep: 'opens Mon 5 PM' })
})

test('isPastOneOff hides one-offs after their end date only', () => {
  const recent = { is_recurring: false, start_date: '2026-10-24', end_date: '2026-10-24' }
  assert.equal(C.isPastOneOff(recent, NY, ny('2026-10-28T12:00')), true)
  assert.equal(C.isPastOneOff(recent, NY, ny('2026-10-24T22:00')), false)
  assert.equal(C.isPastOneOff({ is_recurring: false, start_date: '2026-10-24', end_date: null }, NY, ny('2026-10-25T12:00')), true)
  assert.equal(C.isPastOneOff({ is_recurring: false, start_date: null, end_date: null }, NY, ny('2026-10-28T12:00')), false)
  assert.equal(C.isPastOneOff({ is_recurring: true, start_date: '2025-01-01', end_date: '2025-02-01' }, NY, ny('2026-10-28T12:00')), false)
})

test('tonightEvents picks today\'s recurring events and dated one-offs for today', () => {
  const events = [
    { day: 1, start: '19:00', end: '21:00', is_recurring: true, start_date: null, end_date: null },
    { day: 1, start: '20:00', end: null, is_recurring: false, start_date: null, end_date: null },
    { day: 1, start: '20:00', end: null, is_recurring: false, start_date: '2026-10-26', end_date: '2026-10-26' },
    { day: 1, start: '20:00', end: null, is_recurring: false, start_date: '2026-10-19', end_date: '2026-10-19' },
    { day: 2, start: '19:00', end: null, is_recurring: true, start_date: null, end_date: null },
  ]
  assert.deepEqual(C.tonightEvents(events, NY, ny('2026-10-26T12:00')), [0, 2])
  assert.deepEqual(C.tonightEvents(events, null, ny('2026-10-26T12:00')), [])
})

// Minimal DOM double: enough of the API init() uses.
function fakeDom(html) {
  const make = (tag, attrs = {}) => {
    const el = {
      tagName: tag, attrs: { ...attrs }, children: [], textContent: '', hidden: 'hidden' in attrs,
      classList: { set: new Set((attrs.class ?? '').split(' ').filter(Boolean)), add(c) { this.set.add(c) }, contains(c) { return this.set.has(c) } },
      get className() { return [...this.classList.set].join(' ') },
      set className(v) { this.classList.set = new Set(v.split(' ').filter(Boolean)) },
      getAttribute(k) { return this.attrs[k] ?? null },
      append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k) },
      replaceChildren(...kids) { this.children = []; this.append(...kids) },
      querySelector(sel) { return this._q(sel)[0] ?? null },
      querySelectorAll(sel) { return this._q(sel) },
      _q(sel) { return all.filter((e) => e !== this && e._match(sel) && e._in(this)) },
      _match(sel) { const m = /^(\w+)?(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/.exec(sel); return (!m[1] || m[1] === this.tagName) && (!m[2] || this.classList.contains(m[2])) && (!m[3] || m[3] in this.attrs) },
      _in(root) { for (let p = this.parent; p; p = p.parent) if (p === root) return true; return root === doc },
    }
    return el
  }
  const all = []
  const doc = make('#doc')
  const stack = [doc]
  for (const m of html.matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
    if (m[4] != null) { stack.at(-1).textContent += m[4]; continue }
    if (m[1]) { stack.pop(); continue }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? '']))
    const el = make(m[2], attrs)
    el.parent = stack.at(-1)
    stack.at(-1).children.push(el)
    all.push(el)
    if (!/^(br|img|meta|link)$/.test(m[2]) && !m[3].endsWith('/')) stack.push(el)
  }
  doc.getElementById = (id) => all.find((e) => e.attrs.id === id) ?? null
  doc.createElement = (tag) => { const e = make(tag); return e }
  return doc
}

test('init sets the pill, marks today and the tonight chips, and hides past one-offs', () => {
  const html = render()
  const body = /<header class="bar-head">[\s\S]*?<section class="panel" id="menu"/.exec(html)[0]
  const blob = /<script type="application\/json" id="bar-data">[\s\S]*?<\/script>/.exec(html)[0]
  const doc = fakeDom(body + blob)
  C.init(doc, ny('2026-10-26T22:00')) // Monday 10 PM in Tampa
  const pill = doc.getElementById('open-now')
  assert.equal(pill.hidden, false)
  assert.ok(pill.classList.contains('pill'))
  const texts = pill.children.map((c) => c.text ?? c.textContent)
  assert.ok(texts.includes('Open now') && texts.includes('closes 2 AM'), texts.join('|'))
  const rows = doc.getElementById('hours').querySelectorAll('li')
  assert.deepEqual(rows.filter((r) => r.classList.contains('today')).map((r) => r.attrs['data-day']), ['1'])
  const tonight = doc.getElementById('tonight')
  assert.equal(tonight.hidden, false)
  assert.equal(tonight.children.length, 1) // Trivia Night (recurring Monday)
  const evRows = doc.getElementById('events').querySelectorAll('li').filter((li) => 'data-i' in li.attrs)
  const hidden = evRows.filter((li) => li.hidden).map((li) => li.querySelector('span.nm').textContent)
  assert.deepEqual(hidden.sort(), ['Edge One-off', 'Recent One-off'])
})

test('init leaves the closed pill in the dashed box style', () => {
  const html = render()
  const body = /<header class="bar-head">[\s\S]*?<\/header>/.exec(html)[0]
  const blob = /<script type="application\/json" id="bar-data">[\s\S]*?<\/script>/.exec(html)[0]
  const doc = fakeDom(body + blob)
  C.init(doc, ny('2026-10-28T12:00')) // Wednesday noon
  const pill = doc.getElementById('open-now')
  assert.equal(pill.hidden, false)
  assert.equal(pill.className, 'rbox na')
  assert.ok(pill.children.some((c) => (c.text ?? c.textContent) === 'opens Mon 5 PM'))
})

// ---------- phone optional (owner decision 2026-10-29) ----------

const clearwater = bars.find((b) => b.place_id === 'ChIJEeeeee555')
const phoneless = { ...full, phone: null }
const thinPhoneless = { ...thin, phone: null }
const descOf = (html) => /<meta name="description" content="([^"]*)">/.exec(html)[1]

test('the phoneless fixture bar (Clearwater) is eligible with phone null', () => {
  assert.ok(clearwater, 'Clearwater bar built')
  assert.equal(clearwater.phone, null)
  assert.ok(render(clearwater).includes('No Phone Kava'))
})

test('phoneless bar renders no tel: link, no Call button and no phone text', () => {
  for (const bar of [phoneless, thinPhoneless, clearwater]) {
    const html = withoutFooter(render(bar))
    assert.doesNotMatch(html, /tel:/)
    assert.doesNotMatch(html, />Call<\/a>/)
    assert.doesNotMatch(html, /\(813\) 555-0100/)
  }
})

test('phoneless bar still renders Directions, hours/events/menu sections that have data, and the nearby bars', () => {
  const html = render(phoneless)
  assert.match(html, /<a class="btn" href="https:\/\/www\.google\.com\/maps\/search\/[^"]*"[^>]*>[\s\S]*?Directions<\/a>/)
  assert.match(html, /href="https:\/\/kavahaven\.example"[^>]*>[\s\S]*?Website<\/a>/)
  for (const id of ['hours', 'events', 'menu', 'compare', 'nearby']) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(!html.includes('id="known"'))
})

test('thin phoneless bar renders the What we know panel without "Call ahead"', () => {
  const html = render(thinPhoneless)
  assert.ok(html.includes('id="known"'))
  assert.doesNotMatch(html, /call ahead/i)
  assert.match(render(thin), /Call ahead/, 'wording kept when a phone exists')
})

test('phoneless fallback description does not say Call', () => {
  assert.doesNotMatch(descOf(render(thinPhoneless)), /call/i)
  assert.match(descOf(render(thin)), /^.*Call, get directions/)
})

test('barJsonLd omits telephone when phone is null', () => {
  const node = JSON.parse(barJsonLd(phoneless, cfg.SITE_URL))['@graph'][0]
  assert.ok(!('telephone' in node))
  assert.equal(node.name, 'Kava Haven')
})

const primaries = (html) => [...withoutFooter(html).matchAll(/<a class="btn" href="([^"]+)"[^>]*>[\s\S]*?(\w+)<\/a>/g)].map((m) => [m[2], m[1]])

test('phoneless bar renders Directions as the primary button', () => {
  for (const bar of [phoneless, thinPhoneless, clearwater]) {
    const p = primaries(render(bar))
    assert.equal(p.length, 1)
    assert.equal(p[0][0], 'Directions')
    assert.match(p[0][1], /^https:\/\/www\.google\.com\/maps\/search\//)
    assert.doesNotMatch(render(bar), /class="btn ghost"[^>]*>[\s\S]{0,400}?Directions<\/a>/)
  }
})

test('bar with phone still renders Call as the only primary button', () => {
  for (const bar of [full, thin]) {
    assert.deepEqual(primaries(render(bar)), [['Call', 'tel:+18135550100']])
    assert.match(render(bar), /<a class="btn ghost" href="https:\/\/www\.google\.com\/maps\/search\/[^"]*"[^>]*>[\s\S]*?Directions<\/a>/)
  }
})
