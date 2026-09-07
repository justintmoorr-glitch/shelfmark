// Shelfmark service worker: app shell precached, CDN libs + fonts cached on first use.
// Book files are NOT handled here; they live in IndexedDB.
const VERSION = 'shelfmark-v2';
const SHELL = ['./', './index.html', './manifest.json'];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* ---------------------------------------------------------------
   Book parts: serve unpacked EPUB entries out of IndexedDB so epub.js
   can open a book as a directory and fetch chapters on demand.
   /_book/<bookId>/<path inside the epub>
   --------------------------------------------------------------- */
const TYPES = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', xml: 'application/xml',
  opf: 'application/oebps-package+xml', ncx: 'application/x-dtbncx+xml',
  css: 'text/css', js: 'text/javascript', json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif',
  otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain',
};
let dbp;
function db() {
  // No version argument: never trigger an upgrade from here, just attach to what the page made.
  dbp = dbp || new Promise((res, rej) => {
    const r = indexedDB.open('shelfmark');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function servePart(pathname) {
  const key = decodeURIComponent(pathname.slice('/_book/'.length));
  try {
    const d = await db();
    if (!d.objectStoreNames.contains('parts')) return new Response('no parts store', { status: 404 });
    const rec = await new Promise((res, rej) => {
      const rq = d.transaction('parts', 'readonly').objectStore('parts').get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    if (!rec) return new Response('not found: ' + key, { status: 404 });
    const ext = (key.split('.').pop() || '').toLowerCase();
    return new Response(rec.blob, { status: 200, headers: {
      'Content-Type': TYPES[ext] || rec.blob.type || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }});
  } catch (err) {
    return new Response('part lookup failed: ' + err, { status: 500 });
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.origin === self.location.origin && url.pathname.startsWith('/_book/')) {
    e.respondWith(servePart(url.pathname));
    return;
  }
  // Never cache API calls or book downloads
  if (url.pathname.startsWith('/api/') || url.hostname.endsWith('gutendex.com') || url.hostname.endsWith('openlibrary.org')) return;

  // App shell: network first, fall back to cache (so deploys show up, but offline still works)
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Libraries and fonts: cache first
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
    })));
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
