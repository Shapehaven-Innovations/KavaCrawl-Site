// Render helpers for the two guide dashboards.
// Every export except bindConcentration is a pure function that returns an HTML or SVG string.
// Labels are always escaped with esc(); numbers go through num() so NaN, Infinity and
// undefined never reach the markup; empty input returns the unavailable() block.

export const TYPE_COLORS = {
  Games: '#6ece8d',
  Specials: '#e9d56b',
  Trivia: '#3fb6b2',
  'Open mic': '#5f8fe8',
  Music: '#b58be0',
  Karaoke: '#e0709a',
  Community: '#a8cf5a',
  'Movie night': '#f2ece0',
  Art: '#d9a066',
}

// Categorical colours for the "Where" share bar and chips, in order.
export const SHARE_PALETTE = ['#6ece8d', '#e9d56b', '#e98a5b', '#3fb6b2', '#c58fe0', '#7fa6ee', '#d96a8a', '#b8d65a', '#9db8ac', '#f2ece0', '#d9a066', '#8fd0e8', '#a58bff']

const MINT = '#6ece8d'
const GOLD = '#e9d56b'
const FALLBACK = '#4a6a60'

export function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : [])
const fx = (n, d = 1) => num(n).toFixed(d)
const color = (c) =>
  typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s]+\))$/.test(c.trim()) ? c.trim() : FALLBACK
const plural = (n, one, many) => (n === 1 ? one : many)

export function fmt(n, decimals) {
  if (!isNum(n)) return '—'
  if (decimals === undefined) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// "generated" as shown on the page: a full UTC timestamp renders in the viewer's
// timezone, an older date-only value renders as that calendar day. Anything else is null.
export function stampText(generated) {
  if (typeof generated !== 'string') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(generated)) {
    const [y, m, d] = generated.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(generated)) return null
  const t = new Date(generated)
  if (Number.isNaN(t.getTime())) return null
  return t.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

export function pct(value, total, decimals = 1) {
  if (!isNum(value) || !isNum(total) || total === 0) return '—'
  return ((value / total) * 100).toFixed(decimals) + '%'
}

export function unavailable(message = 'Data unavailable') {
  return `<p class="unavail" role="status">${esc(message)}</p>`
}

// Weeknight columns. The tallest column is drawn gold.
export function columnsHtml(items) {
  const rows = list(items)
  if (!rows.length) return unavailable()
  const max = Math.max(...rows.map((r) => num(r.value)))
  return `<div class="cols">${rows
    .map((r) => {
      const v = num(r.value)
      const h = max > 0 ? (v / max) * 100 : 0
      return `<div class="col${max > 0 && v === max ? ' top' : ''}"><b>${fmt(v)}</b><i style="height:${h.toFixed(1)}%"></i><span>${esc(r.label)}</span></div>`
    })
    .join('')}</div>`
}

// Labelled horizontal bars.
export function barsHtml(items, opts = {}) {
  const rows = list(items)
  if (!rows.length) return unavailable()
  const o = opts || {}
  const max = Math.max(...rows.map((r) => num(r.value)))
  return `<div class="bars">${rows
    .map((r) => {
      const v = num(r.value)
      const w = max > 0 ? (v / max) * 100 : 0
      return `<div class="row"><span class="lab">${esc(r.label)}</span><span class="track${o.gold ? ' gold' : ''}"><i style="width:${w.toFixed(1)}%"></i></span><b>${fmt(v, o.decimals)}</b></div>`
    })
    .join('')}</div>`
}

// One stacked bar, each item a flex segment.
export function shareHtml(items) {
  const rows = list(items).filter((r) => num(r.value) > 0)
  if (!rows.length) return unavailable()
  return `<div class="share">${rows
    .map((r) => `<i title="${esc(r.label)} ${fmt(num(r.value))}" style="flex:${num(r.value)};background:${color(r.color)}"></i>`)
    .join('')}</div>`
}

export function chipsHtml(items) {
  const rows = list(items)
  if (!rows.length) return unavailable()
  return `<div class="chips">${rows
    .map((r) => `<span><i style="background:${color(r.color)}"></i>${esc(r.label)} <b>${fmt(num(r.value))}</b></span>`)
    .join('')}</div>`
}

// Ring slice paths; one <path> per slice with a non-zero value.
function ring(slices, total, { R, r0, stroke, sw, extra = () => '', label }) {
  const cx = 100
  const cy = 100
  const pt = (rad, a) => [(cx + rad * Math.cos(a)).toFixed(2), (cy + rad * Math.sin(a)).toFixed(2)]
  let ang = -Math.PI / 2
  let paths = ''
  let labels = ''
  slices.forEach((s, i) => {
    const v = num(s.value)
    if (v <= 0) return
    const frac = v / total
    const a2 = ang + frac * 2 * Math.PI
    let d
    if (frac >= 0.9999) {
      const [ox, oy] = pt(R, ang)
      const [mx, my] = pt(R, ang + Math.PI)
      const [ix, iy] = pt(r0, ang)
      const [nx, ny] = pt(r0, ang + Math.PI)
      d = `M${ox} ${oy}A${R} ${R} 0 1 1 ${mx} ${my}A${R} ${R} 0 1 1 ${ox} ${oy}ZM${ix} ${iy}A${r0} ${r0} 0 1 0 ${nx} ${ny}A${r0} ${r0} 0 1 0 ${ix} ${iy}Z`
    } else {
      const l = a2 - ang > Math.PI ? 1 : 0
      const [x1, y1] = pt(R, ang)
      const [x2, y2] = pt(R, a2)
      const [x3, y3] = pt(r0, a2)
      const [x4, y4] = pt(r0, ang)
      d = `M${x1} ${y1}A${R} ${R} 0 ${l} 1 ${x2} ${y2}L${x3} ${y3}A${r0} ${r0} 0 ${l} 0 ${x4} ${y4}Z`
    }
    paths += `<path${extra(s, i)} d="${d}" fill="${color(s.color)}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${sw}"><title>${esc(s.title || `${s.label}: ${fmt(v)}`)}</title></path>`
    if (label && frac >= 0.08) {
      const [lx, ly] = pt((R + r0) / 2, frac >= 0.9999 ? Math.PI / 2 : (ang + a2) / 2)
      labels += `<text class="sl" x="${lx}" y="${(Number(ly) + 3.5).toFixed(2)}" text-anchor="middle" fill="#06210f" font-size="9" font-weight="800" pointer-events="none">${pct(v, total)}</text>`
    }
    ang = a2
  })
  return paths + labels
}

const centre = (value, caption, size = 26) =>
  `<text class="cv" x="100" y="${size >= 26 ? 98 : 99}" text-anchor="middle" fill="#f2ece0" font-size="${size}" font-weight="800">${esc(value)}</text>` +
  `<text class="cc" x="100" y="${size >= 26 ? 116 : 117}" text-anchor="middle" fill="#9db8ac" font-size="10">${esc(caption)}</text>`

// Donut chart with a centre value and caption.
export function donutSvg(items, centerValue, centerCaption) {
  const rows = list(items)
  const total = rows.reduce((s, r) => s + Math.max(0, num(r.value)), 0)
  if (!rows.length || total <= 0) return unavailable()
  const label = rows.map((r) => `${r.label} ${fmt(num(r.value))}`).join(', ')
  return `<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">${ring(rows, total, { R: 80, r0: 52, stroke: '#050e0c', sw: 2 })}${centre(centerValue, centerCaption)}</svg>`
}

export function legendHtml(items) {
  const rows = list(items)
  if (!rows.length) return unavailable()
  return `<ul class="leg">${rows
    .map((r) => `<li><i style="background:${color(r.color)}"></i>${esc(r.label)}<b>${fmt(num(r.value))}</b></li>`)
    .join('')}</ul>`
}

const rgb = (hex) => {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : FALLBACK
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',')
}

// Type x weekday grid. Cell intensity scales with the count against the busiest cell.
export function heatHtml(rows, days) {
  const rs = list(rows)
  const ds = Array.isArray(days) ? days : []
  if (!rs.length || !ds.length) return unavailable()
  const vals = (r) => ds.map((_, i) => num(Array.isArray(r.values) ? r.values[i] : 0))
  const max = Math.max(1, ...rs.flatMap(vals))
  const tpl = `grid-template-columns:minmax(96px,130px) repeat(${ds.length},minmax(38px,1fr)) 54px`
  let html = `<div class="hr hh" role="row" style="${tpl}"><span></span>${ds.map((d) => `<span>${esc(d)}</span>`).join('')}<span>Total</span></div>`
  for (const r of rs) {
    const c = color(r.color)
    const c3 = rgb(c)
    const v = vals(r)
    html +=
      `<div class="hr" role="row" style="${tpl}"><span class="hl" role="rowheader"><i style="background:${c}"></i>${esc(r.label)}</span>` +
      v
        .map((n) => {
          const a = n / max
          return `<span class="cell" role="cell" style="background:rgba(${c3},${(a * 0.8 + (n ? 0.08 : 0.02)).toFixed(3)});border-color:rgba(${c3},${(a * 0.5 + 0.08).toFixed(3)});color:${a > 0.55 ? '#04120c' : '#f2ece0'}">${n ? fmt(n) : '·'}</span>`
        })
        .join('') +
      `<span class="tot">${fmt(v.reduce((s, n) => s + n, 0))}</span></div>`
  }
  return `<div class="heat" role="table">${html}</div>`
}

// Horizontal lollipops as one SVG.
export function lollipopSvg(items) {
  const rows = list(items)
  if (!rows.length) return unavailable()
  const max = Math.max(...rows.map((r) => num(r.value)))
  const rowH = 30
  const W = 600
  const x0 = 170
  const x1 = W - 50
  const H = rows.length * rowH + 6
  const body = rows
    .map((r, i) => {
      const v = num(r.value)
      const y = i * rowH + rowH / 2 + 3
      const x = max > 0 ? x0 + ((x1 - x0) * v) / max : x0
      return (
        `<text x="0" y="${y + 4}" fill="#9db8ac" font-size="14">${esc(r.label)}</text>` +
        `<line x1="${x0}" y1="${y}" x2="${x.toFixed(1)}" y2="${y}" stroke="#2f5d52" stroke-width="2"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y}" r="6.5" fill="${color(r.color)}" stroke="#050e0c" stroke-width="3"/>` +
        `<text x="${W}" y="${y + 4}" text-anchor="end" fill="#f2ece0" font-size="14" font-weight="700">${fmt(v)}</text>`
      )
    })
    .join('')
  return `<svg class="lolli" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rows.map((r) => `${r.label} ${fmt(num(r.value))}`).join(', '))}">${body}</svg>`
}

// Top cities as HTML lollipop rows; the lead state in mint, elsewhere gold.
export function topCitiesHtml(cities, leadSt, leadName) {
  const rows = list(cities)
  if (!rows.length) return unavailable()
  const max = Math.max(...rows.map((r) => num(r.venues)))
  const key = `<div class="sd-key sd-corner" aria-hidden="true"><span><i style="background:${MINT}"></i>${esc(leadName || leadSt)}</span><span><i style="background:${GOLD}"></i>Elsewhere</span></div>`
  const body = rows
    .map((r) => {
      const v = num(r.venues)
      const w = max > 0 ? (v / max) * 100 : 0
      const c = r.st === leadSt ? MINT : GOLD
      return `<div class="sd-r" role="listitem"><span class="nm">${esc(r.city)}, ${esc(r.st)}</span><span class="sd-lp"><i style="width:calc(${w.toFixed(1)}% - 8px);--c:${c}"></i></span><b class="v">${fmt(v)}</b></div>`
    })
    .join('')
  return `${key}<div class="sd-rows sd-city" role="list" aria-label="Top cities by venue count">${body}</div>`
}

// City-size buckets with share of cities, plus a takeaway line computed from the inputs.
// sizes[0] is taken as the single-venue bucket and the last entry as the biggest bucket.
export function citySizesHtml(sizes, totalCities, totalVenues, bigBucketVenues, bigBucketCities) {
  const rows = list(sizes)
  if (!rows.length) return unavailable()
  const max = Math.max(...rows.map((r) => num(r.cities)))
  const body = rows
    .map((r) => {
      const v = num(r.cities)
      const w = max > 0 ? (v / max) * 100 : 0
      return `<div class="sd-r"><span class="nm">${esc(r.label)}</span><span class="sd-bar"><i style="width:${w.toFixed(1)}%"></i></span><b class="v">${fmt(v)}<small>${pct(v, totalCities)}</small></b></div>`
    })
    .join('')
  const one = num(rows[0].cities)
  const tc = num(totalCities)
  const bc = num(bigBucketCities)
  const bv = num(bigBucketVenues)
  const last = String(rows[rows.length - 1].label || '')
  const m = /^(\d+)\s*\+/.exec(last)
  const bigWords = m ? `with ${m[1]} or more` : 'in the largest group'
  let note = `<b>${fmt(one)} of ${fmt(tc)}</b> ${plural(tc, 'city', 'cities')} (${pct(one, tc)}) ${plural(one, 'has', 'have')} a single venue.`
  if (rows.length > 1 && bc > 0) {
    note += ` The <b>${fmt(bc)}</b> ${plural(bc, 'city', 'cities')} ${bigWords} ${plural(bc, 'holds', 'hold')} <b>${fmt(bv)}</b> ${plural(bv, 'venue', 'venues')}, ${pct(bv, num(totalVenues))} of the total.`
  }
  return `<div class="sd-rows sd-size">${body}</div><p class="sd-note">${note}</p>`
}

// Lead state mint; every other state on a gold-orange ramp with alternating lightness.
const concColor = (i, n) => {
  if (i === 0) return MINT
  const k = n - 2
  const t = k > 0 ? (i - 1) / k : 0
  return `hsl(${Math.round(48 - t * 26)} ${Math.round(78 - t * 8)}% ${i % 2 ? 70 : 58}%)`
}

// Concentration donut with a lead-state line and a grouped legend of the rest.
export function concentrationHtml(byState, total) {
  const rows = list(byState).filter((r) => num(r.venues) > 0)
  const sum = rows.reduce((s, r) => s + num(r.venues), 0)
  const T = isNum(total) && total > 0 ? total : sum
  if (!rows.length || T <= 0) return unavailable()
  const name = (r) => r.name || r.st
  const slices = rows.map((r, i) => ({
    label: name(r),
    value: num(r.venues),
    color: concColor(i, rows.length),
    title: `${name(r)}: ${fmt(num(r.venues))} ${plural(num(r.venues), 'venue', 'venues')} (${pct(num(r.venues), T)})`,
  }))
  const extra = (s, i) => ` data-i="${i}" data-v="${esc(fmt(s.value))}" data-n="${esc(`${s.label}, ${pct(s.value, T)}`)}"`
  const svg =
    `<svg viewBox="0 0 200 200" role="img" aria-label="Share of venues by state" data-v="${esc(fmt(T))}" data-n="venues">` +
    ring(slices, T, { R: 88, r0: 52, stroke: '#0b1d19', sw: 1.2, extra, label: true }) +
    `<g class="sd-ctr">${centre(fmt(T), 'venues', 25)}</g></svg>`
  const ld = rows[0]
  const lead = `<div class="sd-lead" data-i="0"><b>${pct(num(ld.venues), T)}</b><span><strong>${esc(name(ld))}</strong>, the lead state</span><small>${fmt(num(ld.venues))} of ${fmt(T)} venues</small></div>`
  const rest = rows.slice(1)
  let legend = ''
  if (rest.length) {
    const restSum = rest.reduce((s, r) => s + num(r.venues), 0)
    legend =
      `<div class="sd-legwrap"><p class="sd-legh">${fmt(rest.length)} more ${plural(rest.length, 'state', 'states')}, ${pct(restSum, T)} of venues</p><ul class="sd-leg">` +
      rest
        .map(
          (r, j) =>
            `<li tabindex="0" data-i="${j + 1}"><i style="background:${slices[j + 1].color}"></i><span>${esc(name(r))}</span><em>${fmt(num(r.venues))}</em><b>${pct(num(r.venues), T)}</b></li>`,
        )
        .join('') +
      `</ul></div>`
  }
  return `<div class="sd-conc">${svg}<div class="sd-side">${lead}${legend}</div></div>`
}

// Hover and focus on a slice, legend row or the lead line dims the other slices and
// shows that state in the donut centre. DOM only; safe to call when nothing matches.
export function bindConcentration(root) {
  if (!root || typeof root.querySelector !== 'function') return
  const box = root.matches && root.matches('.sd-conc') ? root : root.querySelector('.sd-conc')
  if (!box || box.dataset.bound) return
  const svg = box.querySelector('svg')
  const ctr = svg && svg.querySelector('.sd-ctr')
  const cv = ctr && ctr.querySelector('.cv')
  const cc = ctr && ctr.querySelector('.cc')
  if (!svg || !cv || !cc) return
  box.dataset.bound = '1'
  const paths = Array.from(svg.querySelectorAll('path[data-i]'))
  const show = (i) => {
    const p = i == null ? null : paths.find((el) => el.dataset.i === String(i))
    if (!p) {
      svg.classList.remove('hl')
      paths.forEach((el) => el.classList.remove('on'))
      cv.textContent = svg.dataset.v || ''
      cc.textContent = svg.dataset.n || ''
      return
    }
    svg.classList.add('hl')
    paths.forEach((el) => el.classList.toggle('on', el === p))
    cv.textContent = p.dataset.v || ''
    cc.textContent = p.dataset.n || ''
  }
  const pick = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-i]') : null
    return el && box.contains(el) ? el.dataset.i : null
  }
  const targets = [svg, box.querySelector('.sd-leg'), box.querySelector('.sd-lead')].filter(Boolean)
  for (const el of targets) {
    el.addEventListener('mouseover', (e) => {
      const i = pick(e)
      if (i != null) show(i)
    })
    el.addEventListener('mouseleave', () => show(null))
    el.addEventListener('focusin', (e) => {
      const i = pick(e)
      if (i != null) show(i)
    })
    el.addEventListener('focusout', () => show(null))
  }
}

// Venues per city by state: two columns on desktop, dashed overall-average marker,
// states above the average in the gold-orange bar. Sorted by average, then venues.
export function densityHtml(items, overallAvg) {
  const rows = list(items)
    .slice()
    .sort((a, b) => num(b.avg) - num(a.avg) || num(b.venues) - num(a.venues))
  if (!rows.length) return unavailable()
  const hasAvg = isNum(overallAvg) && overallAvg > 0
  const max = Math.max(...rows.map((r) => num(r.avg)), hasAvg ? overallAvg : 0)
  const at = (v) => (max > 0 ? (v / max) * 100 : 0).toFixed(1)
  const avgLine = hasAvg ? `<span class="sd-avg sd-corner"><u></u>All states average ${fx(overallAvg)}</span>` : ''
  const body = rows
    .map((r) => {
      const v = num(r.venues)
      const c = num(r.cities)
      const a = num(r.avg)
      return (
        `<div class="sd-r"><span class="nm">${esc(r.name)}<small>${fmt(v)} ${plural(v, 'venue', 'venues')} in ${fmt(c)} ${plural(c, 'city', 'cities')}</small></span>` +
        `<span class="sd-dbar"><i${hasAvg && a > overallAvg ? ' class="up"' : ''} style="width:${at(a)}%"></i>${hasAvg ? `<u style="left:${at(overallAvg)}%"></u>` : ''}</span>` +
        `<b class="v">${fx(a)}</b></div>`
      )
    })
    .join('')
  return `${avgLine}<div class="sd-dens" style="--n:${Math.ceil(rows.length / 2)}">${body}</div>`
}
