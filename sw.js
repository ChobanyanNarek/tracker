self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== self.location.origin) return
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const data = e.notification.data || {}
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) {
        list[0].postMessage({ type: 'PM_NOTIF_CLICK', taskId: data.taskId, date: data.date })
        return list[0].focus()
      }
      return clients.openWindow(self.registration.scope || '/')
    })
  )
})
