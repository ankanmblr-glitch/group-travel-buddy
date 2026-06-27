// Minimal service worker: caches the app shell so the page (and the launcher
// buttons) still load when there's no signal — e.g. on a highway with no
// network for a moment. Firestore handles its own offline queueing for the
// expense data separately.

const CACHE_NAME = "gtb-shell-v2";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./settlement-engine.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first for Firebase/Google calls (always want fresh data when
  // online); cache-first for our own static shell files.
  const url = event.request.url;
  const isOwnFile = SHELL_FILES.some((f) => url.endsWith(f.replace("./", "")));

  if (isOwnFile) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
  // All other requests (Firebase SDK, Firestore, Maps, Drive) pass straight
  // through to the network — we don't want to cache live/dynamic data.
});
