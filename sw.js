// ============================================================================
// SW.JS — service worker. Caches the app shell so it opens instantly and
// works with no signal. Strategy: cache-first for everything in the shell.
// ============================================================================

// IMPORTANT: change this version number every time any app file changes
// (including config.js). Phones only pick up new files when this changes.
const CACHE_NAME = "just-audio-shell-v2";
const SHELL_FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" skips the browser's own short-term cache, so a new
    // version always stores fresh copies of the files, never stale ones.
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_FILES.map((f) => new Request(f, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle same-origin GET requests — never intercept the Apps Script
  // calls or anything cross-origin.
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
