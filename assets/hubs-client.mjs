// City hub client: inlined into /bars/{st}/{city}/ pages as a module script, right after assets/bar-client.mjs
// (the renderer strips imports, exports and bar-client's own auto-run line), so the open/closed logic is the one
// shared openState. Reads the JSON data element (id "hub-data") { place_id: { tz, hours } } and fills each hidden
// badge span whose data-badge attribute names a place_id with "Open now" / "Closed". No network, no storage.
// Without JavaScript, or without tz/hours for a bar, the badge simply stays hidden.
import { openState, pillText } from './bar-client.mjs'

/** Badge wording ({ open, text, sep }) for one { tz, hours } entry at `now`, or null when it cannot be known. */
export function badgeFor(entry, now) {
  if (!entry) return null
  const state = openState(entry.hours, entry.tz || null, now)
  return state ? pillText(state) : null
}

/** DOM wiring. Everything it writes is built with textContent. */
export function initHubs(doc, now) {
  const node = doc.getElementById('hub-data')
  if (!node) return
  let data
  try { data = JSON.parse(node.textContent) } catch { return }
  if (!data || typeof data !== 'object') return
  for (const el of doc.querySelectorAll('[data-badge]')) {
    const id = el.getAttribute('data-badge')
    const t = badgeFor(Object.hasOwn(data, id) ? data[id] : null, now)
    if (!t) continue
    el.className = t.open ? 'badge open' : 'badge'
    const sep = doc.createElement('span')
    sep.className = 'sep'
    sep.textContent = t.sep
    const kids = [t.text, ' ', sep]
    if (t.open) {
      const dot = doc.createElement('span')
      dot.className = 'dot'
      dot.setAttribute('aria-hidden', 'true')
      kids.unshift(dot)
    }
    el.replaceChildren(...kids)
    el.hidden = false
  }
}

if (typeof document !== 'undefined') initHubs(document, new Date())
