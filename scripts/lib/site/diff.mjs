// Decides which generated files to write, tracks per-file lastmod, and reports removals.
// Pure: no clock (today is passed in), sorted output.
import { createHash } from 'node:crypto'

const STUB_DAYS = 90
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const days = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000

export function planWrites(files, existingHashes, today, existingOnDisk) {
  const prev = existingHashes || {}
  const sorted = [...files].sort((a, b) => byPath(a.path, b.path))
  const writes = []
  const unchanged = []
  const lastmod = {}
  const generated = new Set()
  for (const f of sorted) {
    generated.add(f.path)
    const hash = sha256(f.html)
    const old = prev[f.path]
    lastmod[f.path] = { hash, lastmod: old && old.hash === hash ? old.lastmod : today }
    const disk = existingOnDisk(f.path)
    if (old && old.hash === hash && disk === f.html) unchanged.push(f.path)
    else writes.push({ path: f.path, html: f.html })
  }
  const removals = []
  const expiredStubs = []
  for (const path of Object.keys(prev).sort(byPath)) {
    if (generated.has(path)) continue
    const old = prev[path]
    const removedOn = old.removedOn || today
    if (days(today) - days(removedOn) > STUB_DAYS) {
      expiredStubs.push(path)
      continue
    }
    removals.push(path)
    lastmod[path] = { hash: old.hash, lastmod: old.lastmod, removedOn }
  }
  const sortedLastmod = {}
  for (const k of Object.keys(lastmod).sort(byPath)) sortedLastmod[k] = lastmod[k]
  return { writes, unchanged, removals, expiredStubs, lastmod: sortedLastmod }
}
