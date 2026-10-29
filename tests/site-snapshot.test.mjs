import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SQL } from '../scripts/lib/site/queries.mjs'
import { evaluate } from '../scripts/lib/site/gate.mjs'
import { assignPaths, slugify } from '../scripts/lib/site/slugs.mjs'
import { nearest } from '../scripts/lib/site/neighbors.mjs'
import { admit } from '../scripts/lib/site/admit.mjs'
import { buildBars, curatedIds } from '../scripts/lib/site/snapshot.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/site/${name}`, import.meta.url), 'utf8'))
const input = fixture('d1.json')
const curated = curatedIds(fixture('venues.json'))
const cfg = JSON.parse(readFileSync(new URL('../scripts/site-config.json', import.meta.url), 'utf8'))
const NOW = '2026-10-28'
const place = (id) => input.places.find((p) => p.place_id === id)
const build = (existing = {}) => buildBars(input, curated, existing, cfg, NOW)
const barOf = (out, id) => out.bars.find((b) => b.place_id === id)

test('SQL has exactly the five bulk selects with no bound params', () => {
  assert.deepEqual(Object.keys(SQL).sort(), ['events', 'latestPrices', 'places', 'scores', 'shellHistory'])
  for (const sql of Object.values(SQL)) {
    assert.equal(typeof sql, 'string')
    assert.ok(!sql.includes('?'), 'no bound params')
    assert.match(sql, /^\s*SELECT/i)
  }
  assert.match(SQL.places, /hidden/)
  assert.match(SQL.shellHistory, /-182 days/)
  for (const c of ['kava_shell', 'kava_double', 'kava_brew', 'kava_shot']) assert.ok(SQL.shellHistory.includes(`'${c}'`))
  assert.match(SQL.events, /source = 'mykavabar'/)
  assert.match(SQL.events, /hidden = 1/)
  assert.match(SQL.latestPrices, /MAX\(observed_on\)/i)
})

test('evaluate rejects each excluded reason with the right code', () => {
  const ok = place('ChIJAaaaaa111')
  const all = new Set(input.places.map((p) => p.place_id))
  const good = evaluate(ok, all)
  assert.equal(good.ok, true)
  assert.deepEqual(good.parts, { street: '100 Franklin St', city: 'Tampa', state: 'FL', zip: '33602' })
  assert.deepEqual(good.phone, { e164: '+18135550100', display: '(813) 555-0100' })

  assert.deepEqual(evaluate(place('ChIJFfffff666'), curated), { ok: false, reason: 'not-curated' })
  assert.deepEqual(evaluate(place('ChIJDddddd444'), curated), { ok: false, reason: 'hidden' })
  assert.deepEqual(evaluate(place('ChIJGggggg777'), curated), { ok: false, reason: 'no-state-city' })
  assert.deepEqual(evaluate({ ...ok, business_status: 'CLOSED_PERMANENTLY' }, all), { ok: false, reason: 'not-operational' })
  assert.deepEqual(evaluate({ ...ok, business_status: null }, all), { ok: false, reason: 'not-operational' })
  assert.deepEqual(evaluate({ ...ok, formatted_address: null }, all), { ok: false, reason: 'no-address' })
  assert.deepEqual(evaluate({ ...ok, formatted_address: '  ' }, all), { ok: false, reason: 'no-address' })
  assert.deepEqual(evaluate({ ...ok, name: '' }, all), { ok: false, reason: 'no-address' })
  assert.deepEqual(evaluate({ ...ok, lat: null }, all), { ok: false, reason: 'no-coords' })
  assert.deepEqual(evaluate({ ...ok, lng: 'x' }, all), { ok: false, reason: 'no-coords' })
  assert.deepEqual(evaluate({ ...ok, formatted_address: '1 Main St, Tampa, ZZ 33602, USA' }, all), { ok: false, reason: 'no-state-city' })
  // A phoneless bar still fails on its other faults.
  assert.deepEqual(evaluate({ ...ok, phone: null, hidden: 1 }, all), { ok: false, reason: 'hidden' })
  assert.deepEqual(evaluate({ ...ok, phone: null, lat: null }, all), { ok: false, reason: 'no-coords' })
})

test('evaluate accepts a bar with a null phone and returns phone null', () => {
  const e = evaluate(place('ChIJEeeeee555'), curated)
  assert.deepEqual(e, { ok: true, parts: { street: '500 Cleveland St', city: 'Clearwater', state: 'FL', zip: '33755' }, phone: null })
  const ok = place('ChIJAaaaaa111')
  assert.equal(evaluate({ ...ok, phone: undefined }, curated).phone, null)
  assert.equal(evaluate({ ...ok, phone: '' }, curated).phone, null)
})

test('evaluate treats an unparsable phone as absent (still ok)', () => {
  const ok = place('ChIJAaaaaa111')
  for (const phone of ['555-0100', 'call us', '+44 20 7946 0958', 12345]) {
    const e = evaluate({ ...ok, phone }, curated)
    assert.equal(e.ok, true, String(phone))
    assert.equal(e.phone, null, String(phone))
  }
})

test('assignPaths gives distinct stable paths to same-name bars in one city', () => {
  const bars = [
    { place_id: 'ChIJBbbbbb222', name: 'Kava Haven', state: 'FL', city: 'Tampa' },
    { place_id: 'ChIJAaaaaa111', name: 'Kava Haven', state: 'FL', city: 'Tampa' },
  ]
  const paths = assignPaths(bars, {})
  assert.deepEqual(paths, {
    ChIJAaaaaa111: '/bars/fl/tampa/kava-haven/',
    ChIJBbbbbb222: '/bars/fl/tampa/kava-haven-bbbbbb/',
  })
  assert.deepEqual(assignPaths([...bars].reverse(), {}), paths, 'input order does not matter')
  assert.deepEqual(assignPaths(bars, paths), paths, 'second run is a no-op')
  assert.equal(slugify("Kava's Café & Bar"), 'kavas-cafe-and-bar')
  assert.equal(slugify('St. Petersburg'), 'st-petersburg')
})

test('assignPaths keeps an existing path after the bar is renamed', () => {
  const existing = { ChIJAaaaaa111: '/bars/fl/tampa/kava-haven/' }
  const out = assignPaths([{ place_id: 'ChIJAaaaaa111', name: 'Brand New Name', state: 'FL', city: 'Brandon' }], existing)
  assert.deepEqual(out, existing)
  // A bar dropped from the input keeps its entry.
  assert.deepEqual(assignPaths([], existing), existing)
})

test('assignPaths never reassigns a taken path', () => {
  // The old owner of /kava-haven/ is gone from the input but its path stays reserved.
  const existing = { ChIJZzzzzz000: '/bars/fl/tampa/kava-haven/', ChIJYyyyyy000: '/bars/fl/tampa/kava-haven-aaaaaa/' }
  const out = assignPaths([{ place_id: 'ChIJAaaaaa111', name: 'Kava Haven', state: 'FL', city: 'Tampa' }], existing)
  assert.equal(out.ChIJZzzzzz000, existing.ChIJZzzzzz000)
  assert.equal(out.ChIJYyyyyy000, existing.ChIJYyyyyy000)
  assert.ok(out.ChIJAaaaaa111.startsWith('/bars/fl/tampa/kava-haven-aaaaaa'))
  assert.notEqual(out.ChIJAaaaaa111, existing.ChIJYyyyyy000)
  assert.equal(new Set(Object.values(out)).size, Object.keys(out).length)
  assert.match(out.ChIJAaaaaa111, /^\/bars\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+\/$/)
})

const pt = (place_id, lat, lng) => ({ place_id, lat, lng })

test('nearest returns 3 within 25 miles ordered by distance then place_id', () => {
  const me = pt('me', 28, -82)
  const all = [
    me,
    pt('far', 29, -82), // ~69 mi
    pt('d', 28.1, -82), // ~6.9 mi
    pt('c', 28, -81.95), // equal distance east/west of me
    pt('b', 28, -82.05),
    pt('a', 28.2, -82), // ~13.8 mi
    pt('e', 28.3, -82), // ~20.7 mi
  ]
  const out = nearest(me, all, cfg)
  assert.deepEqual(out.map((n) => n.place_id), ['b', 'c', 'd'])
  assert.ok(out.every((n) => typeof n.miles === 'number' && n.miles <= 25))
  assert.ok(out[0].miles <= out[2].miles)
})

test('nearest returns fewer when fewer exist and [] when none', () => {
  const me = pt('me', 28, -82)
  assert.deepEqual(nearest(me, [me, pt('x', 28.1, -82), pt('far', 30, -82)], cfg).map((n) => n.place_id), ['x'])
  assert.deepEqual(nearest(me, [me, pt('far', 30, -82)], cfg), [])
  assert.deepEqual(nearest(me, [me], cfg), [])
})

test('admit keeps admitted ids and adds at most max new in index order with nulls last', () => {
  const candidates = [
    { place_id: 'n1', indexTotal: null },
    { place_id: 'b', indexTotal: 50 },
    { place_id: 'a', indexTotal: 50 },
    { place_id: 'c', indexTotal: 90 },
    { place_id: 'kept', indexTotal: 1 },
    { place_id: 'n0', indexTotal: null },
  ]
  const already = new Set(['kept', 'gone'])
  assert.deepEqual([...admit(candidates, already, 3)].sort(), ['a', 'b', 'c', 'kept'])
  assert.deepEqual([...admit(candidates, already, 4)].sort(), ['a', 'b', 'c', 'kept', 'n0'])
  assert.deepEqual([...admit(candidates, already, 0)], ['kept'])
  assert.deepEqual([...admit(candidates, already, 99)].sort(), ['a', 'b', 'c', 'kept', 'n0', 'n1'])
  assert.deepEqual([...admit(candidates, new Set(), 2)], ['c', 'a'])
})

test('buildBars skips a curated id missing from D1 and reports it', () => {
  const out = build()
  assert.deepEqual(out.skipped, [
    { place_id: 'ChIJDddddd444', reason: 'hidden' },
    { place_id: 'ChIJGggggg777', reason: 'no-state-city' },
    { place_id: 'ChIJMissing999', reason: 'not-in-d1' },
  ])
  assert.deepEqual(out.bars.map((b) => b.place_id).sort(), ['ChIJAaaaaa111', 'ChIJBbbbbb222', 'ChIJCccccc333', 'ChIJEeeeee555', 'ChIJHhhhhh888'])
  assert.equal(barOf(out, 'ChIJFfffff666'), undefined, 'non-curated bars never appear')
})

test('buildBars fills the Bar shape', () => {
  const out = build({ ChIJAaaaaa111: '/bars/fl/tampa/old-name/' })
  const a = barOf(out, 'ChIJAaaaaa111')
  assert.deepEqual(Object.keys(a).sort(), [
    'city', 'compare', 'events', 'history', 'hours', 'index', 'lat', 'lng', 'menu', 'metro', 'name', 'neighbors',
    'path', 'phone', 'place_id', 'shell', 'slug', 'state', 'street', 'tz', 'website', 'zip',
  ])
  assert.equal(a.path, '/bars/fl/tampa/old-name/')
  assert.equal(a.slug, 'old-name')
  assert.equal(a.tz, 'America/New_York')
  assert.deepEqual(a.hours, [{ day: 1, open: '17:00', close: '02:00' }])
  assert.deepEqual(a.index, { total: 80.5, components: { price: 20, vibe: 30 } })
  assert.equal(a.website, 'https://kavahaven.example')
  assert.equal(a.menu.items.length, 4)
  assert.deepEqual(a.menu.items[0], { name: 'Chips', category: 'food', price: 2, size_oz: null, shell_equiv: null })
  assert.deepEqual(a.neighbors.map((n) => n.place_id), ['ChIJBbbbbb222', 'ChIJCccccc333', 'ChIJEeeeee555'])
  assert.deepEqual(Object.keys(a.neighbors[0]).sort(), ['indexTotal', 'miles', 'name', 'path', 'place_id', 'shell'])
  assert.equal(a.neighbors[0].path, '/bars/fl/tampa/kava-haven/', 'A kept its old path, so B takes the free base slug')
  assert.equal(a.neighbors[0].indexTotal, 70)
  assert.equal(a.neighbors[1].indexTotal, null)

  const b = barOf(out, 'ChIJBbbbbb222')
  assert.equal(b.website, null, 'non-http website dropped')
  assert.equal(b.hours, null)
  assert.equal(barOf(out, 'ChIJCccccc333').index, null, 'null total means no index')
  assert.equal(barOf(out, 'ChIJCccccc333').path, '/bars/fl/st-petersburg/root-down-kava/')
  const h = barOf(out, 'ChIJHhhhhh888')
  assert.deepEqual(h.index, { total: 65, components: {} })
  assert.deepEqual(h.neighbors, [])
  assert.deepEqual(out.paths, {
    ChIJAaaaaa111: '/bars/fl/tampa/old-name/',
    ChIJBbbbbb222: '/bars/fl/tampa/kava-haven/',
    ChIJCccccc333: '/bars/fl/st-petersburg/root-down-kava/',
    ChIJEeeeee555: '/bars/fl/clearwater/no-phone-kava/',
    ChIJHhhhhh888: '/bars/fl/orlando/orlando-kava/',
  })
  assert.deepEqual(JSON.stringify(build({ ChIJAaaaaa111: '/bars/fl/tampa/old-name/' })), JSON.stringify(out), 'deterministic')
})

test('buildBars keeps a phoneless bar and sets phone null', () => {
  const out = build()
  const e = barOf(out, 'ChIJEeeeee555')
  assert.ok(e, 'phoneless curated bar gets a page')
  assert.equal(e.phone, null)
  assert.equal(e.path, '/bars/fl/clearwater/no-phone-kava/')
  assert.equal(e.shell, null)
  assert.equal(e.compare, null)
  assert.deepEqual(e.neighbors.map((n) => n.place_id), ['ChIJCccccc333', 'ChIJAaaaaa111', 'ChIJBbbbbb222'])
  assert.deepEqual(barOf(out, 'ChIJAaaaaa111').phone, { e164: '+18135550100', display: '(813) 555-0100' })
  assert.ok(!out.skipped.some((s) => s.reason === 'no-phone'))
  const unparsable = buildBars({ ...input, places: input.places.map((p) => (p.place_id === 'ChIJBbbbbb222' ? { ...p, phone: '555-01' } : p)) }, curated, {}, cfg, NOW)
  assert.equal(barOf(unparsable, 'ChIJBbbbbb222').phone, null)
})

test('buildBars computes shell, metroMedianShell, pctVsMetro and rank on a fixture', () => {
  const out = build()
  const a = barOf(out, 'ChIJAaaaaa111')
  const b = barOf(out, 'ChIJBbbbbb222')
  const c = barOf(out, 'ChIJCccccc333')
  assert.equal(a.shell, 5)
  assert.equal(b.shell, 6)
  assert.equal(c.shell, 6)
  assert.deepEqual(a.compare, { metroMedianShell: 6, pctVsMetro: -16.7, rank: 1, total: 3 })
  assert.deepEqual(b.compare, { metroMedianShell: 6, pctVsMetro: 0, rank: 2, total: 3 })
  assert.deepEqual(c.compare, { metroMedianShell: 6, pctVsMetro: 0, rank: 2, total: 3 })
})

test('buildBars leaves compare null when the metro has fewer than 3 shells', () => {
  const out = build()
  const h = barOf(out, 'ChIJHhhhhh888')
  assert.equal(h.shell, 7)
  assert.equal(h.compare, null)
  const fewer = buildBars({ ...input, latestPrices: input.latestPrices.filter((r) => r.place_id !== 'ChIJCccccc333') }, curated, {}, cfg, NOW)
  assert.equal(barOf(fewer, 'ChIJAaaaaa111').compare, null)
  assert.equal(barOf(fewer, 'ChIJCccccc333').shell, null)
  assert.equal(barOf(fewer, 'ChIJCccccc333').menu, null)
})

test('buildBars history is the weekly lowest listed kava_shell price on a fixture', () => {
  const out = build()
  // Rule: kava_shell rows only, listed price_usd (no per-oz conversion), lowest per Monday-start UTC week,
  // rows older than 182 days dropped. The point field is still named `median`.
  assert.deepEqual(barOf(out, 'ChIJAaaaaa111').history, [
    { week: '2026-10-05', median: 5 }, // shells 5 and 6; the brew is not a shell
    { week: '2026-10-12', median: 5.5 }, // shell 5.5 (Sunday belongs to the Monday before); the double is not a shell
    { week: '2026-10-19', median: 14 }, // the 16oz shell at its listed 14
  ])
  assert.deepEqual(barOf(out, 'ChIJBbbbbb222').history, [{ week: '2026-10-19', median: 6 }])
  assert.deepEqual(barOf(out, 'ChIJHhhhhh888').history, [])
})

test('buildBars keeps recurring events and drops long-expired one-offs', () => {
  const out = build()
  const titles = barOf(out, 'ChIJAaaaaa111').events.map((e) => e.title)
  assert.deepEqual(titles, ['Old Recurring', 'Trivia Night', 'Edge One-off', 'Undated One-off', 'Recent One-off'])
  const trivia = barOf(out, 'ChIJAaaaaa111').events[1]
  assert.deepEqual(trivia, {
    title: 'Trivia Night', day_of_week: 1, start_time: '19:00', end_time: '21:00', is_recurring: true, start_date: null, end_date: null,
  })
  assert.equal(barOf(out, 'ChIJAaaaaa111').events[2].is_recurring, false)
  assert.deepEqual(barOf(out, 'ChIJBbbbbb222').events, [])
})

test('compare-venue prints api vs snapshot Index total and menu count without network', async () => {
  const { main, compareRows } = await import('../scripts/dev/compare-venue.mjs')
  const bar = { index: { total: 80.5 }, menu: { items: [1, 2, 3, 4] } }
  assert.deepEqual(compareRows({ score: { total: 80.5 }, prices: { items: [1, 2, 3, 4] } }, bar), [
    ['Index total', 80.5, 80.5, true], ['Menu items', 4, 4, true],
  ])
  assert.deepEqual(compareRows(null, null), [['Index total', null, null, true], ['Menu items', 0, 0, true]])
  const seen = []
  const fetchFn = async (url) => {
    seen.push(url)
    return { ok: true, status: 200, json: async () => ({ name: 'Kava Haven', score: { total: 80.5 }, prices: { items: [{}, {}, {}] } }) }
  }
  const log = console.log
  const lines = []
  console.log = (s) => lines.push(String(s))
  let code
  try {
    code = await main(['ChIJAaaaaa111', '--input', fileURLToPath(new URL('./fixtures/site/d1.json', import.meta.url)),
      '--venues', fileURLToPath(new URL('./fixtures/site/venues.json', import.meta.url))], {}, fetchFn)
  } finally { console.log = log }
  assert.deepEqual(seen, ['https://api.kavacrawl.shapehaveninnovations.com/venues/ChIJAaaaaa111'])
  assert.equal(code, 1, 'menu count differs (3 vs 4)')
  assert.ok(lines.some((l) => /^Index total\s+80\.5\s+80\.5\s+yes$/.test(l)))
  assert.ok(lines.some((l) => /^Menu items\s+3\s+4\s+NO$/.test(l)))
})
