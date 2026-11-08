// Offline support: network first for freshness, cache as the fallback.
// Only this app's own old caches are cleaned up: other apps on the same origin share Cache Storage.
const CACHE = 'zaowu-physics-v1';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/apple-touch-icon.png',
  'js/app.js',
  'js/engine/math.js', 'js/engine/shapes.js', 'js/engine/tree.js', 'js/engine/collide.js', 'js/engine/joints.js',
  'js/engine/world.js', 'js/engine/geometry.js', 'js/engine/materials.js', 'js/engine/scene.js', 'js/engine/build.js',
  'js/engine/demos.js', 'js/engine/levels.js', 'js/engine/level-run.js', 'js/engine/recorder.js',
  'js/ui/camera.js', 'js/ui/renderer.js', 'js/ui/input.js', 'js/ui/tools.js', 'js/ui/sound.js', 'js/ui/share.js',
  'js/ui/storage.js', 'js/ui/icons.js', 'js/ui/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('zaowu-physics-') && k !== CACHE).map(k => caches.delete(k))))
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
