// ============================================================================
// SW.JS — service worker. Keeps a copy of the app on the phone so it opens
// instantly and works with no signal — and keeps that copy up to date by
// itself. There is no version number to change by hand.
//
// How an update reaches a phone:
//   1. The app always opens from the copy saved on the phone: instant, and
//      works offline.
//   2. Each time it opens, this quietly checks GitHub for changed files.
//      Unchanged files cost almost nothing to check.
//   3. If anything changed, ALL the app files are downloaded into a fresh
//      copy. Only once every file has arrived does the fresh copy replace the
//      old one, so a dropped connection can never leave a phone with half old,
//      half new files. If anything fails, the old copy stays and it simply
//      tries again next time.
//   4. The next time the app is opened, it's the new version.
// ============================================================================

const CACHE_PREFIX = "just-audio-shell-";
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

// Saved copies are named just-audio-shell-<time saved>. Older builds used
// just-audio-shell-v1 / -v2; those don't match and get cleared out.
function isShellCache(name) {
  return /^just-audio-shell-\d+$/.test(name);
}

function newestShellCacheName(names) {
  return names.filter(isShellCache).sort().pop();
}

// Downloads every app file from GitHub. "no-cache" makes the browser ask
// GitHub whether each file changed rather than trusting its own short-term
// cache. Fails as a whole if any single file fails.
function downloadShell() {
  return Promise.all(SHELL_FILES.map((file) =>
    fetch(new Request(file, { cache: "no-cache" })).then((response) => {
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return response;
    })
  ));
}

// Stores a complete set of downloaded files as a new saved copy.
function saveCopy(responses) {
  const name = CACHE_PREFIX + Date.now();
  return caches.open(name)
    .then((cache) => Promise.all(responses.map((r, i) => cache.put(SHELL_FILES[i], r))))
    .then(() => name);
}

function deleteCachesExcept(keep) {
  return caches.keys().then((names) =>
    Promise.all(names.filter((n) => n !== keep).map((n) => caches.delete(n)))
  );
}

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// True if any freshly downloaded file differs from the saved copy.
function anyFileChanged(cacheName, fresh) {
  if (!cacheName) return Promise.resolve(true);
  return caches.open(cacheName).then((cache) => Promise.all(fresh.map((response, i) =>
    cache.match(SHELL_FILES[i]).then((saved) => {
      if (!saved) return true;
      return Promise.all([saved.arrayBuffer(), response.clone().arrayBuffer()])
        .then(([a, b]) => !sameBytes(a, b));
    })
  ))).then((changes) => changes.some(Boolean));
}

// Step 2–3 above. Only one check runs at a time.
let checking = null;
function checkForUpdate() {
  if (checking) return checking;
  checking = Promise.all([caches.keys().then(newestShellCacheName), downloadShell()])
    .then(([current, fresh]) => anyFileChanged(current, fresh).then((changed) => {
      if (!changed) return;
      return saveCopy(fresh).then(deleteCachesExcept);
    }))
    .catch(() => {}) // no signal, or a file failed: keep the current copy
    .then(() => { checking = null; });
  return checking;
}

// First install (or sw.js itself changed): save a full copy before this
// service worker takes over.
self.addEventListener("install", (event) => {
  event.waitUntil(downloadShell().then(saveCopy));
  self.skipWaiting();
});

// Clear out every saved copy except the newest.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => deleteCachesExcept(newestShellCacheName(names)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only handle same-origin GET requests — never intercept the Apps Script
  // calls or anything cross-origin.
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );

  // The app being opened (or reloaded) is the cue to check for an update.
  if (event.request.mode === "navigate") event.waitUntil(checkForUpdate());
});
