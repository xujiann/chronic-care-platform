const CACHE_NAME = "chronic-care-citizen-v27";
const APP_SHELL = [
  "./",
  "./citizen.html",
  "./citizen.css",
  "./citizen.css?v=20260630lifecycle",
  "./citizen.js",
  "./citizen.js?v=20260627",
  "./citizen.js?v=20260627nav",
  "./citizen.js?v=20260627preview",
  "./citizen.js?v=20260627pages",
  "./citizen.js?v=20260627pages2",
  "./citizen.js?v=20260627actions",
  "./citizen.js?v=20260627channels",
  "./citizen.js?v=20260628launch",
  "./citizen.js?v=20260628tasks",
  "./citizen.js?v=20260629registration",
  "./citizen.js?v=20260629multinav",
  "./citizen.js?v=20260629care",
  "./citizen.js?v=20260630layout",
  "./citizen.js?v=20260630visible",
  "./citizen.js?v=20260630touch",
  "./citizen.js?v=20260630sync",
  "./citizen.js?v=20260630lifecycle",
  "./citizen.js?v=20260630escortlink",
  "./citizen.js?v=20260701actions",
  "./citizen.js?v=20260701provider",
  "./auth.js",
  "./auth.js?v=20260627",
  "./health-archive-standard.js",
  "./mobile-preview.html",
  "./mobile-preview.css",
  "./internet-nursing.html",
  "./internet-nursing.js?v=20260629prod",
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
      fetch(event.request, { cache: "no-store" }).catch(() => caches.match("./citizen.html"))
    );
    return;
  }

  if (/\.(?:html|js|css)$/.test(requestUrl.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
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
