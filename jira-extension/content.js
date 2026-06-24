// Isolated-world relay: receives postMessage from the page (injected.js),
// forwards to the background service worker, posts the response back.
;(function () {
  const BRIDGE = '__jira_bridge__'

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return
    if (!ev.data || ev.data.__bridge !== BRIDGE || ev.data.type !== 'req') return

    const { id, url, method, headers, body } = ev.data

    chrome.runtime.sendMessage({ type: 'jira_fetch', url, method, headers, body }, (res) => {
      const response = res || { error: chrome.runtime.lastError?.message || 'Extension unreachable' }
      window.postMessage({ __bridge: BRIDGE, type: 'res', id, ...response }, '*')
    })
  })
})()
