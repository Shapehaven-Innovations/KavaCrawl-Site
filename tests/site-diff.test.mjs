import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { planWrites } from '../scripts/lib/site/diff.mjs'
import { buildSitemaps } from '../scripts/lib/site/sitemaps.mjs'

const sha = (s) => createHash('sha256').update(s).digest('hex')
const none = () => null

test('planWrites writes only changed files', () => {
  const files = [{ path: '/a', html: 'A' }, { path: '/b', html: 'B2' }, { path: '/c', html: 'C' }]
  const existing = {
    '/a': { hash: sha('A'), lastmod: '2026-01-01' },
    '/b': { hash: sha('B'), lastmod: '2026-01-01' },
  }
  const disk = { '/a': 'A', '/b': 'B' }
  const r = planWrites(files, existing, '2026-10-28', (p) => disk[p] ?? null)
  assert.deepEqual(r.writes.map((w) => w.path), ['/b', '/c'])
  assert.deepEqual(r.unchanged, ['/a'])
  assert.deepEqual(r.removals, [])
})

test('planWrites rewrites an unchanged-hash file missing or altered on disk, keeping lastmod', () => {
  const existing = { '/a': { hash: sha('A'), lastmod: '2026-01-01' } }
  const r = planWrites([{ path: '/a', html: 'A' }], existing, '2026-10-28', none)
  assert.deepEqual(r.writes.map((w) => w.path), ['/a'])
  assert.equal(r.lastmod['/a'].lastmod, '2026-01-01')
})

test('lastmod changes only when the hash changes', () => {
  const existing = {
    '/a': { hash: sha('A'), lastmod: '2026-01-01' },
    '/b': { hash: sha('B'), lastmod: '2026-01-01' },
  }
  const r = planWrites(
    [{ path: '/a', html: 'A' }, { path: '/b', html: 'B2' }, { path: '/n', html: 'N' }],
    existing, '2026-10-28', (p) => (p === '/a' ? 'A' : null))
  assert.equal(r.lastmod['/a'].lastmod, '2026-01-01')
  assert.equal(r.lastmod['/b'].lastmod, '2026-10-28')
  assert.equal(r.lastmod['/b'].hash, sha('B2'))
  assert.equal(r.lastmod['/n'].lastmod, '2026-10-28')
})

test('a removed bar yields a removal and is absent from sitemaps', () => {
  const existing = {
    '/bars/fl/tampa/a/': { hash: 'h1', lastmod: '2026-01-01' },
    '/bars/fl/tampa/b/': { hash: 'h2', lastmod: '2026-01-01' },
  }
  const r = planWrites([{ path: '/bars/fl/tampa/a/', html: 'x' }], existing, '2026-10-28', none)
  assert.deepEqual(r.removals, ['/bars/fl/tampa/b/'])
  assert.equal(r.lastmod['/bars/fl/tampa/b/'].hash, 'h2')
  assert.equal(r.lastmod['/bars/fl/tampa/b/'].removedOn, '2026-10-28')
  const entries = Object.keys(r.lastmod)
    .filter((p) => !r.removals.includes(p))
    .map((p) => ({ loc: `https://x.test${p}`, lastmod: r.lastmod[p].lastmod, state: 'fl' }))
  const xml = buildSitemaps(entries, [], 'https://x.test').map((s) => s.xml).join('\n')
  assert.ok(xml.includes('/bars/fl/tampa/a/'))
  assert.ok(!xml.includes('/bars/fl/tampa/b/'))
})

test('removedOn is kept on later runs and stubs older than 90 days expire', () => {
  const existing = {
    '/old': { hash: 'h', lastmod: '2026-01-01', removedOn: '2026-07-01' },
    '/recent': { hash: 'h', lastmod: '2026-01-01', removedOn: '2026-09-01' },
  }
  const r = planWrites([], existing, '2026-10-28', none)
  assert.deepEqual(r.expiredStubs, ['/old'])
  assert.deepEqual(r.removals, ['/recent'])
  assert.equal(r.lastmod['/recent'].removedOn, '2026-09-01')
  assert.ok(!('/old' in r.lastmod))
})

test('a removed bar that returns loses removedOn', () => {
  const existing = { '/a': { hash: sha('A'), lastmod: '2026-01-01', removedOn: '2026-10-01' } }
  const r = planWrites([{ path: '/a', html: 'A' }], existing, '2026-10-28', none)
  assert.ok(!('removedOn' in r.lastmod['/a']))
  assert.deepEqual(r.removals, [])
  assert.deepEqual(r.expiredStubs, [])
})

const S = 'https://x.test'
const bar = (st, n, lastmod = '2026-10-01') => ({ loc: `${S}/bars/${st}/c/b${n}/`, lastmod, state: st })

test('buildSitemaps emits an index pointing at sitemap-pages and per-state files', () => {
  const out = buildSitemaps([bar('hi', 1), bar('fl', 1), bar('fl', 2)],
    [{ loc: `${S}/`, lastmod: '2026-10-01' }, { loc: `${S}/guide/` }], S)
  assert.deepEqual(out.map((o) => o.path), ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-bars-fl.xml', 'sitemap-bars-hi.xml'])
  const idx = out[0].xml
  assert.match(idx, /<sitemapindex/)
  const locs = [...idx.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs, [`${S}/sitemap-pages.xml`, `${S}/sitemap-bars-fl.xml`, `${S}/sitemap-bars-hi.xml`])
  assert.ok(out[1].xml.includes(`<loc>${S}/</loc>`))
  assert.ok(!/<lastmod>\s*<\/lastmod>/.test(out[1].xml))
  assert.equal([...out[1].xml.matchAll(/<lastmod>/g)].length, 1)
})

test('buildSitemaps escapes loc and omits hubs it was not given', () => {
  const out = buildSitemaps([{ loc: `${S}/bars/fl/c/a&b/`, lastmod: '2026-10-01', state: 'fl' }], [], S)
  assert.ok(out[2].xml.includes('a&amp;b'))
})

test('buildSitemaps splits at 50000 urls', () => {
  const entries = Array.from({ length: 50001 }, (_, i) => bar('fl', String(i).padStart(6, '0')))
  const out = buildSitemaps(entries, [], S)
  assert.deepEqual(out.map((o) => o.path), ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-bars-fl.xml', 'sitemap-bars-fl-2.xml'])
  assert.equal([...out[2].xml.matchAll(/<url>/g)].length, 50000)
  assert.equal([...out[3].xml.matchAll(/<url>/g)].length, 1)
  assert.equal([...out[0].xml.matchAll(/<sitemap>/g)].length, 3)
})

test('non-admitted bars are not in any sitemap', () => {
  const admitted = [bar('fl', 1)]
  const out = buildSitemaps(admitted, [], S)
  const all = out.map((o) => o.xml).join('\n')
  assert.ok(all.includes('/b1/'))
  assert.ok(!all.includes('/b2/'))
  assert.equal(buildSitemaps([{ loc: `${S}/x/`, lastmod: 'd', state: null }], [], S).length, 2)
})

test('output is byte-identical on repeat', () => {
  const a = [bar('fl', 2), bar('fl', 1), bar('al', 1)]
  const p = [{ loc: `${S}/guide/` }, { loc: `${S}/`, lastmod: '2026-10-01' }]
  const r1 = buildSitemaps(a, p, S)
  const r2 = buildSitemaps([...a].reverse(), [...p].reverse(), S)
  assert.deepEqual(r1, r2)
  const files = [{ path: '/b', html: '2' }, { path: '/a', html: '1' }]
  const e = { '/z': { hash: 'h', lastmod: '2026-01-01' } }
  const x = planWrites(files, e, '2026-10-28', none)
  const y = planWrites([...files].reverse(), e, '2026-10-28', none)
  assert.equal(JSON.stringify(x), JSON.stringify(y))
})

test('buildSitemaps lists sitemap-hubs.xml second, after the pages and before the state files', () => {
  const hubs = [{ loc: `${S}/bars/fl/`, lastmod: '2026-10-02' }, { loc: `${S}/bars/` }, { loc: `${S}/bars/fl/a&b/` }]
  const out = buildSitemaps([bar('hi', 1), bar('fl', 1)], [{ loc: `${S}/` }], S, hubs)
  assert.deepEqual(out.map((o) => o.path), ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-hubs.xml', 'sitemap-bars-fl.xml', 'sitemap-bars-hi.xml'])
  const locs = [...out[0].xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs, [`${S}/sitemap-pages.xml`, `${S}/sitemap-hubs.xml`, `${S}/sitemap-bars-fl.xml`, `${S}/sitemap-bars-hi.xml`])
  const hubLocs = [...out[2].xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(hubLocs, [`${S}/bars/`, `${S}/bars/fl/`, `${S}/bars/fl/a&amp;b/`])
  assert.match(out[2].xml, /<urlset/)
  assert.match(out[2].xml, /<loc>https:\/\/x\.test\/bars\/fl\/<\/loc>\n    <lastmod>2026-10-02<\/lastmod>/)
})

test('buildSitemaps without hub entries emits no sitemap-hubs.xml and the same index', () => {
  const base = buildSitemaps([bar('fl', 1)], [{ loc: `${S}/` }], S)
  assert.deepEqual(buildSitemaps([bar('fl', 1)], [{ loc: `${S}/` }], S, []), base)
  assert.ok(!base.some((o) => o.path.startsWith('sitemap-hubs')))
  assert.doesNotMatch(base[0].xml, /sitemap-hubs/)
})

test('buildSitemaps splits hub entries at 50000 urls', () => {
  const hubs = Array.from({ length: 50001 }, (_, i) => ({ loc: `${S}/bars/fl/c${String(i).padStart(6, '0')}/` }))
  const out = buildSitemaps([], [], S, hubs)
  assert.deepEqual(out.map((o) => o.path), ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-hubs.xml', 'sitemap-hubs-2.xml'])
  assert.equal([...out[3].xml.matchAll(/<url>/g)].length, 1)
})
