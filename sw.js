self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== self.location.origin) return
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })))
})
