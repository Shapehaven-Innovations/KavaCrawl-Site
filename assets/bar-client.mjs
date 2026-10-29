// Bar page client: inlined into each /bars/.../ page as a module script (exports stripped by the renderer).
// Reads the page's JSON data element (id "bar-data") { tz, hours, events } and, in the
// bar's own time zone: fills the open-now pill, marks today's hours row, shows "Tonight" chips and hides
// one-off events whose date has passed. No network, no cookies, no storage. The pure functions below take
// `now` as a parameter so they are testable in Node; init() is the thin DOM wiring.

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK = 7 * 1440

/** "17:00" -> "5:00 PM" (short: "5 PM", "7:30 PM"). "" for anything else. */
export function fmtTime(t, short = false) {
  const m = typeof t === 'string' ? /^(\d{2}):(\d{2})$/.exec(t) : null
  if (!m) return ''
  const h = Number(m[1]) % 24
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return short && m[2] === '00' ? `${h12} ${ap}` : `${h12}:${m[2]} ${ap}`
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** Weekday (0 = Sunday), minutes since midnight and YYYY-MM-DD of `now` in `tz` (visitor's zone if tz is null). */
export function localParts(now, tz) {
  const opts = { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  if (tz) opts.timeZone = tz
  const p = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-US', opts).formatToParts(now)) p[type] = value
  return { day: DAYS.indexOf(p.weekday), minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` }
}

/** Week-minute intervals [start, end) from [{day, open, close}]; overnight periods run past their day. */
function intervals(hours) {
  return hours.map(({ day, open, close }) => {
    const s = day * 1440 + toMin(open)
    let e = day * 1440 + toMin(close)
    if (e <= s) e += 1440
    return [s, e]
  })
}

/**
 * Open/closed state now, in the bar's zone. Null when tz or hours are missing (no pill is shown).
 * Open: { open: true, closes: 'HH:MM' } or { open: true, allDay: true }.
 * Closed: { open: false, opens: 'HH:MM', opensDay, today }.
 */
export function openState(hours, tz, now) {
  if (!tz || !Array.isArray(hours) || hours.length === 0) return null
  const { day, minutes } = localParts(now, tz)
  const w = day * 1440 + minutes
  const iv = intervals(hours)
  const inside = (x) => iv.find(([s, e]) => (s <= x && x < e) || (s <= x + WEEK && x + WEEK < e))
  const cur = inside(w)
  if (cur) {
    // Follow back-to-back periods (16:00-24:00 then 00:00-02:00) to the real closing time.
    let end = cur[1]
    for (let n = 0; n < 14; n++) {
      const next = iv.find(([s]) => s % WEEK === end % WEEK)
      if (!next) break
      end = end + (next[1] - next[0])
      if (end - w >= WEEK) return { open: true, allDay: true }
    }
    return { open: true, closes: fromMin(end % 1440) }
  }
  let best = null
  for (const [s] of iv) {
    const ahead = (s - w + WEEK) % WEEK
    if (best == null || ahead < best[0]) best = [ahead, s]
  }
  const s = best[1] % WEEK
  return { open: false, opens: fromMin(s % 1440), opensDay: Math.floor(s / 1440), today: day }
}

/** Pill wording for an openState result. */
export function pillText(state) {
  if (state.open) return { open: true, text: 'Open now', sep: state.allDay ? 'open 24 hours' : `closes ${fmtTime(state.closes, true)}` }
  const when = state.opensDay === state.today ? '' : `${DAYS[state.opensDay]} `
  return { open: false, text: 'Closed', sep: `opens ${when}${fmtTime(state.opens, true)}` }
}

/** A one-off whose end_date (or start_date) is before today in the bar's zone. Recurring events never are. */
export function isPastOneOff(ev, tz, now) {
  if (ev.is_recurring) return false
  const last = ev.end_date || ev.start_date
  if (!last) return false
  return localParts(now, tz).date > last
}

/** Indexes of today's events: recurring ones on today's weekday, and one-offs dated today. [] without tz. */
export function tonightEvents(events, tz, now) {
  if (!tz || !Array.isArray(events)) return []
  const { day, date } = localParts(now, tz)
  const out = []
  events.forEach((ev, i) => {
    if (ev.is_recurring ? ev.day === day : ev.start_date === date) out.push(i)
  })
  return out
}

function span(doc, cls, text) {
  const el = doc.createElement('span')
  if (cls) el.className = cls
  el.textContent = text
  return el
}

/** DOM wiring. Everything it writes is built with textContent; the static page is complete without it. */
export function init(doc, now) {
  const node = doc.getElementById('bar-data')
  if (!node) return
  let data
  try { data = JSON.parse(node.textContent) } catch { return }
  const tz = data.tz || null

  const pill = doc.getElementById('open-now')
  const state = pill ? openState(data.hours, tz, now) : null
  if (state) {
    const t = pillText(state)
    pill.className = t.open ? 'pill' : 'rbox na'
    const kids = [t.text, ' ', span(doc, 'sep', t.sep)]
    if (t.open) kids.unshift(span(doc, 'dot', ''))
    pill.replaceChildren(...kids)
    pill.hidden = false
  }

  const hours = doc.getElementById('hours')
  if (hours && tz) {
    const today = String(localParts(now, tz).day)
    for (const li of hours.querySelectorAll('li')) {
      if (li.getAttribute('data-day') !== today) continue
      li.classList.add('today')
      const b = li.querySelector('b')
      if (b) b.append(span(doc, 'today-chip', 'Today'))
    }
  }

  const events = doc.getElementById('events')
  if (events && Array.isArray(data.events)) {
    const byIndex = new Map()
    for (const li of events.querySelectorAll('li')) {
      const i = li.getAttribute('data-i')
      if (i != null) byIndex.set(Number(i), li)
    }
    let shown = 0
    data.events.forEach((ev, i) => {
      const li = byIndex.get(i)
      if (!li) return
      if (isPastOneOff(ev, tz, now)) li.hidden = true
      else shown++
    })
    const tonight = doc.getElementById('tonight')
    const picks = tonightEvents(data.events, tz, now).filter((i) => byIndex.has(i) && !byIndex.get(i).hidden)
    if (tonight && picks.length) {
      tonight.replaceChildren(...picks.map((i) => {
        const row = byIndex.get(i)
        const name = row.querySelector('span.nm')
        const time = row.querySelector('span.t')
        const li = doc.createElement('li')
        li.className = 'hot'
        const b = doc.createElement('b')
        b.textContent = 'Tonight'
        li.append(b, ' ', name ? name.textContent : '', ' ')
        if (time && time.textContent) {
          const small = doc.createElement('small')
          small.textContent = time.textContent
          li.append(small)
        }
        return li
      }))
      tonight.hidden = false
    }
    if (shown === 0) events.hidden = true
  }
}

if (typeof document !== 'undefined') init(document, new Date())
