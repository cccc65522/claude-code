// Offline support: network first for freshness, cache as the fallback.
// Only this app's own old caches are cleaned up: other apps on the same origin share Cache Storage.
const CACHE = 'yi-xiangqi-v1';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/engine/board.js', 'js/engine/eval.js', 'js/engine/notation.js', 'js/engine/game.js',
  'js/engine/book.js', 'js/engine/search.js', 'js/engine/puzzles.js', 'js/engine/worker.js',
  'js/ui/board-view.js', 'js/ui/engine-client.js', 'js/ui/ui.js', 'js/ui/sound.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('yi-xiangqi-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
