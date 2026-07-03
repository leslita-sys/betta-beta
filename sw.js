const CACHE = "im-titi-v2";
const SHELL = [
  "./",
  "./index.html",
  "./js/app.js",
  "./js/sync-engine.js",
  "./manifest.webmanifest",
  "./icon.svg",
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

// Cache-first for our shell plus the MediaPipe CDN and model hosts, so the
// app (and the pose model, once fetched) works with zero signal at the crag.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const cacheable =
    url.origin === location.origin ||
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "storage.googleapis.com";
  if (!cacheable) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
    ),
  );
});
