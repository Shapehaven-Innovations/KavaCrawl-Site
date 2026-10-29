import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBars, curatedIds } from '../scripts/lib/site/snapshot.mjs'
import { buildHubs, stateStats, cityStats, nationalStats, cheapestBars, topRated, popularCities } from '../scripts/lib/site/hubs.mjs'
import { badgeFor } from '../assets/hubs-client.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/site/${name}`, import.meta.url), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('../scripts/site-config.json', import.meta.url), 'utf8'))
const footerFragment = readFileSync(new URL('../assets/footer.fragment.html', import.meta.url), 'utf8')
const { bars } = buildBars(fixture('d1.json'), curatedIds(fixture('venues.json')), {}, cfg, '2026-10-28')
const ctx = { siteUrl: cfg.SITE_URL, appStoreUrl: cfg.appStoreUrl, footerFragment, indexable: true }
const all = new Set(bars.map((b) => b.place_id))
const byPath = (hubs, p) => hubs.find((h) => h.path === p)
const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const kebab = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-')
const mk = (id, name, city, shell, extra = {}) => ({
  ...bars[0], place_id: id, name, city, state: 'FL', shell, index: null, phone: null, hours: null,
  path: `/bars/${(extra.state ?? 'FL').toLowerCase()}/${kebab(city)}/${kebab(name)}/`, ...extra,
})
const ids = (list) => new Set(list.map((b) => b.place_id))
/** Inner html of the first <a ...href="href"...>...</a> (any attribute order). */
const linkInner = (html, href) => new RegExp(`<a\\b[^>]*href="${href.replace(/[/.]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/a>`).exec(html)?.[1]
const cardNames = (html) => [...html.matchAll(/<a class="bcard"[^>]*><span class="t"><span class="rk">#\d+<\/span>([^<]+)<\/span>/g)].map((m) => m[1])
const ldOf = (html) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])
const hasChip = (html, name, small) => html.includes(`${name}<small>${small}</small>`) || html.includes(`<b>${name}</b><small>${small}</small>`)

test('fixture has bars in several FL cities', () => {
  assert.ok(new Set(bars.map((b) => b.city)).size >= 3)
})

// ---------- aggregates ----------

test('stateStats / cityStats / nationalStats count and rank only admitted bars', () => {
  const some = new Set(['ChIJAaaaaa111', 'ChIJHhhhhh888'])
  const live = bars.filter((b) => some.has(b.place_id))
  assert.deepEqual(nationalStats(live), { bars: 2, states: 1, cities: 2 })
  assert.deepEqual(stateStats(live), [{ key: 'fl', code: 'FL', name: 'Florida', count: 2, cities: 2, topCity: 'Orlando', cheapestShell: 5 }])
  assert.deepEqual(cityStats(live), [
    { key: 'orlando', stateKey: 'fl', name: 'Orlando', state: 'FL', count: 1, cheapestShell: 7, medianShell: 7 },
    { key: 'tampa', stateKey: 'fl', name: 'Tampa', state: 'FL', count: 1, cheapestShell: 5, medianShell: 5 },
  ])
  assert.deepEqual(nationalStats(bars), { bars: 5, states: 1, cities: 4 })
  assert.deepEqual(nationalStats([]), { bars: 0, states: 0, cities: 0 })
  // The landing hero tiles show the admitted numbers, not the rendered ones.
  const landing = byPath(buildHubs(bars, some, ctx), '/bars/index.html').html
  const tiles = [...landing.matchAll(/<div class="stat"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/div>/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(tiles, ['2 bars listed', '1 state', '2 cities'])
})

test('topCity breaks ties by name', () => {
  const list = [mk('ChIJt1', 'A', 'Tampa', 5), mk('ChIJt2', 'B', 'Tampa', 6), mk('ChIJo1', 'C', 'Orlando', null),
    mk('ChIJo2', 'D', 'Orlando', null), mk('ChIJp1', 'E', 'Apopka', 4)]
  const [fl] = stateStats(list)
  assert.equal(fl.topCity, 'Orlando')
  assert.equal(fl.cities, 3)
  assert.equal(fl.cheapestShell, 4)
  assert.equal(stateStats([mk('ChIJn1', 'N', 'Tampa', null)])[0].cheapestShell, null)
})

test('medianShell is null when no admitted bar in the city has a shell price', () => {
  const list = [mk('ChIJa1', 'A', 'Tampa', 4), mk('ChIJa2', 'B', 'Tampa', 9), mk('ChIJa3', 'C', 'Tampa', 6), mk('ChIJa4', 'D', 'Tampa', 7),
    mk('ChIJa5', 'E', 'Tampa', null), mk('ChIJb1', 'F', 'Orlando', null), mk('ChIJc1', 'G', 'Ocala', 5), mk('ChIJc2', 'H', 'Ocala', null)]
  const by = Object.fromEntries(cityStats(list).map((c) => [c.name, c]))
  assert.equal(by.Tampa.medianShell, 6.5)
  assert.equal(by.Tampa.cheapestShell, 4)
  assert.equal(by.Tampa.count, 5)
  assert.equal(by.Orlando.medianShell, null)
  assert.equal(by.Orlando.cheapestShell, null)
  assert.equal(by.Ocala.medianShell, 5)
  const html = byPath(buildHubs(list, ids(list), ctx), '/bars/fl/orlando/index.html').html
  assert.doesNotMatch(html, /median shell/i)
  assert.doesNotMatch(html, /cheapest shell<\/span>/)
  assert.match(html, /<div class="stat"><b>1<\/b><span>bar listed<\/span><\/div>/)
})

test('cheapestBars excludes null shells and breaks ties by place_id', () => {
  const list = [mk('ChIJz1', 'Z', 'Tampa', 5), mk('ChIJn1', 'N', 'Tampa', null), mk('ChIJa1', 'A', 'Tampa', 5),
    mk('ChIJc1', 'C', 'Orlando', 3.5), mk('ChIJd1', 'D', 'Tampa', 6), mk('ChIJe1', 'E', 'Tampa', 7)]
  assert.deepEqual(cheapestBars(list).map((b) => b.place_id), ['ChIJc1', 'ChIJa1', 'ChIJz1', 'ChIJd1'])
  assert.deepEqual(cheapestBars(list, 2).map((b) => b.place_id), ['ChIJc1', 'ChIJa1'])
  assert.deepEqual(cheapestBars([mk('ChIJn1', 'N', 'Tampa', null)]), [])
  const rated = [mk('ChIJr2', 'R2', 'Tampa', 5, { index: { total: 70 } }), mk('ChIJr1', 'R1', 'Tampa', 5, { index: { total: 70 } }),
    mk('ChIJr3', 'R3', 'Tampa', 5, { index: { total: 90 } }), mk('ChIJr4', 'R4', 'Tampa', 5), mk('ChIJr5', 'R5', 'Tampa', 5, { index: { total: 50 } })]
  assert.deepEqual(topRated(rated).map((b) => b.place_id), ['ChIJr3', 'ChIJr1', 'ChIJr2'])
  assert.deepEqual(topRated([mk('ChIJr4', 'R4', 'Tampa', 5)]), [])
})

test('popularCities spans states and is deterministic', () => {
  const tx = (id, name, city) => mk(id, name, city, 5, { state: 'TX' })
  const list = [mk('ChIJ1', 'A', 'Tampa', 5), mk('ChIJ2', 'B', 'Tampa', 5), tx('ChIJ3', 'C', 'Austin'), tx('ChIJ4', 'D', 'Austin'),
    mk('ChIJ5', 'E', 'Orlando', 5), tx('ChIJ6', 'F', 'Houston'), tx('ChIJ7', 'G', 'Houston'), tx('ChIJ8', 'H', 'Houston')]
  const want = [
    { key: 'houston', stateKey: 'tx', name: 'Houston', state: 'TX', count: 3 },
    { key: 'tampa', stateKey: 'fl', name: 'Tampa', state: 'FL', count: 2 },
    { key: 'austin', stateKey: 'tx', name: 'Austin', state: 'TX', count: 2 },
    { key: 'orlando', stateKey: 'fl', name: 'Orlando', state: 'FL', count: 1 },
  ]
  assert.deepEqual(popularCities(list), want)
  assert.deepEqual(popularCities([...list].reverse()), want)
  assert.deepEqual(popularCities(list, 2), want.slice(0, 2))
  const landing = byPath(buildHubs(list, ids(list), ctx), '/bars/index.html').html
  const chips = [...landing.matchAll(/<li[^>]*><a href="(\/bars\/[a-z]+\/[a-z-]+\/)">/g)].map((m) => m[1])
  assert.deepEqual(chips, ['/bars/tx/houston/', '/bars/fl/tampa/', '/bars/tx/austin/', '/bars/fl/orlando/'])
})

// ---------- landing ----------

test('landing lists every state with any rendered bar, including noindex ones, in the A-Z list', () => {
  const list = [...bars, mk('ChIJo1', 'Out', 'Austin', 4, { state: 'TX' }), mk('ChIJg1', 'Peach', 'Atlanta', 6, { state: 'GA' })]
  const hubs = buildHubs(list, new Set([...all, 'ChIJg1']), ctx)
  const html = byPath(hubs, '/bars/index.html').html
  const az = /<ul class="az">([\s\S]*?)<\/ul>/.exec(html)[1]
  const entries = [...az.matchAll(/<a href="([^"]+)">([^<]+)<small>([^<]+)<\/small><\/a>/g)].map((m) => [m[1], m[2], m[3]])
  assert.deepEqual(entries, [['/bars/fl/', 'Florida', '5 bars'], ['/bars/ga/', 'Georgia', '1 bar'], ['/bars/tx/', 'Texas', 'No bars yet']])
  assert.equal(byPath(hubs, '/bars/tx/index.html').indexable, false)
  // State cards only for states with admitted bars, busiest first.
  const cards = [...html.matchAll(/<a class="card" href="([^"]+)">/g)].map((m) => m[1])
  assert.deepEqual(cards, ['/bars/fl/', '/bars/ga/'])
  assert.match(text(linkInner(html, '/bars/fl/')), /Florida Most bars in Tampa shells from \$5\.00 5 bars/)
  assert.match(text(linkInner(html, '/bars/ga/')), /1 bar$/)
  assert.match(html, /<p class="crumb"><a href="\/">Home<\/a> &rsaquo; Bars<\/p>/)
})

test('landing ItemList JSON-LD lists only states with an admitted bar', () => {
  const list = [...bars, mk('ChIJo1', 'Out', 'Austin', 4, { state: 'TX' }), mk('ChIJg1', 'Peach', 'Atlanta', 6, { state: 'GA' })]
  const hubs = buildHubs(list, new Set([...all, 'ChIJg1']), ctx)
  const html = byPath(hubs, '/bars/index.html').html
  const items = ldOf(html)['@graph'].find((n) => n['@type'] === 'ItemList')
  assert.equal(items.numberOfItems, 2)
  assert.deepEqual(items.itemListElement.map((i) => [i.position, i.name, i.url]),
    [[1, 'Florida', `${cfg.SITE_URL}/bars/fl/`], [2, 'Georgia', `${cfg.SITE_URL}/bars/ga/`]])
  // The visible A-Z list still shows Texas.
  assert.match(/<ul class="az">([\s\S]*?)<\/ul>/.exec(html)[1], /Texas<small>No bars yet<\/small>/)
})

test('landing hides the cheapest-shell band when no admitted bar has a shell price', () => {
  const list = [mk('ChIJn1', 'N1', 'Tampa', null), mk('ChIJn2', 'N2', 'Orlando', null), mk('ChIJs1', 'Priced', 'Ocala', 4)]
  const hubs = buildHubs(list, new Set(['ChIJn1', 'ChIJn2']), ctx)
  const html = byPath(hubs, '/bars/index.html').html
  assert.doesNotMatch(html, /h-cheap/)
  assert.doesNotMatch(html, /shells from/)
  assert.doesNotMatch(html, /\$4\.00/)
  const withPrice = byPath(buildHubs(list, ids(list), ctx), '/bars/index.html').html
  const band = /<section class="sec band" aria-labelledby="h-cheap">([\s\S]*?)<\/section>/.exec(withPrice)[1]
  assert.deepEqual([...band.matchAll(/<a class="fcard" href="([^"]+)">/g)].map((m) => m[1]), ['/bars/fl/ocala/priced/'])
  assert.match(text(band), /\$4\.00 shell Priced Ocala, FL/)
})

// ---------- state ----------

test('state hub lists its cities with bar counts', () => {
  const hubs = buildHubs(bars, all, ctx)
  const html = byPath(hubs, '/bars/fl/index.html').html
  assert.match(text(linkInner(html, '/bars/fl/tampa/')), /Tampa/)
  assert.match(text(linkInner(html, '/bars/fl/tampa/')), /2 bars/)
  assert.match(text(linkInner(html, '/bars/fl/tampa/')), /Median shell \$5\.50 shells from \$5\.00/)
  assert.match(text(linkInner(html, '/bars/fl/orlando/')), /1 bar\b/)
  assert.ok(byPath(hubs, '/bars/index.html'), 'all-states hub')
  assert.match(byPath(hubs, '/bars/index.html').html, /<a href="\/bars\/fl\/">/)
  // Cities busiest first, then by name.
  const cards = [...html.matchAll(/<a class="card" href="([^"]+)">/g)].map((m) => m[1])
  assert.deepEqual(cards, ['/bars/fl/tampa/', '/bars/fl/clearwater/', '/bars/fl/orlando/', '/bars/fl/st-petersburg/'])
  // Top-rated band: Index desc.
  const band = /aria-labelledby="h-top">([\s\S]*?)<\/section>/.exec(html)[1]
  assert.deepEqual([...band.matchAll(/<a class="fcard rk" href="([^"]+)">/g)].map((m) => m[1]),
    ['/bars/fl/tampa/kava-haven/', '/bars/fl/tampa/kava-haven-bbbbbb/', '/bars/fl/orlando/orlando-kava/'])
  assert.match(html, /<h2 id="h-more">More states<\/h2>/)
  assert.match(html, /<a href="\/bars\/">All states<small>5 bars<\/small><\/a>/)
})

test('state hub omits the top-rated band without Index data', () => {
  const list = [mk('ChIJa1', 'A', 'Tampa', 5), mk('ChIJb1', 'B', 'Orlando', 6)]
  const html = byPath(buildHubs(list, ids(list), ctx), '/bars/fl/index.html').html
  assert.doesNotMatch(html, /h-top/)
  assert.doesNotMatch(html, /top-rated/i)
})

// ---------- city ----------

test('city page orders cards cheapest first with null shells last', () => {
  const list = [mk('ChIJz1', 'Zed', 'Tampa', 5), mk('ChIJn1', 'Nullish', 'Tampa', null), mk('ChIJa1', 'Alpha', 'Tampa', 5),
    mk('ChIJc1', 'Cheap', 'Tampa', 3.5), mk('ChIJb0', 'Aardvark', 'Tampa', null), mk('ChIJa0', 'Alpha', 'Tampa', 5, { path: '/bars/fl/tampa/alpha-2/' })]
  const html = byPath(buildHubs(list, ids(list), ctx), '/bars/fl/tampa/index.html').html
  assert.deepEqual(cardNames(html), ['Cheap', 'Alpha', 'Alpha', 'Zed', 'Aardvark', 'Nullish'])
  assert.ok(html.indexOf('/bars/fl/tampa/alpha-2/') < html.indexOf('/bars/fl/tampa/alpha/'), 'same name: place_id breaks the tie')
  assert.match(html, /<span class="pr"><b>\$3\.50<\/b><small>shell<\/small><\/span>/)
  assert.equal((html.match(/<span class="pr na"><b>No listed price<\/b><\/span>/g) ?? []).length, 2)
  const tiles = [...html.matchAll(/<div class="stat"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/div>/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(tiles, ['$5.00 Tampa median shell', '$3.50 cheapest shell', '6 bars listed'])
})

test('city cards show the street, not a neighborhood, and the Index chip when known', () => {
  const html = byPath(buildHubs(bars, all, ctx), '/bars/fl/tampa/index.html').html
  const card = linkInner(html, '/bars/fl/tampa/kava-haven/')
  assert.match(card, /<span class="k">100 Franklin St<\/span>/)
  assert.match(card, /<span class="score" title="KavaCrawl Index">81<\/span>/)
  assert.match(html, /Other cities in Florida/)
  assert.match(html, /<a href="\/bars\/fl\/">All of Florida<small>5 bars<\/small><\/a>/)
  const chips = /aria-labelledby="h-other">([\s\S]*?)<\/section>/.exec(html)[1]
  assert.doesNotMatch(chips, /\/bars\/fl\/tampa\//)
  assert.match(chips, /\/bars\/fl\/orlando\//)
  assert.match(html, /<section class="cta-card"/)
  assert.ok(html.includes(`href="${cfg.appStoreUrl}"`))
})

test('call link is a sibling of the card link and only for bars with a phone', () => {
  const list = [mk('ChIJp1', 'Phoned', 'Tampa', 5, { phone: { e164: '+18135550100', display: '(813) 555-0100' } }), mk('ChIJq1', 'Quiet', 'Tampa', 6)]
  const html = byPath(buildHubs(list, ids(list), ctx), '/bars/fl/tampa/index.html').html
  const items = [...html.matchAll(/<li\b([^>]*)>\s*(<a class="bcard"[\s\S]*?)<\/li>/g)]
  assert.equal(items.length, 2)
  const [phoned, quiet] = items
  assert.match(phoned[1], /class="tel"/)
  const card = /<a class="bcard"[^>]*>([\s\S]*?)<\/a>/.exec(phoned[2])
  assert.doesNotMatch(card[1], /<a\b/, 'nothing nested inside the card link')
  assert.match(phoned[2].slice(card.index + card[0].length), /^\s*<a class="call" href="tel:\+18135550100" aria-label="Call Phoned">/)
  assert.doesNotMatch(quiet[1], /tel/)
  assert.doesNotMatch(quiet[2], /tel:|class="call"/)
  assert.equal((html.match(/href="tel:/g) ?? []).length, 1)
  // The fixture's bar without a phone (Clearwater) gets no Call link.
  const cw = byPath(buildHubs(bars, all, ctx), '/bars/fl/clearwater/index.html').html
  assert.doesNotMatch(cw, /tel:/)
})

test('badge data blob contains tz and hours only for admitted bars on the city page', () => {
  const hours = [{ day: 1, open: '10:00', close: '22:00' }]
  const list = [mk('ChIJh1', 'Live', 'Tampa', 5, { tz: 'America/New_York', hours }), mk('ChIJh2', 'Hidden', 'Tampa', 5, { tz: 'America/New_York', hours }),
    mk('ChIJh3', 'NoHours', 'Tampa', 6, { tz: 'America/New_York', hours: null }), mk('ChIJh4', 'NoTz', 'Tampa', 6, { tz: null, hours })]
  const html = byPath(buildHubs(list, new Set(['ChIJh1', 'ChIJh3', 'ChIJh4']), ctx), '/bars/fl/tampa/index.html').html
  const blob = JSON.parse(/<script type="application\/json" id="hub-data">([\s\S]*?)<\/script>/.exec(html)[1])
  assert.deepEqual(blob, { ChIJh1: { tz: 'America/New_York', hours } })
  assert.match(html, /<span class="badge" data-badge="ChIJh1" hidden><\/span>/)
  assert.equal((html.match(/data-badge=/g) ?? []).length, 1)
  assert.match(html, /<script type="module">[\s\S]*function openState\b[\s\S]*initHubs\(document, new Date\(\)\)\s*<\/script>/)
  assert.doesNotMatch(html, /^export |^import /m)
  // Pages with no hours data ship no client at all.
  const others = buildHubs(list, new Set(['ChIJh1']), ctx).filter((h) => h.path !== '/bars/fl/tampa/index.html')
  for (const h of others) assert.doesNotMatch(h.html, /<script type="module">|id="hub-data"/, h.path)
  // The badge uses the shared openState: Monday 15:00 in New York is open until 10 PM; Tuesday is closed.
  assert.deepEqual(badgeFor(blob.ChIJh1, new Date('2026-10-26T19:00:00Z')), { open: true, text: 'Open now', sep: 'closes 10 PM' })
  assert.equal(badgeFor(blob.ChIJh1, new Date('2026-10-27T19:00:00Z')).open, false)
  assert.equal(badgeFor(undefined, new Date()), null)
  assert.equal(badgeFor({ tz: null, hours }, new Date()), null)
})

// ---------- all hubs ----------

test('hubs list only admitted bars', () => {
  const some = new Set(['ChIJAaaaaa111', 'ChIJHhhhhh888'])
  const hubs = buildHubs(bars, some, ctx)
  const tampa = byPath(hubs, '/bars/fl/tampa/index.html').html
  assert.match(tampa, /\/bars\/fl\/tampa\/kava-haven\//)
  assert.doesNotMatch(tampa, /kava-haven-bbbbbb/)
  assert.match(text(linkInner(byPath(hubs, '/bars/fl/index.html').html, '/bars/fl/tampa/')), /1 bar\b/)
  assert.doesNotMatch(JSON.stringify(hubs), /root-down-kava|kava-haven-bbbbbb|no-phone-kava/)
})

test('hub with no admitted bars is noindex and says nothing is listed yet', () => {
  const other = mk('ChIJo1', 'Out', 'Austin', 4, { state: 'TX' })
  const list = [...bars, other]
  const hubs = buildHubs(list, all, ctx)
  for (const p of ['/bars/tx/index.html', '/bars/tx/austin/index.html']) {
    const h = byPath(hubs, p)
    assert.ok(h, p)
    assert.equal(h.indexable, false)
    assert.match(h.html, /<meta name="robots" content="noindex">/)
    assert.match(h.html, /No bars listed here yet\./)
    assert.doesNotMatch(h.html, /bars\/tx\/austin\/out\//)
    assert.ok(h.html.includes(footerFragment))
    assert.doesNotMatch(stripScripts(h.html), /\d{4}-\d{2}-\d{2}/)
  }
  assert.match(byPath(hubs, '/bars/tx/index.html').html, /href="\/bars\/tx\/austin\/"/)
  assert.match(byPath(hubs, '/bars/index.html').html, /href="\/bars\/tx\/"/)
  assert.equal(byPath(hubs, '/bars/index.html').indexable, true)
  assert.deepEqual(buildHubs([], new Set(), ctx), [])
  const none = buildHubs(bars, new Set(), ctx)
  assert.ok(none.length > 0 && none.every((h) => h.indexable === false && /name="robots" content="noindex"/.test(h.html) && /No bars listed here yet\./.test(h.html)))
  const withIt = buildHubs(list, new Set([...all, 'ChIJo1']), ctx)
  assert.equal(byPath(withIt, '/bars/tx/austin/index.html').indexable, true)
})

test('hub with admitted bars is indexable and lists only admitted bars', () => {
  const some = new Set(['ChIJAaaaaa111'])
  const hubs = buildHubs(bars, some, ctx)
  const tampa = byPath(hubs, '/bars/fl/tampa/index.html')
  assert.equal(tampa.indexable, true)
  assert.doesNotMatch(tampa.html, /name="robots"/)
  assert.match(tampa.html, /kava-haven\//)
  assert.doesNotMatch(tampa.html, /kava-haven-bbbbbb/)
  const orlando = byPath(hubs, '/bars/fl/orlando/index.html')
  assert.equal(orlando.indexable, false)
  assert.doesNotMatch(orlando.html, /orlando-kava\//)
  const st = byPath(hubs, '/bars/fl/index.html').html
  assert.match(text(linkInner(st, '/bars/fl/tampa/')), /1 bar\b/)
  assert.match(text(linkInner(st, '/bars/fl/orlando/')), /No bars listed yet/)
})

test('every breadcrumb target of a rendered bar page exists as a hub file when only some bars are admitted', () => {
  const hubs = buildHubs(bars, new Set(['ChIJAaaaaa111']), ctx)
  const have = new Set(hubs.map((h) => h.path))
  for (const b of bars) {
    const [, st, city] = b.path.split('/').filter(Boolean)
    for (const target of [`/bars/${st}/index.html`, `/bars/${st}/${city}/index.html`]) assert.ok(have.has(target), target)
  }
  // Every /bars/ link on every hub resolves to a hub or the one admitted bar page.
  const files = new Set([...have, '/bars/fl/tampa/kava-haven/index.html'])
  for (const h of hubs) {
    for (const m of h.html.matchAll(/href="(\/bars\/[^"]*)"/g)) assert.ok(files.has(m[1] + 'index.html'), `${h.path} -> ${m[1]}`)
  }
})

test('hub html is byte-identical across two builds', () => {
  const some = new Set(['ChIJAaaaaa111', 'ChIJBbbbbb222'])
  const a = buildHubs(bars, some, ctx)
  const b = buildHubs([...bars].reverse(), new Set([...some].reverse()), ctx)
  assert.deepEqual(a.map((h) => h.path), b.map((h) => h.path))
  for (let i = 0; i < a.length; i++) assert.ok(a[i].html === b[i].html, a[i].path)
})

test('hub pages print no dates and contain no mailto outside the footer', () => {
  for (const h of buildHubs(bars, all, ctx)) {
    assert.ok(h.html.includes(footerFragment), h.path)
    const own = h.html.replace(footerFragment, '')
    assert.doesNotMatch(own, /mailto:/i, h.path)
    assert.doesNotMatch(stripScripts(h.html), /\d{4}-\d{2}-\d{2}/, h.path)
    assert.doesNotMatch(own, /Correct this page|Sample data|mocknav/i, h.path)
  }
})

test('names with <, &, quotes and {{x}} are escaped in cards, chips and JSON-LD', () => {
  const evilName = `<script>alert(1)</script> & "Q" 'x' {{x}}`
  const evilCity = `<i>Town</i> & "Co" {{x}}`
  const list = [mk('ChIJe1', evilName, 'Tampa', 4, { index: { total: 90 } }), mk('ChIJe2', 'Ok', evilCity, 5), mk('ChIJe3', 'Other', 'Tampa', 6)]
  const hubs = buildHubs(list, ids(list), ctx)
  const escName = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Q&quot; &#39;x&#39; {{x}}'
  const escCity = '&lt;i&gt;Town&lt;/i&gt; &amp; &quot;Co&quot; {{x}}'
  for (const h of hubs) {
    assert.doesNotMatch(stripScripts(h.html), /<script>alert|<i>Town/, h.path)
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h.html)[1]
    assert.ok(!ld.includes('<'), h.path)
    assert.ok(ldOf(h.html)['@graph'].some((n) => n['@type'] === 'ItemList'))
  }
  const landing = byPath(hubs, '/bars/index.html').html
  assert.ok(landing.includes(`<span class="tn">${escName}</span>`), 'cheapest band card')
  assert.ok(hasChip(landing, escCity, '1 bar'), 'popular-city chip')
  const st = byPath(hubs, '/bars/fl/index.html').html
  assert.ok(st.includes(`<span class="t">${escCity}</span>`), 'city card')
  assert.ok(st.includes(`<span class="tp">${escName}</span>`), 'top-rated card')
  const tampa = byPath(hubs, '/bars/fl/tampa/index.html').html
  assert.ok(tampa.includes(`<span class="rk">#1</span>${escName}</span>`), 'bar card')
  assert.ok(hasChip(tampa, escCity, '1 bar'), 'other-city chip')
  const cityPath = list[1].path.split('/').slice(0, 4).join('/') + '/index.html'
  assert.ok(byPath(hubs, cityPath).html.includes(`<title>Kava bars in ${escCity}, FL | KavaCrawl</title>`))
  const names = ldOf(tampa)['@graph'].find((n) => n['@type'] === 'ItemList').itemListElement.map((i) => i.name)
  assert.ok(names.includes(evilName))
})

test('hubs: canonical, footer, ItemList, breadcrumbs, determinism, no dates or external scripts', () => {
  const hubs = buildHubs(bars, all, ctx)
  assert.deepEqual(hubs.map((h) => h.path), [
    '/bars/index.html', '/bars/fl/index.html', '/bars/fl/clearwater/index.html', '/bars/fl/orlando/index.html',
    '/bars/fl/st-petersburg/index.html', '/bars/fl/tampa/index.html'])
  assert.deepEqual(hubs, buildHubs(bars, all, ctx))
  for (const { path, html } of hubs) {
    const canon = path.replace(/index\.html$/, '')
    assert.ok(html.includes(`<link rel="canonical" href="${cfg.SITE_URL}${canon}">`), path)
    assert.ok(html.includes(footerFragment))
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
    assert.doesNotMatch(stripScripts(html), /\d{4}-\d{2}-\d{2}/)
    assert.doesNotMatch(html, /<script[^>]+src=/)
    assert.doesNotMatch(html, /name="robots"/)
    assert.match(html, /\.bcard\{/, 'hub CSS inlined')
    const types = ldOf(html)['@graph'].map((n) => n['@type'])
    assert.ok(types.includes('ItemList'))
    assert.ok(types.includes('BreadcrumbList'))
  }
  const city = byPath(hubs, '/bars/fl/tampa/index.html').html
  assert.match(city, /class="crumb"[\s\S]*href="\/bars\/"[\s\S]*href="\/bars\/fl\/"/)
  const trail = ldOf(city)['@graph'].find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.item)
  assert.deepEqual(trail, [`${cfg.SITE_URL}/bars/`, `${cfg.SITE_URL}/bars/fl/`, `${cfg.SITE_URL}/bars/fl/tampa/`])
})

test('bar pages do not get the hub CSS', async () => {
  const { renderBar } = await import('../scripts/lib/site/render.mjs')
  const html = renderBar(bars[0], ctx)
  assert.doesNotMatch(html, /\.bcard\{|\.fcard\{/)
})
