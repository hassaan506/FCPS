const CACHE_NAME = "edeetos-v7.1"; // Changed name to force update
const ASSETS_TO_CACHE = [
  "./",                // The root folder
  "./index.html",      // The main file
  "./style.css",       // Styles
  "./script.js",       // Logic
  "./manifest.json",   // PWA Settings
  "./favicon.png",     // Icon
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

// 3. FETCH: Network-First Strategy (Recommended for active development)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    // 1. Try the network first
    fetch(event.request)
      .then((networkResponse) => {
        // 2. If successful, update the cache with this new version
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // 3. If network fails (Offline), check the cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          
          // 4. If offline and navigating to a page, show index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
