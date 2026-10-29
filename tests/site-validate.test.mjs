import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildBars, curatedIds } from '../scripts/lib/site/snapshot.mjs'
import { renderBar } from '../scripts/lib/site/render.mjs'
import { buildHubs } from '../scripts/lib/site/hubs.mjs'
import { buildSitemaps } from '../scripts/lib/site/sitemaps.mjs'
import { validateSite } from '../scripts/validate-site.mjs'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/site/${name}`, import.meta.url), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('../scripts/site-config.json', import.meta.url), 'utf8'))
const footerFragment = readFileSync(new URL('../assets/footer.fragment.html', import.meta.url), 'utf8')
const { bars } = buildBars(fixture('d1.json'), curatedIds(fixture('venues.json')), {}, cfg, '2026-10-28')
const ctx = { siteUrl: cfg.SITE_URL, appStoreUrl: cfg.appStoreUrl, footerFragment, indexable: true }
const admitted = new Set(bars.map((b) => b.place_id))

/** Builds a valid tree in a temp dir and returns { root, write, read }. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'validate-site-'))
  const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
  const read = (rel) => readFileSync(join(root, rel), 'utf8')
  for (const b of bars) write(b.path.slice(1) + 'index.html', renderBar(b, ctx))
  for (const h of buildHubs(bars, admitted, ctx)) write(h.path.slice(1), h.html)
  const entries = bars.map((b) => ({ loc: cfg.SITE_URL + b.path, state: b.state }))
  const pages = [{ loc: cfg.SITE_URL + '/' }]
  for (const s of buildSitemaps(entries, pages, cfg.SITE_URL)) write(s.path, s.xml)
  return { root, write, read }
}
const run = (fn) => {
  const t = tree()
  try { fn(t); return validateSite(t.root) } finally { rmSync(t.root, { recursive: true, force: true }) }
}
const first = bars[0].path.slice(1) + 'index.html'

test('passes a valid tree', () => {
  const r = run(() => {})
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('fails on two h1s', () => {
  const r = run((t) => t.write(first, t.read(first).replace('</main>', '<h1>Second</h1></main>')))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((m) => m.includes(first) && /h1/.test(m)), r.errors.join('\n'))
})

test('fails on a canonical that is not the path', () => {
  const r = run((t) => t.write(first, t.read(first).replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="https://kavacrawl.app/bars/fl/nope/">')))
  assert.ok(r.errors.some((m) => m.includes(first) && /canonical/.test(m)), r.errors.join('\n'))
})

test('fails on a noindex page listed in a sitemap', () => {
  const r = run((t) => t.write(first, t.read(first).replace('<link rel="canonical"', '<meta name="robots" content="noindex">\n<link rel="canonical"')))
  assert.ok(r.errors.some((m) => /noindex/.test(m) && /sitemap/.test(m)), r.errors.join('\n'))
})

test('fails on a noindex hub listed in sitemap-hubs.xml', () => {
  const hub = 'bars/fl/tampa/index.html'
  const r = run((t) => {
    for (const s of buildSitemaps([], [{ loc: cfg.SITE_URL + '/' }], cfg.SITE_URL, [{ loc: `${cfg.SITE_URL}/bars/` }, { loc: `${cfg.SITE_URL}/bars/fl/tampa/` }])) t.write(s.path, s.xml)
    t.write(hub, t.read(hub).replace('<link rel="canonical"', '<meta name="robots" content="noindex">\n<link rel="canonical"'))
  })
  assert.ok(r.errors.includes('sitemap-hubs.xml: noindex page /bars/fl/tampa/ listed in sitemap'), r.errors.join('\n'))
  assert.equal(r.errors.length, 1, r.errors.join('\n'))
})

test('fails on a broken internal link', () => {
  const r = run((t) => t.write(first, t.read(first).replace('</main>', '<a href="/bars/zz/nowhere/">x</a></main>')))
  assert.ok(r.errors.some((m) => m.includes(first) && m.includes('/bars/zz/nowhere/')), r.errors.join('\n'))
})

test('fails on invalid JSON-LD', () => {
  const r = run((t) => t.write(first, t.read(first).replace(/(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/, '$1{oops$2')))
  assert.ok(r.errors.some((m) => m.includes(first) && /JSON-LD/.test(m)), r.errors.join('\n'))
})

test('fails on missing title, missing description and external script', () => {
  const r = run((t) => t.write(first, t.read(first).replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</main>', '<script src="https://evil.example/x.js"></script></main>')))
  assert.ok(r.errors.some((m) => /title/.test(m)))
  assert.ok(r.errors.some((m) => /description/.test(m)))
  assert.ok(r.errors.some((m) => /external script/.test(m)))
})

test('fails on a sitemap url with no file and a missing child sitemap', () => {
  const r = run((t) => {
    t.write('sitemap-bars-fl.xml', t.read('sitemap-bars-fl.xml').replace('</urlset>', `<url><loc>${cfg.SITE_URL}/bars/fl/tampa/ghost/</loc></url></urlset>`))
    t.write('sitemap.xml', t.read('sitemap.xml').replace('</sitemapindex>', `<sitemap><loc>${cfg.SITE_URL}/sitemap-missing.xml</loc></sitemap></sitemapindex>`))
  })
  assert.ok(r.errors.some((m) => m.includes('ghost')))
  assert.ok(r.errors.some((m) => m.includes('sitemap-missing.xml')))
})

test('errors are sorted and deterministic', () => {
  const r = run((t) => t.write(first, t.read(first).replace('</main>', '<h1>B</h1><a href="/bars/zz/">x</a></main>')))
  assert.deepEqual(r.errors, [...r.errors].sort())
})
