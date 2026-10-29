// Builds sitemap.xml (index), sitemap-pages.xml, sitemap-hubs[-n].xml and sitemap-bars-{st}[-n].xml.
// Index order: sitemap-pages.xml first, sitemap-hubs.xml second (only when there are hub entries), then the
// state files by state code, so consumers that read only the first few children cover the home page, guides and hubs.
// Pure and deterministic: everything is sorted, no clock.
const MAX_URLS = 50000
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function urlset(entries) {
  const sorted = [...entries].sort((a, b) => cmp(a.loc, b.loc))
  const rows = sorted.map((e) => `  <url>\n    <loc>${esc(e.loc)}</loc>\n${e.lastmod ? `    <lastmod>${esc(e.lastmod)}</lastmod>\n` : ''}  </url>\n`)
  return `${HEAD}<urlset xmlns="${NS}">\n${rows.join('')}</urlset>\n`
}

/** Splits sorted entries into 50,000-url files: name, name-2, name-3... */
function chunks(name, entries) {
  const sorted = [...entries].sort((a, b) => cmp(a.loc, b.loc))
  const out = []
  for (let i = 0, n = 1; i < sorted.length; i += MAX_URLS, n++) {
    out.push({ path: n === 1 ? `${name}.xml` : `${name}-${n}.xml`, xml: urlset(sorted.slice(i, i + MAX_URLS)) })
  }
  return out
}

/** entries: bar {loc, lastmod?, state}. pagesEntries / hubEntries: {loc, lastmod?}. */
export function buildSitemaps(entries, pagesEntries, siteUrl, hubEntries = []) {
  const base = String(siteUrl).replace(/\/+$/, '')
  const byState = new Map()
  for (const e of entries) {
    if (!e.state) continue
    const st = String(e.state).toLowerCase()
    if (!byState.has(st)) byState.set(st, [])
    byState.get(st).push(e)
  }
  const children = [{ path: 'sitemap-pages.xml', xml: urlset(pagesEntries || []) }, ...chunks('sitemap-hubs', hubEntries || [])]
  for (const st of [...byState.keys()].sort(cmp)) children.push(...chunks(`sitemap-bars-${st}`, byState.get(st)))
  const rows = children.map((c) => `  <sitemap>\n    <loc>${esc(`${base}/${c.path}`)}</loc>\n  </sitemap>\n`)
  const index = `${HEAD}<sitemapindex xmlns="${NS}">\n${rows.join('')}</sitemapindex>\n`
  return [{ path: 'sitemap.xml', xml: index }, ...children]
}
