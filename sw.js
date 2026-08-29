// Offline shell. Everything the app needs is precached, so it runs with the
// phone in airplane mode. User data never touches this cache — that lives in
// IndexedDB.

const VERSION = 'v1.0.1';
const CACHE = `werks-invoice-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/repo.js',
  './js/challan.js',
  './js/audit.js',
  './js/pdf.js',
  './js/backup.js',
  './js/charts.js',
  './js/ac.js',
  './js/theme.js',
  './js/views/list.js',
  './js/views/editor.js',
  './js/views/detail.js',
  './js/views/analytics.js',
  './js/views/history.js',
  './js/views/settings.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jszip.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; add individually so one 404 can't fail the install.
      .then((cache) => Promise.all(
        PRECACHE.map((url) => cache.add(url).catch((err) => console.warn('[sw] skip', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell so a deep link works offline too.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
