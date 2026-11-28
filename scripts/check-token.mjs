// Fails when the Cloudflare API token is rejected or expires soon, so it is replaced before a job
// breaks. Prints the status and expiry date only, never the token.
// env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchRetry } from './lib/http.mjs'

const API = 'https://api.cloudflare.com/client/v4'
const WARN_DAYS = 30

export async function checkToken(env, { now = new Date(), fetchFn, sleep } = {}) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = env
  if (!token || !account) return { ok: false, message: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set' }
  let status, body
  // Account-owned tokens and user tokens are verified on different endpoints.
  for (const url of [`${API}/accounts/${account}/tokens/verify`, `${API}/user/tokens/verify`]) {
    const r = await fetchRetry(url, { headers: { Authorization: `Bearer ${token}` } },
      { fetchFn, sleep, read: (res) => (res.ok ? res.json() : null) })
    status = r.res.status
    body = r.body
    if (r.res.ok && body?.result) break
  }
  const result = body?.result
  if (!result) return { ok: false, message: `verification refused: HTTP ${status}` }
  if (result.status !== 'active') return { ok: false, message: `status ${result.status}` }
  if (!result.expires_on) return { ok: true, message: 'active, no expiry' }
  const days = Math.floor((Date.parse(result.expires_on) - now) / 86400000)
  const date = result.expires_on.slice(0, 10)
  if (days <= WARN_DAYS) return { ok: false, message: `expires in ${days} days (${date}); create a new one` }
  return { ok: true, message: `active, expires ${date}` }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkToken(process.env).then(
    ({ ok, message }) => {
      console.log(`${ok ? '' : '::error::'}CLOUDFLARE_API_TOKEN: ${message}`)
      process.exitCode = ok ? 0 : 1
    },
    (e) => {
      console.log(`::error::CLOUDFLARE_API_TOKEN: could not verify (${e.message})`)
      process.exitCode = 1
    },
  )
}
