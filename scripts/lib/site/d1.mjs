// Read-only SQL against Cloudflare D1 through the REST API. The only network call in the site build.
// Transient failures are retried (see ../http.mjs); the statements are reads, so a retry is safe.
// env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID. Tests inject fetchFn.
import { fetchRetry } from '../http.mjs'

export async function queryD1(env, sql, params, fetchFn = fetch, sleep) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_DATABASE_ID: db } = env ?? {}
  if (!token || !account || !db) throw new Error('D1 query needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID')
  const body = params === undefined ? { sql } : { sql, params }
  const { res, body: json } = await fetchRetry(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    fetchFn,
    sleep,
    attempts: 4,
    // A broken body on a good status is retried; an error page that is not JSON is not.
    read: async (r) => { try { return await r.json() } catch (e) { if (r.ok) throw e; return null } },
  })
  const errors = (json?.errors ?? []).map((e) => e.message).join('; ')
  if (!res.ok) throw new Error(`D1 query failed: HTTP ${res.status}${errors ? ` (${errors})` : ''}`)
  if (!json || json.success === false) throw new Error(`D1 query failed${errors ? `: ${errors}` : ''}`)
  const first = json.result?.[0]
  if (!first || first.success === false || !Array.isArray(first.results)) throw new Error('D1 query failed: unexpected response shape')
  const rowsRead = Number.isFinite(first.meta?.rows_read) ? first.meta.rows_read : 0
  return { rows: first.results, rowsRead }
}
