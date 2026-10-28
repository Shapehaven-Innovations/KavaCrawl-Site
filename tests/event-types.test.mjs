import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRules, classify } from '../scripts/lib/event-types.mjs'

const RULES_PATH = fileURLToPath(new URL('../scripts/event-rules.json', import.meta.url))
const rules = loadRules(RULES_PATH)

const TYPES = ['Games', 'Specials', 'Community', 'Trivia', 'Open mic', 'Music', 'Karaoke', 'Movie night', 'Art']

const table = [
  ['Trivia Night', 'Trivia'],
  ['Music Bingo', 'Games'],
  ['Music Video Bingo', 'Games'],
  ['Brand Ambassador Day', 'Community'],
  ['Pajama Movie Night Party', 'Movie night'],
  ['Flow Jam', 'Community'],
  ['Thirsty Thursday with Jammin Jensen', 'Specials'],
  ['Ladies Night', 'Specials'],
  ['Manic Monday', 'Specials'],
  ['Trading Card Tuesdays', 'Games'],
  ['Super Smash Bros Tournament', 'Games'],
  ['Ice Bath Social', 'Community'],
  ['DJ Night', 'Music'],
  ['Live Music Fridays', 'Music'],
  ['Rock Band Sundays', 'Music'],
  ['Karaoke Thursday', 'Karaoke'],
  ['Comic Slam', 'Community'],
  ['Weekly Schedule', 'Listing'],
  ['', 'Community'],
  [null, 'Community'],
  [undefined, 'Community'],
]

for (const [title, expected] of table) {
  test(`classify(${JSON.stringify(title) ?? 'undefined'}) -> ${expected}`, () => {
    assert.equal(classify(title, rules), expected)
  })
}

test('types are the fixed display order with no catch-all', () => {
  assert.deepEqual(rules.types, TYPES)
})

test('every rule type is a declared type', () => {
  for (const r of rules.rules) assert.ok(TYPES.includes(r.type), r.type)
})

test('listing phrases are detected even though they contain other words', () => {
  assert.equal(classify('Weekly Events', rules), 'Listing')
  assert.equal(classify('This Week at the Bar', rules), 'Listing')
})

test('does not match inside words', () => {
  // "bass" must not hit inside "ambassador", "jam" not inside "pajama"
  const custom = loadRulesFrom({
    types: ['Music', 'Community'],
    rules: [{ type: 'Music', match: ['bass', 'jam'] }],
    listing: [],
  })
  assert.equal(classify('Ambassador', custom), 'Community')
  assert.equal(classify('Pajama', custom), 'Community')
  assert.equal(classify('Bass Night', custom), 'Music')
  assert.equal(classify('jam', custom), 'Music')
})

test('trailing * matches any ending letters on the stem only', () => {
  const custom = loadRulesFrom({
    types: ['Specials', 'Community'],
    rules: [{ type: 'Specials', match: ['monday*'] }],
    listing: [],
  })
  assert.equal(classify('Mondays', custom), 'Specials')
  assert.equal(classify('MONDAY', custom), 'Specials')
  assert.equal(classify('Mondays2', custom), 'Community')
  assert.equal(classify('somemonday', custom), 'Community')
})

test('rule order: Games beats Music, earlier rules beat weekday Specials', () => {
  assert.equal(classify('Music Bingo Thursday', rules), 'Games')
  assert.equal(classify('Trivia Tuesday', rules), 'Trivia')
  assert.equal(classify('Open Mic Monday', rules), 'Open mic')
})

test('a schedule row that names a type counts once toward that type', () => {
  assert.equal(classify('Weekly Schedule - Karaoke & Bingo', rules), 'Karaoke')
  assert.equal(classify('This Week at Bula Bar: Trivia', rules), 'Trivia')
})

test('bare schedule listings stay listings', () => {
  assert.equal(classify('Weekly Events & Hours', rules), 'Listing')
  assert.equal(classify('Weekly Schedule', rules), 'Listing')
})

test('weekly real events are not listings', () => {
  assert.equal(classify('Weekly Pool Tournament', rules), 'Games')
  assert.equal(classify('Weekly Trivia', rules), 'Trivia')
})

// Helper: build rules from an object by writing a temp file.
function loadRulesFrom(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'event-rules-'))
  try {
    const p = join(dir, 'rules.json')
    writeFileSync(p, JSON.stringify(obj))
    return loadRules(p)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
