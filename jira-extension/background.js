// Background service worker — no CORS restrictions here.
// Receives fetch requests from the page (via content.js relay) and returns the response.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'jira_fetch') return false

  const { url, method, headers, body } = msg

  fetch(url, {
    method: method || 'GET',
    headers: headers || {},
    body: body || undefined,
  })
    .then(async (res) => {
      const resHeaders = {}
      const SKIP = new Set(['content-encoding', 'transfer-encoding', 'content-length'])
      res.headers.forEach((v, k) => { if (!SKIP.has(k.toLowerCase())) resHeaders[k] = v })
      const text = await res.text()
      sendResponse({ status: res.status, statusText: res.statusText, headers: resHeaders, body: text })
    })
    .catch((err) => sendResponse({ error: err.message }))

  return true // keep message channel open for async sendResponse
})
