// Builds the bar pages (/bars/...), their hubs and the sitemaps from the curated list and D1.
// Usage:
//   node scripts/site-pipeline.mjs [--dry-run] [--rebuild-all] [--max-new-pages N] [--root dir]
//   node scripts/site-pipeline.mjs notify <changed-urls-file>      (IndexNow ping, after the deploy is live)
//
// - Reads mapdata/venues.json (the curated list), slugs.json and lastmod.json, runs the five read-only D1
//   queries (env CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID) and joins them with buildBars.
// - Guards abort with nothing written: zero eligible bars, eligible below 80% of the previous run's count
//   (lastmod.json meta.eligible), or fewer than half of the curated bars present in D1.
// - A bar whose render throws is skipped and listed; more than 5% failing aborts. A failed bar that already
//   had a page keeps its old file and lastmod entry.
// - Admission (rollout) state lives in lastmod.json: files["/bars/.../index.html"].admitted === true.
//   Non-admitted bars are rendered noindex and left out of the sitemaps; hubs list admitted bars only and are noindex when they list none.
//   Indexable hubs go to sitemap-hubs.xml (second in the index); a leftover sitemap-hubs.xml is deleted when none is indexable.
// - Removed pages get a noindex stub for 90 days (planWrites), then the file is deleted.
// - sitemap-pages.xml holds the non-bar URLs and is hand-maintained; the first run seeds it from the
//   old urlset in sitemap.xml. sitemap.xml becomes the index. Files are written only when their bytes change.
// - .site-changed-urls.txt (gitignored) lists the indexable URLs whose pages changed, for `notify`.
// - --dry-run writes nothing and prints the planned adds, changes and removals.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { queryD1 } from './lib/site/d1.mjs'
import { SQL } from './lib/site/queries.mjs'
import { buildBars, curatedIds } from './lib/site/snapshot.mjs'
import { admit } from './lib/site/admit.mjs'
import { renderBar, documentShell, escapeHtml as e } from './lib/site/render.mjs'
import { STATE_NAMES } from './lib/site/jsonld.mjs'
import { buildHubs } from './lib/site/hubs.mjs'
import { planWrites } from './lib/site/diff.mjs'
import { buildSitemaps } from './lib/site/sitemaps.mjs'
import { submitIndexNow } from './lib/site/indexnow.mjs'
import { checkTotals } from './lib/guard.mjs'

const CFG = JSON.parse(readFileSync(new URL('./site-config.json', import.meta.url), 'utf8'))
const CHANGED_URLS = '.site-changed-urls.txt'
const MAX_RENDER_FAIL = 0.05
const MIN_CURATED_IN_D1 = 0.5
const MAX_ELIGIBLE_DROP = 0.2

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const sortedObject = (o) => Object.fromEntries(Object.keys(o).sort(cmp).map((k) => [k, o[k]]))
const fileOf = (barPath) => `${barPath}index.html`
const urlOf = (file) => CFG.SITE_URL + file.replace(/index\.html$/, '')

function readText(path) {
  try { return readFileSync(path, 'utf8') } catch (err) { if (err.code === 'ENOENT') return null; throw err }
}
function readJson(path) {
  const t = readText(path)
  return t == null ? null : JSON.parse(t)
}

const XML_UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const unxml = (s) => s.trim().replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_UNESC[m])

/** [{loc, lastmod?}] from a <urlset>; null when the xml is not a urlset. */
function parseUrlset(xml) {
  if (!/<urlset[\s>]/.test(xml)) return null
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(m[1])
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(m[1])
    if (!loc) throw new Error('a <url> without <loc> in the pages sitemap')
    return lastmod ? { loc: unxml(loc[1]), lastmod: unxml(lastmod[1]) } : { loc: unxml(loc[1]) }
  })
}

/** Non-bar sitemap entries: sitemap-pages.xml, or on the first run the old urlset in sitemap.xml. */
function loadPagesEntries(root) {
  const pages = readText(join(root, 'sitemap-pages.xml'))
  if (pages != null) {
    const entries = parseUrlset(pages)
    if (!entries) throw new Error('sitemap-pages.xml is not a <urlset>')
    return entries
  }
  const old = readText(join(root, 'sitemap.xml'))
  if (old == null) return []
  const entries = parseUrlset(old)
  if (!entries) throw new Error('sitemap.xml is an index but sitemap-pages.xml is missing: the page URLs would be lost')
  return entries
}

/** Noindex page left at a removed URL: a bar links to its state hub, a hub to the level above. */
function stubHtml(file, ctx) {
  const segs = file.split('/').filter(Boolean) // ['bars', st?, city?, slug?, 'index.html']
  const isBar = segs.length === 5
  const st = segs.length >= 4 ? segs[1] : null
  const href = st ? `/bars/${st}/` : '/bars/'
  const label = st ? `Kava bars in ${STATE_NAMES[st.toUpperCase()] ?? st.toUpperCase()}` : 'Kava bars by state'
  const text = isBar ? 'This bar is no longer listed' : 'This page is no longer listed'
  const body = `<main class="bar thin">
  <header class="bar-head">
    <h1>${e(text)}</h1>
    <p class="addr"><a href="${e(href)}">${e(label)}</a></p>
  </header>
  </main>`
  return documentShell(`${text} | KavaCrawl`, `${text} on KavaCrawl.`, file.replace(/index\.html$/, ''), body, { ...ctx, indexable: false, afterFooter: '' })
}

/**
 * opts: { root, env, now (YYYY-MM-DD or ISO), dryRun, rebuildAll, maxNewPages, fetchFn?, log?, renderBarFn?, writeFileFn? }.
 * Returns the Summary; throws (with nothing written) when a guard refuses.
 */
export async function run(opts) {
  const { root, env, dryRun = false, rebuildAll = false, fetchFn = fetch, log = console.log, renderBarFn = renderBar, writeFileFn = writeFileSync } = opts
  const today = String(opts.now).slice(0, 10)
  const maxNew = Number.isFinite(opts.maxNewPages) ? opts.maxNewPages : CFG.maxNewPages
  const base = resolve(root)
  // Every read, write and delete goes through at(): a data-derived path that escapes the site root aborts the run.
  const at = (p) => {
    const full = resolve(base, String(p).replace(/^\/+/, ''))
    if (!full.startsWith(base + sep)) throw new Error(`path escapes the site root: ${p}`)
    return full
  }

  const venuesDoc = readJson(at('mapdata/venues.json'))
  if (!Array.isArray(venuesDoc?.venues)) throw new Error('mapdata/venues.json is missing or has no venues array')
  const slugs = readJson(at('slugs.json')) ?? {}
  const prevDoc = readJson(at('lastmod.json')) ?? {}
  const prevFiles = prevDoc.files ?? {}
  const prevEligible = prevDoc.meta?.eligible
  const footerFragment = readText(at('assets/footer.fragment.html'))
  if (footerFragment == null) throw new Error('assets/footer.fragment.html is missing')
  const pagesEntries = loadPagesEntries(root)
  const ctx = { siteUrl: CFG.SITE_URL, appStoreUrl: CFG.appStoreUrl, footerFragment }

  // D1: the five bulk selects.
  const input = {}
  let rowsRead = 0
  for (const key of Object.keys(SQL)) {
    const r = await queryD1(env, SQL[key], undefined, fetchFn)
    input[key] = r.rows
    rowsRead += r.rowsRead
  }

  const curated = curatedIds(venuesDoc)
  const inD1 = new Set((input.places ?? []).map((p) => p.place_id))
  const curatedInD1 = [...curated].filter((id) => inD1.has(id)).length
  const { bars, skipped, paths } = buildBars(input, curated, slugs, CFG, today)

  // Sanity guards: abort before anything is written.
  if (bars.length === 0) throw new Error(`0 eligible bars (curated ${curated.size}, in D1 ${curatedInD1}, rows read ${rowsRead})`)
  if (curatedInD1 < venuesDoc.venues.length * MIN_CURATED_IN_D1) {
    throw new Error(`only ${curatedInD1} curated bars found in D1, below half of the ${venuesDoc.venues.length} in mapdata/venues.json`)
  }
  const g = checkTotals(typeof prevEligible === 'number' ? prevEligible : null, bars.length, { maxDrop: MAX_ELIGIBLE_DROP, maxRise: Infinity })
  if (!g.ok) throw new Error(`eligible ${g.reason}`)

  // Render probe: a bar that cannot render is skipped (its old page, if any, is kept as it is).
  const failed = []
  const fail = (b, err) => failed.push({ place_id: b.place_id, reason: 'render-error', detail: err?.message ?? String(err), file: fileOf(b.path) })
  const tooMany = () => {
    if (failed.length / bars.length > MAX_RENDER_FAIL) {
      throw new Error(`${failed.length} of ${bars.length} bars failed to render (more than 5%): ${failed.map((f) => `${f.place_id} (${f.detail})`).join(', ')}`)
    }
  }
  const probed = []
  const noindexHtml = new Map()
  for (const b of bars) {
    try {
      noindexHtml.set(b.place_id, renderBarFn(b, { ...ctx, indexable: false }))
      probed.push(b)
    } catch (err) { fail(b, err) }
  }
  tooMany()

  // Admission.
  const already = new Set(probed.filter((b) => prevFiles[fileOf(b.path)]?.admitted).map((b) => b.place_id))
  const admitted = admit(probed.map((b) => ({ place_id: b.place_id, indexTotal: b.index?.total ?? null })), already, maxNew)

  // Pages: bars (indexable only when admitted) and hubs (one per state/city of every rendered bar; indexable only when they list an admitted bar; indexable ones go to sitemap-hubs.xml).
  // The indexable render can fail too: that bar is skipped like a probe failure and loses its admission.
  const files = []
  const indexable = new Map()
  const ok = []
  for (const b of probed) {
    const live = admitted.has(b.place_id)
    let html = noindexHtml.get(b.place_id)
    if (live) {
      try { html = renderBarFn(b, { ...ctx, indexable: true }) } catch (err) { fail(b, err); admitted.delete(b.place_id); continue }
    }
    ok.push(b)
    files.push({ path: fileOf(b.path), html })
    indexable.set(fileOf(b.path), live)
  }
  tooMany()
  const newlyAdmitted = [...admitted].filter((id) => !already.has(id)).sort(cmp)
  const hubFiles = buildHubs(ok, admitted, ctx)
  for (const h of hubFiles) {
    files.push({ path: h.path, html: h.html })
    indexable.set(h.path, h.indexable)
  }

  // Failed bars that already have a page keep their lastmod entry; planWrites must not see them as removed.
  const retained = {}
  const prevForPlan = { ...prevFiles }
  for (const f of failed) {
    if (prevFiles[f.file]) { retained[f.file] = prevFiles[f.file]; delete prevForPlan[f.file] }
  }
  const plan = planWrites(files, prevForPlan, today, (p) => readText(at(p)))
  const writes = rebuildAll ? [...files].sort((a, b) => cmp(a.path, b.path)) : plan.writes
  const unchanged = rebuildAll ? [] : plan.unchanged

  const lastmodFiles = { ...plan.lastmod, ...retained }
  for (const b of ok) if (admitted.has(b.place_id)) lastmodFiles[fileOf(b.path)].admitted = true
  const lastmodDoc = { meta: { eligible: bars.length }, files: sortedObject(lastmodFiles) }

  const stubs = []
  for (const p of plan.removals) {
    const html = stubHtml(p, ctx)
    if (readText(at(p)) !== html) stubs.push({ path: p, html })
  }

  // Sitemap entries: admitted, indexable, not removed bars (a retained failed bar keeps its old page and entry).
  const entries = []
  for (const b of bars) {
    const file = fileOf(b.path)
    const entry = lastmodDoc.files[file]
    if (!entry?.admitted || entry.removedOn) continue
    entries.push({ loc: CFG.SITE_URL + b.path, lastmod: entry.lastmod, state: b.path.split('/')[2] })
  }
  // Hub entries: the indexable hubs of this run (directory URL, as the canonical), lastmod from planWrites.
  const hubEntries = hubFiles.filter((h) => h.indexable)
    .map((h) => ({ loc: urlOf(h.path), lastmod: lastmodDoc.files[h.path]?.lastmod }))
  const sitemaps = buildSitemaps(entries, pagesEntries, CFG.SITE_URL, hubEntries)
  const keep = new Set(sitemaps.map((s) => s.path))
  // Generated children no longer referenced by the index (sitemap-pages.xml is hand-maintained and always kept).
  const staleSitemaps = readdirSync(root).filter((n) => /^sitemap-(bars-[a-z0-9-]+|hubs(-\d+)?)\.xml$/.test(n) && !keep.has(n)).sort(cmp)

  // Containment check for every path a write or delete will touch, before anything is written.
  for (const p of [...writes.map((w) => w.path), ...plan.removals, ...plan.expiredStubs, ...staleSitemaps, ...sitemaps.map((x) => x.path)]) at(p)

  const changedUrls = writes.filter((w) => indexable.get(w.path)).map((w) => urlOf(w.path)).sort(cmp)

  const skippedAll = [...skipped, ...failed].sort((a, b) => cmp(a.place_id, b.place_id))
  const skippedCounts = {}
  for (const s of skippedAll) skippedCounts[s.reason] = (skippedCounts[s.reason] ?? 0) + 1
  const summary = {
    eligible: bars.length,
    skipped: sortedObject(skippedCounts),
    skippedIds: skippedAll.map((s) => s.place_id),
    newlyAdmitted,
    written: writes.length,
    unchanged: unchanged.length,
    removed: plan.removals.length,
    rowsRead,
    changedUrls,
  }

  log(`site build ${today}${dryRun ? ' (dry run: nothing written)' : ''}`)
  log(`eligible: ${summary.eligible} of ${curated.size} curated (${curatedInD1} in D1)`)
  log(`skipped: ${skippedAll.length}${skippedAll.length ? ` (${Object.entries(summary.skipped).map(([r, n]) => `${r} ${n}`).join(', ')})` : ''}`)
  for (const s of skippedAll) log(`  ${s.place_id} (${s.reason}${s.detail ? `: ${s.detail}` : ''})`)
  log(`admitted: ${admitted.size} (${newlyAdmitted.length} new${newlyAdmitted.length ? `: ${newlyAdmitted.join(', ')}` : ''})`)
  log(`pages: ${summary.written} written, ${summary.unchanged} unchanged, ${summary.removed} removed${plan.expiredStubs.length ? `, ${plan.expiredStubs.length} expired stubs deleted` : ''}`)
  log(`rows read: ${rowsRead}`)

  if (dryRun) {
    for (const w of writes) log(`${prevFiles[w.path] ? 'change' : 'add'} ${w.path}`)
    for (const p of plan.removals) log(`remove ${p} (stub)`)
    for (const p of plan.expiredStubs) log(`delete ${p} (expired stub)`)
    for (const n of staleSitemaps) log(`delete ${n}`)
    return summary
  }

  const writeIfChanged = (p, text) => {
    if (readText(at(p)) === text) return
    mkdirSync(dirname(at(p)), { recursive: true })
    writeFileFn(at(p), text)
  }
  for (const w of writes) {
    mkdirSync(dirname(at(w.path)), { recursive: true })
    writeFileFn(at(w.path), w.html)
  }
  for (const s of stubs) writeIfChanged(s.path, s.html)
  for (const p of plan.expiredStubs) rmSync(at(p), { force: true })
  writeIfChanged('slugs.json', JSON.stringify(sortedObject(paths), null, 2) + '\n')
  writeIfChanged('lastmod.json', JSON.stringify(lastmodDoc, null, 2) + '\n')
  // sitemap.xml goes last: on the first run it still holds the only copy of the page URLs (until
  // sitemap-pages.xml exists), and the index should name only children that are already on disk.
  for (const s of sitemaps) if (s.path !== 'sitemap.xml') writeIfChanged(s.path, s.xml)
  writeIfChanged('sitemap.xml', sitemaps.find((s) => s.path === 'sitemap.xml').xml)
  for (const n of staleSitemaps) rmSync(at(n), { force: true })
  writeIfChanged(CHANGED_URLS, changedUrls.map((u) => u + '\n').join(''))
  return summary
}

/** The IndexNow key: env INDEXNOW_KEY, else the {32 hex}.txt file at the site root whose content is its name. */
function findKey(root, env) {
  if (env?.INDEXNOW_KEY) return env.INDEXNOW_KEY
  for (const n of readdirSync(root).sort(cmp)) {
    const m = /^([0-9a-f]{32})\.txt$/i.exec(n)
    if (m && readText(join(root, n))?.trim() === m[1]) return m[1]
  }
  return null
}

async function notify(file, { root, env, fetchFn, log }) {
  if (!file) throw new Error('notify needs the changed-urls file')
  const urls = (readText(resolve(file)) ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  if (!urls.length) { log('notify: no changed urls, nothing sent'); return 0 }
  const key = findKey(root, env)
  if (!key) throw new Error('no IndexNow key (INDEXNOW_KEY or a {key}.txt at the site root)')
  const r = await submitIndexNow(new URL(CFG.SITE_URL).host, key, urls, fetchFn)
  log(`notify: ${r.ok ? 'ok' : 'failed'}, HTTP ${r.status}, ${r.submitted} of ${urls.length} urls submitted`)
  return r.ok ? 0 : 1
}

/** CLI. deps (for tests): { root, env, fetchFn, log, now }. Returns the exit code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? console.log
  const fetchFn = deps.fetchFn ?? fetch
  const env = deps.env ?? process.env
  let root = deps.root ?? fileURLToPath(new URL('..', import.meta.url))
  try {
    if (argv[0] === 'notify') return await notify(argv[1], { root, env, fetchFn, log })
    const o = { dryRun: false, rebuildAll: false, maxNewPages: CFG.maxNewPages }
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]
      if (a === '--dry-run') o.dryRun = true
      else if (a === '--rebuild-all') o.rebuildAll = true
      else if (a === '--max-new-pages') {
        const v = argv[++i]
        if (!/^\d+$/.test(v ?? '')) throw new Error('--max-new-pages needs a whole number')
        o.maxNewPages = Number(v)
      } else if (a === '--root') {
        if (!argv[i + 1]) throw new Error('--root needs a value')
        root = resolve(argv[++i])
      } else throw new Error(`unknown argument ${a}`)
    }
    await run({ ...o, root, env, fetchFn, log, now: deps.now ?? new Date().toISOString().slice(0, 10) })
    return 0
  } catch (err) {
    log(`refused: ${err.message}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code })
}
