// Offline support: pages are network-first (so a new build is picked up at once),
// everything else (hashed assets, icons) is cache-first.
// Only this app's own old caches are cleaned up: other apps on the same origin share Cache Storage.
const CACHE = 'mendao-v1';
const CORE = ['./', './manifest.webmanifest', './favicon.svg', './icon-192.png'];

// The first visit loads the page before this worker is running, so its script and style
// never pass through the fetch handler below. Cache them at install time, read from the
// built index.html (their file names carry a content hash), so the app works offline
// after one visit. Assets of earlier builds are dropped from the cache at the same time.
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  const html = await (await cache.match('./')).text();
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);
  await cache.addAll(assets);
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !assets.includes(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mendao-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./', { ignoreVary: true }))
    );
    return;
  }
  // ignoreVary: the page asks for its module script with an Origin header (crossorigin), the
  // install step does not, and a server that answers with "Vary: Origin" would make them miss.
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
