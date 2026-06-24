const BRIDGE = '__jira_bridge__'

// Sends a fetch request through the Chrome extension background worker (no CORS).
// Returns null if the extension isn't installed or doesn't respond within 5 s.
export function fetchViaBridge(url: string, headers: Record<string, string>): Promise<Response | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2, 10)

    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve(null)
    }, 5000)

    function handler(ev: MessageEvent) {
      if (!ev.data || ev.data.__bridge !== BRIDGE || ev.data.type !== 'res' || ev.data.id !== id) return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      const d = ev.data as {
        error?: string
        status: number
        statusText: string
        headers: Record<string, string>
        body: string
      }
      if (d.error) { resolve(null); return }
      resolve(new Response(d.body, { status: d.status, statusText: d.statusText, headers: d.headers }))
    }

    window.addEventListener('message', handler)
    window.postMessage({ __bridge: BRIDGE, type: 'req', id, url, method: 'GET', headers, body: null }, '*')
  })
}
