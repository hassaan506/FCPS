const CACHE_NAME = "edeetos-v38"; // Changed name to force update
const ASSETS_TO_CACHE = [
  "./",                // The root folder
  "./index.html",      // The main file
  "./style.css",       // Styles
  "./script.js",       // Logic
  "./manifest.json",   // PWA Settings
  "./favicon.png",     // Icon
  // External Library (Must be exact URL)
  "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js"
];

// 1. INSTALL: Cache everything immediately
self.addEventListener("install", (event) => {
  self.skipWaiting(); // Force this new SW to become active instantly
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching all assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. ACTIVATE: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Take control of the page immediately
});

// 3. FETCH: Network-First Strategy
// This tells the browser: "Check the internet first for the newest code."
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If we have internet, update the cache with the fresh file
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If internet is down, use the saved version from cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          
          // If offline and moving between pages, return the cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
