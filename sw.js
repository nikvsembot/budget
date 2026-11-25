// Offline support. App files: network-first (always the newest version when online, cached copy offline).
// Receipt reader files (big, never change): cache-first.
const CACHE = 'budget-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/sync.js', 'js/config.js', 'js/util.js',
  'js/parse.js', 'js/ocr.js', 'js/photos.js', 'js/fx.js', 'vendor/ui.mjs', 'vendor/firebase.mjs', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('budget-') && k !== CACHE && k !== 'budget-ocr').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Firebase, exchange rates: straight to network
  if (url.pathname.includes('/vendor/tesseract/')) {
    e.respondWith(caches.open('budget-ocr').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }))));
    return;
  }
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
