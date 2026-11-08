// Offline support: network first for freshness, cache as the fallback.
const CACHE = 'gesuan-v1';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/engine/address.js', 'js/engine/lexer.js', 'js/engine/parser.js', 'js/engine/values.js',
  'js/engine/range.js', 'js/engine/evaluator.js', 'js/engine/functions.js', 'js/engine/dates.js',
  'js/engine/format.js', 'js/engine/input.js', 'js/engine/rewrite.js', 'js/engine/workbook.js', 'js/engine/history.js',
  'js/io/csv.js', 'js/io/zip.js', 'js/io/xml.js', 'js/io/xlsx.js',
  'js/ui/assist.js', 'js/ui/controller.js', 'js/ui/editor.js', 'js/ui/grid.js', 'js/ui/panels.js',
  'js/ui/sample.js', 'js/ui/storage.js', 'js/ui/widgets.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
