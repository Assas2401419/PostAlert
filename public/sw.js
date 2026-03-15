const CACHE_NAME = 'jeip-next-shell-v1';
const ASSETS = ['/', '/auth', '/report', '/profile', '/trends', '/authority'];

function parseNotificationPayload(data) {
  try {
    return data ? data.json() : {};
  } catch {
    return {
      title: 'JEIP alert',
      body: data?.text ? data.text() : 'A new incident requires attention.'
    };
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          if (!response.ok || event.request.url.includes('/api/')) {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match('/'));
    })
  );
});

self.addEventListener('push', (event) => {
  const payload = parseNotificationPayload(event.data);
  const title = payload.title || 'JEIP incident alert';
  const incidentId = payload.incidentId || payload.incident?.id || '';
  const destination = incidentId ? `/?incident=${incidentId}` : payload.url || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Open the platform to review the latest incident activity.',
      data: {
        url: destination
      },
      tag: payload.tag || incidentId || 'jeip-alert',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).toString();
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.includes(self.location.origin));
      if (existing) {
        existing.navigate(destination);
        return existing.focus();
      }
      return self.clients.openWindow(destination);
    })
  );
});
