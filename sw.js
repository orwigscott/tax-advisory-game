/* Service worker: keep the app working offline, but always prefer fresh files
 * when online so updates reach players without a manual cache-busting step.
 * (Bump CACHE if you ever need to force-clear everyone's stored copy.) */
const CACHE = "tax-advisory-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./content/entity-selection.json",
  "./content/audio/timings.json",
  "./content/audio/entity-001.mp3",
  "./content/audio/entity-002.mp3",
  "./content/audio/entity-003.mp3",
  "./content/audio/entity-004.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: try the live file, update the cache, and fall back to the
// cached copy only when offline. This means edits show up on next reload.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
