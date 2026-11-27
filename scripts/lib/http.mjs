// Network calls with a timeout and retries, so one dropped connection does not fail a scheduled run.
// Retried: a thrown error (reset, timeout, broken body), HTTP 408, 429 and 5xx. Only use for reads.
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const transient = (status) => status === 408 || status === 429 || status >= 500

// Returns { res, body }. `read` (optional) consumes the body inside the retried block.
// After the last attempt a thrown error is rethrown; a bad status is returned to the caller.
export async function fetchRetry(url, init = {}, { fetchFn = fetch, sleep = wait, attempts = 5, timeoutMs = 30000, read } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (i >= attempts || !transient(res.status)) return { res, body: read ? await read(res) : undefined }
    } catch (err) {
      if (i >= attempts) throw err
      console.log(`retrying after ${err.message} (attempt ${i} of ${attempts})`)
    }
    await sleep(1000 * 2 ** i)
  }
}

// JSON from a GET. 404 means "no such record" and gives null; any other failure throws, so an
// outage can never be mistaken for missing data.
export async function getApiJson(url, options = {}) {
  const { res, body } = await fetchRetry(url, { headers: { 'User-Agent': 'KavaCrawl-build/1.0' } },
    { ...options, read: (r) => (r.ok ? r.json() : null) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`)
  return body
}
