/* Service Worker: macht die App nach dem ersten Laden offlinefähig.
 * Strategie: Netzwerk zuerst (immer aktueller, konsistenter Stand), bei fehlender
 * Verbindung aus dem Cache. Beim Erhöhen von VERSION wird der alte Cache entfernt. */

const VERSION = 'v1';
const CACHE = `lernkarten-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icon.svg',
  'css/base.css',
  'css/components.css',
  'css/views.css',
  'js/app.js',
  'js/backup.js',
  'js/db.js',
  'js/session.js',
  'js/srs.js',
  'js/store.js',
  'js/theme.js',
  'js/ui.js',
  'js/utils.js',
  'js/components/cardEditor.js',
  'js/components/categoryPicker.js',
  'js/components/richEditor.js',
  'js/views/cards.js',
  'js/views/categories.js',
  'js/views/dashboard.js',
  'js/views/review.js',
  'js/views/session.js',
  'js/views/settings.js',
  'js/views/study.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lernkarten-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const index = await caches.match('index.html');
          if (index) return index;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }),
  );
});
