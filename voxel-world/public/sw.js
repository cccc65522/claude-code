// Offline support for 方块小镇. Pages are network-first (a new build shows up at once);
// the hashed script and stylesheet are cache-first.
// Other apps share this origin's Cache Storage, so only caches named 'voxel-world-*' are touched.
const CACHE = 'voxel-world-v1';
const CORE = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './apple-touch-icon.png'];

// The first visit loads the page before this worker runs, so its assets never pass through
// the fetch handler. Cache the ones named in the built index.html at install time, so the
// game works offline after one visit, and drop assets of earlier builds.
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('voxel-world-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
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
        .catch(() => caches.match('./', { ignoreVary: true })),
    );
    return;
  }
  // ignoreVary: the module script is requested with an Origin header (crossorigin) and the
  // install step's request is not; a server answering "Vary: Origin" would make them miss.
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
        }),
    ),
  );
});
