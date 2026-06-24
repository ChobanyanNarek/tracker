// Runs in the PAGE world. Overrides window.fetch for Atlassian URLs,
// routing them through the extension background worker via postMessage.
;(function () {
  const BRIDGE = '__jira_bridge__'
  let _id = 0
  const origFetch = window.fetch.bind(window)

  window.fetch = function (input, init) {
    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input.url

    // Only intercept Atlassian requests
    if (!url.includes('atlassian.net') && !url.includes('jira.com')) {
      return origFetch(input, init)
    }

    const id = ++_id

    return new Promise((resolve, reject) => {
      function handler(ev) {
        if (ev.source !== window) return
        if (!ev.data || ev.data.__bridge !== BRIDGE || ev.data.id !== id) return
        window.removeEventListener('message', handler)
        const d = ev.data
        if (d.error) return reject(new TypeError(d.error))
        resolve(new Response(d.body, { status: d.status, statusText: d.statusText, headers: d.headers }))
      }
      window.addEventListener('message', handler)

      // Serialize headers
      const headers = {}
      const h = init?.headers
      if (h instanceof Headers) h.forEach((v, k) => { headers[k] = v })
      else if (Array.isArray(h)) h.forEach(([k, v]) => { headers[k] = v })
      else if (h && typeof h === 'object') Object.assign(headers, h)

      window.postMessage({
        __bridge: BRIDGE,
        type: 'req',
        id,
        url,
        method: init?.method || 'GET',
        headers,
        body: init?.body ?? null,
      }, '*')
    })
  }
})()
