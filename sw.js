const CACHE_NAME = "edeetos-v40"; // Bump version to force update

// Only local, guaranteed assets
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/favicon.png"
];

// -------------------------------
// 1. INSTALL
// -------------------------------
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Installing & caching core assets");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// -------------------------------
// 2. ACTIVATE
// -------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("[SW] Removing old cache:", key);
            return caches.delete(key);
          })
      );
    })
  );

  self.clients.claim();
});

// -------------------------------
// 3. FETCH (Network First)
// -------------------------------
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache only same-origin files
        if (event.request.url.startsWith(self.location.origin)) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          // SPA / navigation fallback
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
      })
  );
});
