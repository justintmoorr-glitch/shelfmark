/* Shelfmark service worker.
   Caches the app shell so the app opens offline. Books live in IndexedDB and are
   never touched here. Failed responses are never cached — a stored 404 would
   outlive the problem that caused it. */
const VERSION = 'shelfmark-v5';
const SHELL = ['./', './index.html', './manifest.json'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => c.add(u)));   // one bad URL must not fail the install
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;                       // never cache API calls
  if (url.hostname.endsWith('gutendex.com') || url.hostname.endsWith('openlibrary.org')) return;

  if (url.origin === self.location.origin) {
    // App shell: network first so deploys land, cache as the offline fallback.
    e.respondWith((async () => {
      try {
        const r = await fetch(e.request);
        if (r.ok) { const c = await caches.open(VERSION); c.put(e.request, r.clone()); }
        return r;
      } catch {
        return (await caches.match(e.request)) || (await caches.match('./index.html')) ||
          new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  if (FONT_HOSTS.includes(url.hostname) || LIB_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok || r.type === 'opaque') { const c = await caches.open(VERSION); c.put(e.request, r.clone()); }
      return r;
    })());
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' })
    .then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
