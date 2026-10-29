// IndexNow ping (Bing, Yandex and others share it). The key file https://{host}/{key}.txt sits at the site root.
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH = 10000

/** POSTs urls in batches of 10,000. ok when every batch answers 200 or 202; stops at the first failing batch. */
export async function submitIndexNow(host, key, urls, fetchFn = fetch) {
  let status = 0
  let submitted = 0
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH)
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
    })
    status = res.status
    if (status !== 200 && status !== 202) return { ok: false, status, submitted }
    submitted += urlList.length
  }
  return { ok: true, status, submitted }
}
