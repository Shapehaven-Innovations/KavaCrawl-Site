import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { run, main } from '../scripts/site-pipeline.mjs'
import { validateSite } from '../scripts/validate-site.mjs'
import { submitIndexNow } from '../scripts/lib/site/indexnow.mjs'
import { SQL } from '../scripts/lib/site/queries.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/site/${name}`, import.meta.url), 'utf8'))
const footer = readFileSync(new URL('../assets/footer.fragment.html', import.meta.url), 'utf8')
const env = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', D1_DATABASE_ID: 'd' }
const NOW = '2026-10-28'
const SITE = 'https://kavacrawl.app'
const OLD_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://kavacrawl.app/</loc>
  </url>
  <url>
    <loc>https://kavacrawl.app/guides/a/</loc>
    <lastmod>2026-10-27</lastmod>
  </url>
</urlset>
`

/** fetchFn answering each of the five SQL queries from a data object, in the D1 REST response shape. */
function fakeD1(data) {
  const calls = []
  const fn = async (url, init) => {
    const { sql } = JSON.parse(init.body)
    calls.push(sql)
    const key = Object.keys(SQL).find((k) => SQL[k] === sql)
    if (!key) throw new Error(`unexpected sql ${sql}`)
    const rows = data[key] ?? []
    return { ok: true, status: 200, json: async () => ({ success: true, result: [{ success: true, results: rows, meta: { rows_read: rows.length + 1 } }] }) }
  }
  fn.calls = calls
  return fn
}

const roots = []
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

function makeRoot(venues = fixture('venues.json')) {
  const root = mkdtempSync(join(tmpdir(), 'site-pipeline-'))
  roots.push(root)
  mkdirSync(join(root, 'mapdata'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'mapdata/venues.json'), JSON.stringify(venues))
  writeFileSync(join(root, 'assets/footer.fragment.html'), footer)
  writeFileSync(join(root, 'sitemap.xml'), OLD_SITEMAP)
  return root
}

/** { relativePath: content } for every file under root. */
function snapshot(root) {
  const out = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else out[relative(root, p)] = `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`
    }
  }
  walk(root)
  return out
}

function logger() {
  const lines = []
  const log = (...a) => lines.push(a.join(' '))
  log.text = () => lines.join('\n')
  return log
}

/** n synthetic curated bars in Tampa, all eligible. */
function synthetic(n, cityOf = () => 'Tampa') {
  const places = []
  const venues = []
  for (let i = 0; i < n; i++) {
    const id = `ChIJSyn${String(i).padStart(4, '0')}`
    places.push({
      place_id: id, name: `Bar ${i}`, formatted_address: `${100 + i} Main St, ${cityOf(i)}, FL 33602, USA`,
      lat: 27.95 + i / 1000, lng: -82.45, phone: `(813) 555-${String(1000 + i)}`, website: null,
      business_status: 'OPERATIONAL', hours_json: null, hidden: 0,
    })
    venues.push({ id })
  }
  return { data: { places, scores: [], latestPrices: [], shellHistory: [], events: [] }, venues: { venues } }
}

const opts = (root, fetchFn, extra = {}) => ({ root, env, now: NOW, dryRun: false, rebuildAll: false, maxNewPages: 25, fetchFn, log: logger(), ...extra })

test('dry run writes nothing and prints a plan', async () => {
  const root = makeRoot()
  const before = snapshot(root)
  const o = opts(root, fakeD1(fixture('d1.json')), { dryRun: true })
  const s = await run(o)
  assert.deepEqual(snapshot(root), before)
  assert.equal(s.eligible, 5)
  assert.match(o.log.text(), /add \/bars\/fl\/tampa\/kava-haven\/index\.html/)
  assert.match(o.log.text(), /dry run/i)
  assert.ok(s.rowsRead > 0)
  assert.match(o.log.text(), new RegExp(`rows read: ${s.rowsRead}`))
})

test('aborts and writes nothing when eligible count is zero', async () => {
  const root = makeRoot({ venues: [{ id: 'ChIJDddddd444' }, { id: 'ChIJGggggg777' }] })
  const before = snapshot(root)
  await assert.rejects(run(opts(root, fakeD1(fixture('d1.json')))), /eligible/)
  assert.deepEqual(snapshot(root), before)
})

test('aborts when eligible falls below 80% of the previous run', async () => {
  const root = makeRoot()
  writeFileSync(join(root, 'lastmod.json'), JSON.stringify({ meta: { eligible: 7 }, files: {} }))
  const before = snapshot(root)
  // 5 of 7 is about 71%: aborts with no writes.
  await assert.rejects(run(opts(root, fakeD1(fixture('d1.json')))), /dropped from 7 to 5/)
  assert.deepEqual(snapshot(root), before)
  // 4 of 5 is exactly 80%: allowed (curated list without the Clearwater bar gives 4 eligible).
  const venues = fixture('venues.json')
  venues.venues = venues.venues.filter((v) => v.id !== 'ChIJEeeeee555')
  const edge = makeRoot(venues)
  writeFileSync(join(edge, 'lastmod.json'), JSON.stringify({ meta: { eligible: 5 }, files: {} }))
  const s = await run(opts(edge, fakeD1(fixture('d1.json'))))
  assert.equal(s.eligible, 4)
})

test('aborts when fewer than half of the curated bars are in D1', async () => {
  const venues = fixture('venues.json')
  venues.venues.push(...Array.from({ length: 10 }, (_, i) => ({ id: `ChIJGone${i}` })))
  const root = makeRoot(venues)
  const before = snapshot(root)
  await assert.rejects(run(opts(root, fakeD1(fixture('d1.json')))), /curated/)
  assert.deepEqual(snapshot(root), before)
})

test('skips a curated id absent from D1 and lists it', async () => {
  const root = makeRoot()
  const o = opts(root, fakeD1(fixture('d1.json')))
  const s = await run(o)
  assert.equal(s.skipped['not-in-d1'], 1)
  assert.ok(s.skippedIds.includes('ChIJMissing999'))
  assert.match(o.log.text(), /ChIJMissing999 \(not-in-d1\)/)
  assert.equal(s.eligible, 5)
})

test('a failing render skips that bar and the run continues', async () => {
  const { data, venues } = synthetic(25)
  const root = makeRoot(venues)
  const renderBarFn = (bar, ctx) => { if (bar.place_id === 'ChIJSyn0003') throw new Error('boom'); return `<p>${bar.name} ${ctx.indexable}</p>` }
  const o = opts(root, fakeD1(data), { renderBarFn })
  const s = await run(o)
  assert.equal(s.skipped['render-error'], 1)
  assert.ok(s.skippedIds.includes('ChIJSyn0003'))
  assert.ok(!existsSync(join(root, 'bars/fl/tampa/bar-3/index.html')))
  assert.ok(existsSync(join(root, 'bars/fl/tampa/bar-4/index.html')))
  assert.match(o.log.text(), /ChIJSyn0003 \(render-error: boom\)/)
})

test('more than 5% render failures aborts', async () => {
  const { data, venues } = synthetic(25)
  const root = makeRoot(venues)
  const before = snapshot(root)
  const renderBarFn = (bar) => { if (bar.place_id === 'ChIJSyn0003' || bar.place_id === 'ChIJSyn0004') throw new Error('boom'); return '<p></p>' }
  await assert.rejects(run(opts(root, fakeD1(data), { renderBarFn })), /render/)
  assert.deepEqual(snapshot(root), before)
})

test('second run with unchanged inputs writes nothing', async () => {
  const root = makeRoot()
  const first = await run(opts(root, fakeD1(fixture('d1.json'))))
  assert.ok(first.written > 0)
  const before = snapshot(root)
  delete before['.site-changed-urls.txt']
  const second = await run(opts(root, fakeD1(fixture('d1.json'))))
  assert.equal(second.written, 0)
  assert.equal(second.unchanged, first.written)
  const after = snapshot(root)
  assert.equal(after['.site-changed-urls.txt'].replace(/^[^:]*:/, ''), '')
  delete after['.site-changed-urls.txt']
  assert.deepEqual(after, before)
})

test('rebuildAll rewrites every page', async () => {
  const root = makeRoot()
  const first = await run(opts(root, fakeD1(fixture('d1.json'))))
  const second = await run(opts(root, fakeD1(fixture('d1.json')), { rebuildAll: true }))
  assert.equal(second.written, first.written)
  assert.equal(second.unchanged, 0)
})

test('changed-urls file lists only indexable changed urls', async () => {
  const root = makeRoot()
  await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 2 }))
  const urls = readFileSync(join(root, '.site-changed-urls.txt'), 'utf8').split('\n').filter(Boolean)
  // Admission order: Index total desc: kava-haven (80.5), kava-haven-bbbbbb (70); orlando (65) and root-down (null) wait.
  assert.ok(urls.includes(`${SITE}/bars/fl/tampa/kava-haven/`))
  assert.ok(urls.includes(`${SITE}/bars/fl/tampa/kava-haven-bbbbbb/`))
  assert.ok(urls.includes(`${SITE}/bars/`))
  assert.ok(!urls.some((u) => u.includes('orlando-kava') || u.includes('root-down-kava')))
  const noindex = readFileSync(join(root, 'bars/fl/orlando/orlando-kava/index.html'), 'utf8')
  assert.match(noindex, /<meta name="robots" content="noindex">/)
  // Nothing changed on the next run: the file is emptied.
  await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 0 }))
  assert.equal(readFileSync(join(root, '.site-changed-urls.txt'), 'utf8'), '')
})

test('with fewer admissions than eligible bars the output tree still validates (hubs exist for every breadcrumb)', async () => {
  const root = makeRoot()
  const s = await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 1 }))
  assert.ok(s.eligible > 1)
  assert.deepEqual(validateSite(root), { ok: true, errors: [] })
  const orlando = readFileSync(join(root, 'bars/fl/orlando/index.html'), 'utf8')
  assert.match(orlando, /name="robots" content="noindex"/)
  const urls = readFileSync(join(root, '.site-changed-urls.txt'), 'utf8')
  assert.doesNotMatch(urls, /orlando\/\n/)
  assert.doesNotMatch(readFileSync(join(root, 'sitemap-bars-fl.xml'), 'utf8'), /\/bars\/fl\/orlando\//)
})

test('admitted bars stay admitted across runs and only they reach the sitemaps', async () => {
  const root = makeRoot()
  const a = await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 2 }))
  assert.deepEqual(a.newlyAdmitted, ['ChIJAaaaaa111', 'ChIJBbbbbb222'])
  const b = await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 1 }))
  assert.deepEqual(b.newlyAdmitted, ['ChIJHhhhhh888'])
  const lastmod = JSON.parse(readFileSync(join(root, 'lastmod.json'), 'utf8'))
  assert.equal(lastmod.meta.eligible, 5)
  assert.equal(lastmod.files['/bars/fl/clearwater/no-phone-kava/index.html'].admitted, undefined)
  assert.equal(lastmod.files['/bars/fl/tampa/kava-haven/index.html'].admitted, true)
  assert.equal(lastmod.files['/bars/fl/st-petersburg/root-down-kava/index.html'].admitted, undefined)
  const fl = readFileSync(join(root, 'sitemap-bars-fl.xml'), 'utf8')
  assert.match(fl, /<loc>https:\/\/kavacrawl\.app\/bars\/fl\/orlando\/orlando-kava\/<\/loc>\n    <lastmod>2026-10-28<\/lastmod>/)
  assert.doesNotMatch(fl, /root-down-kava/)
  assert.doesNotMatch(fl, /<loc>https:\/\/kavacrawl\.app\/bars\/fl\/<\/loc>/, 'hubs stay out of the sitemaps')
  const slugs = readFileSync(join(root, 'slugs.json'), 'utf8')
  assert.equal(slugs, JSON.stringify(JSON.parse(slugs), Object.keys(JSON.parse(slugs)).sort(), 2) + '\n')
  assert.equal(JSON.parse(slugs).ChIJAaaaaa111, '/bars/fl/tampa/kava-haven/')
})

test('sitemap-pages.xml keeps every url from the old sitemap and sitemap.xml becomes the index', async () => {
  const root = makeRoot()
  await run(opts(root, fakeD1(fixture('d1.json'))))
  const pages = readFileSync(join(root, 'sitemap-pages.xml'), 'utf8')
  assert.match(pages, /<loc>https:\/\/kavacrawl\.app\/<\/loc>/)
  assert.match(pages, /<loc>https:\/\/kavacrawl\.app\/guides\/a\/<\/loc>\n    <lastmod>2026-10-27<\/lastmod>/)
  const index = readFileSync(join(root, 'sitemap.xml'), 'utf8')
  assert.match(index, /<sitemapindex/)
  assert.ok(index.indexOf('sitemap-pages.xml') < index.indexOf('sitemap-bars-fl.xml'))
  // A hand edit to sitemap-pages.xml survives the next run.
  writeFileSync(join(root, 'sitemap-pages.xml'), pages.replace('</urlset>', '  <url>\n    <loc>https://kavacrawl.app/guides/b/</loc>\n  </url>\n</urlset>'))
  await run(opts(root, fakeD1(fixture('d1.json'))))
  assert.match(readFileSync(join(root, 'sitemap-pages.xml'), 'utf8'), /guides\/b\//)
  assert.match(readFileSync(join(root, 'sitemap-pages.xml'), 'utf8'), /guides\/a\//)
})

test('a removed bar gets a noindex stub that links to its state hub', async () => {
  const { data, venues } = synthetic(10)
  const root = makeRoot(venues)
  await run(opts(root, fakeD1(data)))
  writeFileSync(join(root, 'mapdata/venues.json'), JSON.stringify({ venues: venues.venues.filter((v) => v.id !== 'ChIJSyn0002') }))
  const s = await run(opts(root, fakeD1(data)))
  assert.equal(s.removed, 1)
  const stub = readFileSync(join(root, 'bars/fl/tampa/bar-2/index.html'), 'utf8')
  assert.match(stub, /<meta name="robots" content="noindex">/)
  assert.match(stub, /<link rel="canonical" href="https:\/\/kavacrawl\.app\/bars\/fl\/tampa\/bar-2\/">/)
  assert.match(stub, /This bar is no longer listed/)
  assert.match(stub, /href="\/bars\/fl\/"/)
  assert.doesNotMatch(readFileSync(join(root, 'sitemap-bars-fl.xml'), 'utf8'), /bar-2\//)
  assert.match(readFileSync(join(root, 'sitemap-bars-fl.xml'), 'utf8'), /bar-3\//)
  // A rerun leaves the stub alone; after 90 days it is deleted.
  assert.equal((await run(opts(root, fakeD1(data), { now: '2026-11-01' }))).written, 0)
  await run(opts(root, fakeD1(data), { now: '2027-02-01' }))
  assert.ok(!existsSync(join(root, 'bars/fl/tampa/bar-2/index.html')))
  const lastmod = JSON.parse(readFileSync(join(root, 'lastmod.json'), 'utf8'))
  assert.equal(lastmod.files['/bars/fl/tampa/bar-2/index.html'], undefined)
})

test('sitemap.xml is written last, so a crash before it keeps the old urlset and the seeded pages sitemap', async () => {
  const root = makeRoot()
  const order = []
  const writeFileFn = (p, text) => {
    const rel = relative(root, p)
    if (rel === 'sitemap.xml') throw new Error('disk full')
    order.push(rel)
    writeFileSync(p, text)
  }
  await assert.rejects(run(opts(root, fakeD1(fixture('d1.json')), { writeFileFn })), /disk full/)
  assert.equal(readFileSync(join(root, 'sitemap.xml'), 'utf8'), OLD_SITEMAP)
  assert.match(readFileSync(join(root, 'sitemap-pages.xml'), 'utf8'), /guides\/a\//)
  assert.ok(existsSync(join(root, 'sitemap-bars-fl.xml')))
  assert.ok(order.indexOf('sitemap-pages.xml') >= 0 && order.indexOf('sitemap-bars-fl.xml') >= 0)
  assert.ok(!order.includes('.site-changed-urls.txt'), 'nothing after the index')
  // The next run recovers from sitemap-pages.xml and writes the index.
  await run(opts(root, fakeD1(fixture('d1.json'))))
  assert.match(readFileSync(join(root, 'sitemap.xml'), 'utf8'), /<sitemapindex/)
  assert.match(readFileSync(join(root, 'sitemap-pages.xml'), 'utf8'), /guides\/a\//)
})

test('a lastmod.json key that escapes the site root aborts with no writes', async () => {
  for (const entry of [{ hash: 'x', lastmod: '2026-10-01' }, { hash: 'x', lastmod: '2026-01-01', removedOn: '2026-01-02' }]) {
    const root = makeRoot()
    writeFileSync(join(root, 'lastmod.json'), JSON.stringify({ meta: {}, files: { '/bars/../../evil/index.html': entry } }))
    const before = snapshot(root)
    await assert.rejects(run(opts(root, fakeD1(fixture('d1.json')))), /escapes the site root/)
    assert.deepEqual(snapshot(root), before)
    assert.ok(!existsSync(join(root, '..', 'evil')))
  }
})

test('a throw in the indexable render skips that bar like any render failure', async () => {
  const { data, venues } = synthetic(25)
  const root = makeRoot(venues)
  const renderBarFn = (bar, ctx) => {
    if (bar.place_id === 'ChIJSyn0005' && ctx.indexable) throw new Error('late boom')
    return `<p>${bar.name} ${ctx.indexable}</p>`
  }
  const o = opts(root, fakeD1(data), { renderBarFn })
  const s = await run(o)
  assert.equal(s.skipped['render-error'], 1)
  assert.ok(s.skippedIds.includes('ChIJSyn0005'))
  assert.ok(!s.newlyAdmitted.includes('ChIJSyn0005'))
  assert.ok(!existsSync(join(root, 'bars/fl/tampa/bar-5/index.html')))
  assert.doesNotMatch(readFileSync(join(root, 'sitemap-bars-fl.xml'), 'utf8'), /bar-5\//)
  assert.doesNotMatch(readFileSync(join(root, 'bars/fl/tampa/index.html'), 'utf8'), /bar-5\//)
  assert.match(o.log.text(), /ChIJSyn0005 \(render-error: late boom\)/)
  // Two late failures out of 25 is more than 5%: abort.
  const root2 = makeRoot(venues)
  const two = (bar, ctx) => { if (ctx.indexable && (bar.place_id === 'ChIJSyn0005' || bar.place_id === 'ChIJSyn0006')) throw new Error('x'); return '<p></p>' }
  const before = snapshot(root2)
  await assert.rejects(run(opts(root2, fakeD1(data), { renderBarFn: two })), /render/)
  assert.deepEqual(snapshot(root2), before)
})

const locsOf = (xml) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])

test('indexable hubs are listed in sitemap-hubs.xml, second in the index', async () => {
  const root = makeRoot()
  await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 2 }))
  const hubs = readFileSync(join(root, 'sitemap-hubs.xml'), 'utf8')
  // Only Tampa bars are admitted: Clearwater, Orlando and St. Petersburg hubs are noindex and stay out.
  assert.deepEqual(locsOf(hubs), [`${SITE}/bars/`, `${SITE}/bars/fl/`, `${SITE}/bars/fl/tampa/`])
  assert.equal([...hubs.matchAll(/<lastmod>2026-10-28<\/lastmod>/g)].length, 3)
  assert.match(readFileSync(join(root, 'bars/fl/orlando/index.html'), 'utf8'), /<meta name="robots" content="noindex">/)
  assert.deepEqual(locsOf(readFileSync(join(root, 'sitemap.xml'), 'utf8')),
    [`${SITE}/sitemap-pages.xml`, `${SITE}/sitemap-hubs.xml`, `${SITE}/sitemap-bars-fl.xml`])
  assert.deepEqual(validateSite(root).errors, [])
  // Unchanged inputs: nothing rewritten, sitemap-hubs.xml included.
  const before = snapshot(root)
  delete before['.site-changed-urls.txt']
  const again = await run(opts(root, fakeD1(fixture('d1.json')), { maxNewPages: 0 }))
  assert.equal(again.written, 0)
  const after = snapshot(root)
  delete after['.site-changed-urls.txt']
  assert.deepEqual(after, before)
})

test('a hub that loses its admitted bars goes noindex and leaves sitemap-hubs.xml', async () => {
  // Bars 0 and 9 are in Ocala, the rest in Tampa. Only bar 0 is admitted (no Index data: place_id order).
  const { data, venues } = synthetic(10, (i) => (i === 0 || i === 9 ? 'Ocala' : 'Tampa'))
  const root = makeRoot(venues)
  await run(opts(root, fakeD1(data), { maxNewPages: 1 }))
  assert.deepEqual(locsOf(readFileSync(join(root, 'sitemap-hubs.xml'), 'utf8')), [`${SITE}/bars/`, `${SITE}/bars/fl/`, `${SITE}/bars/fl/ocala/`])
  // Bar 0 leaves the curated list: Ocala still has bar 9 (not admitted), so its hub stays but goes noindex.
  writeFileSync(join(root, 'mapdata/venues.json'), JSON.stringify({ venues: venues.venues.filter((v) => v.id !== 'ChIJSyn0000') }))
  await run(opts(root, fakeD1(data), { maxNewPages: 0 }))
  assert.match(readFileSync(join(root, 'bars/fl/ocala/index.html'), 'utf8'), /<meta name="robots" content="noindex">/)
  assert.ok(!existsSync(join(root, 'sitemap-hubs.xml')), 'leftover sitemap-hubs.xml deleted when no hub is indexable')
  assert.doesNotMatch(readFileSync(join(root, 'sitemap.xml'), 'utf8'), /sitemap-hubs/)
  assert.deepEqual(validateSite(root).errors, [])
  // A later admission brings it back.
  await run(opts(root, fakeD1(data), { maxNewPages: 1 }))
  assert.ok(locsOf(readFileSync(join(root, 'sitemap-hubs.xml'), 'utf8')).includes(`${SITE}/bars/`))
})

test('submitIndexNow posts in batches and reports ok on 202', async () => {
  const calls = []
  const fetchFn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 202 } }
  const urls = Array.from({ length: 25001 }, (_, i) => `https://kavacrawl.app/bars/${i}/`)
  const r = await submitIndexNow('kavacrawl.app', 'k123', urls, fetchFn)
  assert.deepEqual(r, { ok: true, status: 202, submitted: 25001 })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map((c) => c.body.urlList.length), [10000, 10000, 5001])
  assert.equal(calls[0].url, 'https://api.indexnow.org/indexnow')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].body.host, 'kavacrawl.app')
  assert.equal(calls[0].body.key, 'k123')
  assert.equal(calls[0].body.keyLocation, 'https://kavacrawl.app/k123.txt')
  const bad = await submitIndexNow('kavacrawl.app', 'k123', ['https://kavacrawl.app/'], async () => ({ ok: false, status: 403 }))
  assert.deepEqual(bad, { ok: false, status: 403, submitted: 0 })
  assert.deepEqual(await submitIndexNow('kavacrawl.app', 'k', [], async () => { throw new Error('no call') }), { ok: true, status: 0, submitted: 0 })
})

test('notify submits the urls in the file with the key file at the site root', async () => {
  const root = makeRoot()
  writeFileSync(join(root, '0123456789abcdef0123456789abcdef.txt'), '0123456789abcdef0123456789abcdef\n')
  writeFileSync(join(root, 'changed.txt'), 'https://kavacrawl.app/bars/\n\nhttps://kavacrawl.app/bars/fl/\n')
  const bodies = []
  const fetchFn = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200 } }
  const log = logger()
  const code = await main(['notify', join(root, 'changed.txt')], { root, env: {}, fetchFn, log })
  assert.equal(code, 0)
  assert.deepEqual(bodies[0].urlList, ['https://kavacrawl.app/bars/', 'https://kavacrawl.app/bars/fl/'])
  assert.equal(bodies[0].key, '0123456789abcdef0123456789abcdef')
  // An empty file sends nothing.
  writeFileSync(join(root, 'changed.txt'), '')
  assert.equal(await main(['notify', join(root, 'changed.txt')], { root, env: {}, fetchFn, log }), 0)
  assert.equal(bodies.length, 1)
})
