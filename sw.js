const CACHE_NAME = "edeetos-v2"; // ✅ Reset to v1 (and stay there!)

// Core assets to pre-cache immediately
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/favicon.png"
];

// 1. INSTALL: Cache the basics immediately
self.addEventListener("install", (event) => {
  self.skipWaiting(); // Force this SW to become active immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Installing v1 & caching assets");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. ACTIVATE: Clean up the old v74 cache
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key); // Deletes 'edeetos-v74'
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of the page immediately
});

// 3. FETCH: Network First (The Auto-Update Magic)
self.addEventListener("fetch", (event) => {
  // Only handle GET requests (pages, images, scripts)
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If we got a valid response from the internet...
        if (networkResponse && networkResponse.status === 200) {
          // ...Clone it and update the cache AUTOMATICALLY
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        // Return the fresh internet content
        return networkResponse;
      })
      .catch(() => {
        // If offline (or network fails), try the cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          
          // Optional: If request was for a page, return index.html
          if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
          }
        });
      })
  );
});
