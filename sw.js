const CACHE = "im-titi-v5";
const SHELL = [
  "./",
  "./index.html",
  "./js/app.js",
  "./js/sync-engine.js",
  "./js/analysis.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./bg.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Only cache good responses — a 503 or captive-portal page cached once
// would otherwise be served forever by the offline fallback.
function cacheIfOk(request, res) {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy).catch(() => {}));
  }
  return res;
}

// Same-origin: network-first so redeploys reach users, cache fallback so
// the app still opens with zero signal at the crag.
// MediaPipe CDN + model: cache-first — versioned, immutable assets.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const cdn =
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "storage.googleapis.com";
  if (!sameOrigin && !cdn) return;
  if (sameOrigin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => cacheIfOk(e.request, res))
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
  } else {
    e.respondWith(
      caches
        .match(e.request)
        .then(
          (hit) =>
            hit || fetch(e.request).then((res) => cacheIfOk(e.request, res)),
        ),
    );
  }
});
