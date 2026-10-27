// Classify event titles into night types using scripts/event-rules.json.
// Matching is case-insensitive and whole-word: an entry must start and end at a
// non-alphanumeric character or the string edge. A trailing `*` lets the last
// word take any ending letters ("monday*" matches "mondays").
import { readFileSync } from 'node:fs'

export const LISTING = 'Listing'
const FALLBACK = 'Community'

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function entrySource(entry) {
  const raw = String(entry).trim().toLowerCase()
  const star = raw.endsWith('*')
  const stem = star ? raw.slice(0, -1) : raw
  if (!stem) throw new Error(`event-rules: empty match entry "${entry}"`)
  const body = stem.split(/\s+/).map(escape).join('\\s+')
  return star ? `${body}[a-z]*` : body
}

function compile(entries) {
  const alt = entries.map(entrySource).join('|')
  return new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, 'i')
}

export function loadRules(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'))
  const types = json.types
  if (!Array.isArray(types) || types.length === 0) throw new Error('event-rules: types must be a non-empty array')
  if (!types.includes(FALLBACK)) throw new Error(`event-rules: types must include ${FALLBACK}`)
  const rules = (json.rules ?? []).map((r) => {
    if (!types.includes(r.type)) throw new Error(`event-rules: unknown rule type "${r.type}"`)
    if (!Array.isArray(r.match) || r.match.length === 0) throw new Error(`event-rules: rule "${r.type}" has no match entries`)
    return { type: r.type, match: r.match, re: compile(r.match) }
  })
  const listing = json.listing ?? []
  return {
    types: [...types],
    rules,
    listing,
    listingRe: listing.length ? compile(listing) : null,
  }
}

export function classify(title, rules) {
  const t = typeof title === 'string' ? title : ''
  if (t) {
    // Schedule-listing rows are never events, so they win over every type rule.
    if (rules.listingRe?.test(t)) return LISTING
    for (const r of rules.rules) if (r.re.test(t)) return r.type
  }
  return FALLBACK
}
