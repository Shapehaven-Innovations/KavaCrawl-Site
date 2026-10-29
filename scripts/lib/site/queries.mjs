// The five bulk, read-only D1 selects of the site build. No bound ids (D1 caps bound params at 100):
// every query reads the whole table slice and the caller filters to the curated list in code.
// Constants mirror KavaCrawl/kava-proxy: EVENTS_SOURCE (events.js), HISTORY_DAYS = 26*7 and the shell
// categories of obsValue (venues.js). Keep them in step.

export const EVENTS_SOURCE = 'mykavabar'
export const HISTORY_DAYS = 26 * 7
export const SHELL_CATEGORIES = ['kava_shell', 'kava_double', 'kava_brew', 'kava_shot']

const inList = SHELL_CATEGORIES.map((c) => `'${c}'`).join(', ')

export const SQL = Object.freeze({
  places: `SELECT place_id, name, formatted_address, lat, lng, phone, website, business_status, hours_json, hidden
  FROM places ORDER BY place_id`,

  scores: `SELECT place_id, metro, state, total, components_json FROM venue_scores ORDER BY place_id`,

  latestPrices: `SELECT o.place_id, o.category, o.item_name, o.price_usd, o.size_oz, o.shell_equiv
  FROM price_observations o
  JOIN (SELECT place_id, MAX(observed_on) AS d FROM price_observations GROUP BY place_id) m
    ON m.place_id = o.place_id AND m.d = o.observed_on
  ORDER BY o.place_id, o.category, o.price_usd, o.item_name`,

  shellHistory: `SELECT place_id, observed_on, category, price_usd, size_oz, shell_equiv
  FROM price_observations
  WHERE category IN (${inList}) AND observed_on >= date('now', '-${HISTORY_DAYS} days')
  ORDER BY place_id, observed_on`,

  events: `SELECT e.place_id, e.title, e.day_of_week, e.start_time, e.end_time, e.is_recurring, e.start_date, e.end_date
  FROM venue_events e
  WHERE e.source = '${EVENTS_SOURCE}'
    AND NOT EXISTS (SELECT 1 FROM places p WHERE p.place_id = e.place_id AND p.hidden = 1)
  ORDER BY e.place_id, e.day_of_week, e.start_time, e.title`,
})
