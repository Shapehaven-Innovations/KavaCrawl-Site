import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as R from '../assets/dash-render.mjs'

const BAD = '<b>x</b>'
const ESCAPED = '&lt;b&gt;x&lt;/b&gt;'

const clean = (html) => {
  assert.equal(typeof html, 'string')
  assert.ok(!/NaN|Infinity|undefined/.test(html), `bad token in: ${html}`)
  return html
}

test('esc escapes markup and quotes', () => {
  assert.equal(R.esc(BAD), ESCAPED)
  assert.equal(R.esc('a"b\'c&d'), 'a&quot;b&#39;c&amp;d')
  assert.equal(R.esc(null), '')
  assert.equal(R.esc(undefined), '')
  assert.equal(R.esc(7), '7')
})

test('fmt uses thousands separators and a dash for missing values', () => {
  assert.equal(R.fmt(1234), '1,234')
  assert.equal(R.fmt(0), '0')
  assert.equal(R.fmt(null), '—')
  assert.equal(R.fmt(undefined), '—')
  assert.equal(R.fmt(Number.NaN), '—')
  assert.equal(R.fmt(Infinity), '—')
  assert.equal(R.fmt(2.25, 1), '2.3')
  assert.equal(R.fmt(3, 1), '3.0')
})

test('pct gives one-decimal percentages and a dash for a zero total', () => {
  assert.equal(R.pct(216, 322), '67.1%')
  assert.equal(R.pct(1, 3, 0), '33%')
  assert.equal(R.pct(5, 0), '—')
  assert.equal(R.pct(Number.NaN, 10), '—')
})

test('TYPE_COLORS holds the nine spec colours and no Other', () => {
  assert.deepEqual(R.TYPE_COLORS, {
    Games: '#6ece8d', Specials: '#e9d56b', Trivia: '#3fb6b2', 'Open mic': '#5f8fe8', Music: '#b58be0',
    Karaoke: '#e0709a', Community: '#a8cf5a', 'Movie night': '#f2ece0', Art: '#d9a066',
  })
})

test('unavailable returns the data unavailable block', () => {
  assert.match(R.unavailable(), /Data unavailable/)
  assert.match(R.unavailable(BAD), new RegExp(ESCAPED))
})

const item = { label: BAD, value: 3, color: '#6ece8d' }
const city = { city: BAD, st: 'FL', venues: 4 }
const state = { st: 'FL', name: BAD, venues: 4 }
const dens = { name: BAD, venues: 4, cities: 2, avg: 2 }

const calls = {
  columnsHtml: (a) => R.columnsHtml(a),
  barsHtml: (a) => R.barsHtml(a),
  shareHtml: (a) => R.shareHtml(a),
  chipsHtml: (a) => R.chipsHtml(a),
  donutSvg: (a) => R.donutSvg(a, '3', BAD),
  legendHtml: (a) => R.legendHtml(a),
  heatHtml: (a) => R.heatHtml(a && a.map((x) => ({ label: x.label, color: x.color, values: [1, 0, 2, 0, 0, 0, 0] })), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
  lollipopSvg: (a) => R.lollipopSvg(a),
  topCitiesHtml: (a) => R.topCitiesHtml(a?.length ? [city] : [], 'FL', 'Florida'),
  citySizesHtml: (a) => R.citySizesHtml(a?.length ? [{ label: BAD, cities: 3 }] : [], 3, 4, 0, 0),
  concentrationHtml: (a) => R.concentrationHtml(a?.length ? [state] : [], 4),
  densityHtml: (a) => R.densityHtml(a?.length ? [dens] : [], 2),
}

for (const [name, fn] of Object.entries(calls)) {
  test(`${name} escapes labels`, () => {
    const html = clean(fn([item]))
    assert.ok(!html.includes(BAD), `${name} leaked raw markup`)
    assert.ok(html.includes(ESCAPED), `${name} lost the label`)
  })
  test(`${name} returns the unavailable block for empty input`, () => {
    assert.match(clean(fn([])), /unavailable/)
  })
  test(`${name} survives non-array input`, () => {
    assert.match(clean(fn(null)), /unavailable/)
  })
}

test('barsHtml never prints NaN or Infinity', () => {
  clean(R.barsHtml([{ label: 'A', value: Number.NaN }]))
  clean(R.barsHtml([{ label: 'A', value: Infinity }, { label: 'B', value: 2 }], { decimals: 1 }))
  clean(R.columnsHtml([{ label: 'A', value: Number.NaN }]))
  clean(R.columnsHtml([{ label: 'A', value: 0 }]))
  clean(R.shareHtml([{ label: 'A', value: Number.NaN, color: '#fff' }, { label: 'B', value: 1, color: '#000' }]))
})

test('barsHtml uses the gold track and decimals when asked', () => {
  const html = R.barsHtml([{ label: 'A', value: 2.25 }], { gold: true, decimals: 1 })
  assert.match(html, /track gold/)
  assert.match(html, />2\.3</)
})

test('columnsHtml marks the tallest column top', () => {
  const html = R.columnsHtml([{ label: 'a', value: 1 }, { label: 'b', value: 3 }])
  assert.equal((html.match(/class="col top"/g) || []).length, 1)
  assert.match(html, /class="col top"><b>3<\/b>/)
})

test('donutSvg draws one path per non-zero slice', () => {
  const html = R.donutSvg([{ label: 'a', value: 1, color: '#6ece8d' }, { label: 'b', value: 1, color: '#e9d56b' }], '2', 'weekly events')
  assert.equal((html.match(/<path/g) || []).length, 2)
  assert.match(html, /weekly events/)
  clean(R.donutSvg([{ label: 'a', value: 5, color: '#6ece8d' }], '5', 'x'))
  assert.match(R.donutSvg([{ label: 'a', value: 0, color: '#fff' }], '0', 'x'), /unavailable/)
})

test('colours that are not plain colour values are replaced', () => {
  const html = R.shareHtml([{ label: 'a', value: 1, color: 'red;background:url(x)' }])
  assert.ok(!html.includes('url('))
})

test('heatHtml renders a dot for zero cells and a total per row', () => {
  const html = R.heatHtml([{ label: 'Games', color: '#6ece8d', values: [0, 2, 3, 0, 0, 0, 1] }], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  assert.match(html, />·</)
  assert.match(html, /class="tot">6</)
  assert.match(html, /<span>Sun<\/span>/)
})

test('topCitiesHtml colours the lead state mint and others gold', () => {
  const html = R.topCitiesHtml([{ city: 'Tampa', st: 'FL', venues: 10 }, { city: 'Austin', st: 'TX', venues: 5 }], 'FL', 'Florida')
  assert.match(html, /Tampa, FL/)
  assert.match(html, /--c:#6ece8d/)
  assert.match(html, /--c:#e9d56b/)
  assert.match(html, /Florida/)
  assert.match(html, /Elsewhere/)
})

test('citySizesHtml prints counts, shares and a computed takeaway', () => {
  const sizes = [
    { label: '1 venue', cities: 79 }, { label: '2 venues', cities: 32 }, { label: '3 to 4 venues', cities: 12 },
    { label: '5 to 9 venues', cities: 14 }, { label: '10+ venues', cities: 5 },
  ]
  const html = R.citySizesHtml(sizes, 142, 322, 54, 5)
  assert.match(html, /55\.6%/)
  assert.match(html, /3\.5%/)
  const text = html.replace(/<[^>]+>/g, '')
  assert.match(text, /79 of 142 cities \(55\.6%\) have a single venue\. The 5 cities with 10 or more hold 54 venues, 16\.8% of the total\./)
})

test('concentrationHtml shows the lead share, grouped legend and slice labels', () => {
  const byState = [
    { st: 'FL', name: 'Florida', venues: 216 }, { st: 'CA', name: 'California', venues: 37 },
    { st: 'NC', name: 'North Carolina', venues: 17 }, { st: 'TX', name: 'Texas', venues: 52 },
  ]
  const html = clean(R.concentrationHtml(byState, 322))
  assert.match(html, /67\.1%/)
  assert.match(html, /Florida/)
  assert.match(html, /3 more states, 32\.9% of venues/)
  assert.equal((html.match(/<path/g) || []).length, 4)
  assert.equal((html.match(/<li /g) || []).length, 3)
  // slices of 8% or more get a label: FL 67.1, CA 11.5, TX 16.1; NC 5.3 does not
  assert.equal((html.match(/<text[^>]*class="sl"/g) || []).length, 3)
  assert.match(html, /#6ece8d/)
})

test('concentrationHtml slice tooltip uses singular for a one-venue state', () => {
  const byState = [{ st: 'FL', name: 'Florida', venues: 299 }, { st: 'MD', name: 'Maryland', venues: 1 }]
  const html = clean(R.concentrationHtml(byState, 300))
  assert.match(html, /Maryland: 1 venue \(0\.3%\)/)
  assert.ok(!html.includes('1 venues'))
  assert.match(html, /Florida: 299 venues/)
})

test('densityHtml shows venue/city wording, the average marker and up bars', () => {
  const items = [
    { name: 'Florida', venues: 216, cities: 71, avg: 3.04 },
    { name: 'Missouri', venues: 1, cities: 1, avg: 1 },
  ]
  const html = clean(R.densityHtml(items, 2.27))
  assert.match(html, /216 venues in 71 cities/)
  assert.match(html, /1 venue in 1 city/)
  assert.match(html, /All states average 2\.3/)
  assert.equal((html.match(/class="up"/g) || []).length, 1)
  assert.match(html, /<u style="left:/)
  assert.match(html, /--n:1/)
  clean(R.densityHtml(items, Number.NaN))
})

test('bindConcentration tolerates a root with nothing to bind', () => {
  assert.doesNotThrow(() => R.bindConcentration(null))
  assert.doesNotThrow(() => R.bindConcentration({ querySelector: () => null }))
})

test('state-level helpers return the unavailable block for non-array input', () => {
  assert.match(clean(R.topCitiesHtml(null, 'FL')), /unavailable/)
  assert.match(clean(R.citySizesHtml(undefined, 0, 0, 0, 0)), /unavailable/)
  assert.match(clean(R.concentrationHtml(null, 0)), /unavailable/)
  assert.match(clean(R.densityHtml('x', 2)), /unavailable/)
  assert.match(clean(R.heatHtml(null, null)), /unavailable/)
})
