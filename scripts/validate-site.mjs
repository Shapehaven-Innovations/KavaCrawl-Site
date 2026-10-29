// Validates the generated pages under bars/ and the sitemaps. No dependencies: regex scanning of our own markup.
// Usage: node scripts/validate-site.mjs [root]   (default root = repo root; exits 1 on errors)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const locs = (xml) => [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => unesc(m[1].trim()))
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? unesc(m[2] ?? m[3]) : null }

export function validateSite(root) {
  const errors = []
  const cfg = JSON.parse(readFileSync(join(REPO, 'scripts', 'site-config.json'), 'utf8'))
  const site = String(cfg.SITE_URL).replace(/\/+$/, '')
  const rel = (p) => relative(root, p).split(sep).join('/')
  const isFile = (r) => existsSync(join(root, r)) && statSync(join(root, r)).isFile()
  const pathToFile = (p) => p.replace(/^\//, '') + (p.endsWith('/') ? 'index.html' : '')

  const noindex = new Set() // url paths ('/bars/.../') of pages with noindex
  const files = walk(join(root, 'bars')).filter((f) => f.endsWith('.html')).sort()
  for (const f of files) {
    const r = rel(f)
    const html = readFileSync(f, 'utf8')
    const err = (m) => errors.push(`${r}: ${m}`)
    const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    const h1s = (body.match(/<h1[\s>]/gi) || []).length
    if (h1s !== 1) err(`expected exactly one h1, found ${h1s}`)
    if (!/<title>\s*\S[\s\S]*?<\/title>/i.test(html)) err('missing title')
    const desc = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'name') === 'description')
    if (!desc || !(attr(desc, 'content') || '').trim()) err('missing meta description')
    const isNoindex = [...html.matchAll(/<meta\b[^>]*>/gi)].some((m) => attr(m[0], 'name') === 'robots' && /noindex/i.test(attr(m[0], 'content') || ''))
    const urlPath = '/' + r.replace(/index\.html$/, '')
    if (isNoindex) noindex.add(urlPath)
    const canon = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, 'rel') === 'canonical')
    if (!canon) err('missing canonical')
    else if (attr(canon, 'href') !== site + urlPath) err(`canonical ${attr(canon, 'href')} should be ${site + urlPath}`)
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = attr(m[1], 'src')
      if (src && /^(https?:)?\/\//i.test(src)) err(`external script ${src}`)
      if (attr(m[1], 'type') === 'application/ld+json') {
        try { JSON.parse(m[2]) } catch (x) { err(`invalid JSON-LD (${x.message})`) }
      }
    }
    for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(m[0], 'href')
      if (!href || !href.startsWith('/bars/')) continue
      const p = href.split(/[?#]/)[0]
      if (!isFile(pathToFile(p))) err(`broken internal link ${href}`)
    }
  }

  // Sitemaps
  if (!isFile('sitemap.xml')) errors.push('sitemap.xml: missing')
  else {
    const idx = readFileSync(join(root, 'sitemap.xml'), 'utf8')
    if (!/<sitemapindex\b/.test(idx)) errors.push('sitemap.xml: not a sitemapindex')
    for (const loc of locs(idx)) {
      if (!loc.startsWith(site + '/')) { errors.push(`sitemap.xml: child ${loc} is not under ${site}/`); continue }
      const child = loc.slice(site.length + 1)
      if (!isFile(child)) { errors.push(`sitemap.xml: child sitemap ${child} does not exist`); continue }
      const xml = readFileSync(join(root, child), 'utf8')
      if (!/<urlset\b/.test(xml)) errors.push(`${child}: not a urlset`)
      for (const u of locs(xml)) {
        if (!u.startsWith(site + '/')) { errors.push(`${child}: url ${u} is not under ${site}/`); continue }
        const p = u.slice(site.length)
        if (!p.startsWith('/bars/')) continue // home, guides: live outside bars/
        if (noindex.has(p)) errors.push(`${child}: noindex page ${p} listed in sitemap`)
        if (!isFile(pathToFile(p))) errors.push(`${child}: url ${u} has no file`)
      }
    }
  }

  errors.sort()
  return { ok: errors.length === 0, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { ok, errors } = validateSite(process.argv[2] || REPO)
  for (const m of errors) console.log(m)
  if (!ok) process.exit(1)
  console.log('site ok')
}
