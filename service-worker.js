const CACHE_NAME = "chronic-care-citizen-v8";
const APP_SHELL = [
  "./",
  "./citizen.html",
  "./citizen.css",
  "./citizen.js",
  "./citizen.js?v=20260627",
  "./citizen.js?v=20260627nav",
  "./citizen.js?v=20260627preview",
  "./citizen.js?v=20260627pages",
  "./auth.js",
  "./auth.js?v=20260627",
  "./health-archive-standard.js",
  "./mobile-preview.html",
  "./mobile-preview.css",
  "./manifest.webmanifest",
  "./pwa-icon.svg",
  "./data/db.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./citizen.html"))
    );
    return;
  }

  if (/\.(?:html|js|css)$/.test(requestUrl.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
