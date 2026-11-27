// Guards on .github/workflows. On 2026-11-27 the daily refresh failed because a 30-day access
// token for a second repository was rejected (30 days old, so most likely expired), and a step labelled "optional" stopped the whole job.
// These tests keep that class of failure from coming back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../.github/workflows/', import.meta.url)
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((name) => {
  const text = readFileSync(new URL(name, dir), 'utf8')
  // Comment lines are documentation, not configuration.
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const steps = code.split(/\n(?= {6}- )/).slice(1)
  return { name, code, steps }
})

// Every secret a workflow may use. A secret that expires will one day break its job: before adding
// one here, make sure it has no expiry (or something warns before it expires). Prefer no secret.
const ALLOWED_SECRETS = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])

test('workflows use only allow-listed secrets', () => {
  for (const w of workflows) {
    for (const [, secret] of w.code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
      assert.ok(ALLOWED_SECRETS.has(secret), `${w.name}: secret ${secret} is not allow-listed`)
    }
    assert.doesNotMatch(w.code, /secrets\[/, `${w.name}: dynamic secret lookup`)
  }
})

test('no workflow checks out another repository', () => {
  for (const w of workflows) assert.doesNotMatch(w.code, /^\s+repository:/m, w.name)
})

test('every scheduled workflow opens an issue when it fails', () => {
  const scheduled = workflows.filter((w) => /^\s+schedule:/m.test(w.code))
  assert.ok(scheduled.length >= 2)
  for (const w of scheduled) {
    assert.match(w.code, /^\s+issues: write/m, `${w.name}: needs issues: write`)
    const alert = w.steps.find((s) => /if: failure\(\)/.test(s))
    assert.ok(alert, `${w.name}: no "if: failure()" step`)
    assert.match(alert, /gh issue create/, w.name)
    // The shell runs with -e: a failed lookup must not stop the step before the issue is written.
    assert.match(alert, /\|\| number=""/, `${w.name}: unguarded issue lookup`)
  }
})

test('refresh-stats: a venue list failure never blocks the stats, but is still reported', () => {
  const { steps } = workflows.find((w) => w.name === 'refresh-stats.yml')
  const at = (re) => steps.findIndex((s) => re.test(s))
  const venues = at(/id: venues/)
  const stats = at(/node scripts\/build-stats\.mjs/)
  const commit = at(/git push origin HEAD:main/)
  const report = at(/steps\.venues\.outcome == 'failure'/)
  const alert = at(/if: failure\(\)/)
  assert.ok(venues >= 0 && venues < stats && stats < commit, 'venues, stats, commit order')
  assert.match(steps[venues], /continue-on-error: true/)
  assert.match(steps[venues], /timeout-minutes: \d+/)
  const restore = steps.slice(venues + 1, stats).find((s) => /steps\.venues\.outcome == 'failure'/.test(s))
  assert.match(restore ?? '', /git checkout -- mapdata\/venues\.json mapdata\/geocache\.json/)
  const failAt = steps.findLastIndex((s) => /steps\.venues\.outcome == 'failure'/.test(s))
  assert.ok(report >= 0 && failAt > commit && failAt < alert, 'report the failure after the commit, before the alert')
  assert.match(steps[failAt], /exit 1/)
})

test('refresh-stats: failures cannot be swallowed and hangs end as step failures', () => {
  const { code, steps } = workflows.find((w) => w.name === 'refresh-stats.yml')
  const step = (re) => steps.find((s) => re.test(s))
  const venues = step(/id: venues/)
  // Without pipefail the exit status would be tee's, and a failed refresh would look fine.
  assert.match(venues, /set -o pipefail\n\s+node scripts\/build-data\.mjs [^\n]*\| tee /)
  assert.doesNotMatch(venues, /\|\|/)
  const commit = step(/git push origin HEAD:main/)
  assert.match(commit, /--autostash/)
  assert.match(commit, /done\n\s+exit 1\s*$/)
  // A job timeout cancels the run and skips "if: failure()"; a step timeout does not.
  const limits = [venues, step(/node scripts\/build-stats\.mjs/), step(/node --test/), commit]
    .map((s) => Number(/timeout-minutes: (\d+)/.exec(s)?.[1]))
  assert.ok(limits.every((n) => n > 0), `step timeouts: ${limits}`)
  const job = Number(/^ {4}timeout-minutes: (\d+)/m.exec(code)[1])
  assert.ok(job >= limits.reduce((a, b) => a + b) + 5, `job timeout ${job} leaves no room after ${limits}`)
})

// A workflow that stops being scheduled raises no failure of its own, so the other one watches it.
for (const [watcher, watched] of [['site-pipeline.yml', 'refresh-stats.yml'], ['refresh-stats.yml', 'site-pipeline.yml']]) {
  test(`${watcher} fails when ${watched} has stopped running on schedule`, () => {
    const { code, steps } = workflows.find((w) => w.name === watcher)
    assert.match(code, /^  actions: read$/m)
    const at = steps.findIndex((s) => s.includes(`actions/workflows/${watched}/runs?event=schedule&per_page=1`))
    assert.ok(at >= 0, 'no watchdog step')
    assert.match(steps[at], /exit 1/)
    const work = steps.findLastIndex((s) => /git push origin HEAD:main/.test(s))
    const alert = steps.findIndex((s) => /if: failure\(\)/.test(s))
    assert.ok(work >= 0 && at > work && at < alert, 'check after the push and before the alert')
  })
}

test('refresh-stats still checks the other schedule on a day the venue list fails', () => {
  const { steps } = workflows.find((w) => w.name === 'refresh-stats.yml')
  const watch = steps.find((s) => s.includes('actions/workflows/site-pipeline.yml/runs'))
  assert.match(watch, /if: \$\{\{ !cancelled\(\) \}\}/)
})
