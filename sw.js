const CACHE = "travel-speak-v20";

const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/engine.js",
  "./js/courses.js",
  "./js/account.js",
  "./js/firebase-config.js",
  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable.png",
  "./images/reward-taiwan-beach.webp",
  "./images/reward-lantern-beach.webp",
  "./images/reward-sailboat.webp",
  "./images/reward-tw-01.webp",
  "./images/reward-tw-02.webp",
  "./images/reward-tw-03.webp",
  "./images/reward-tw-04.webp",
  "./images/reward-tw-05.webp",
  "./images/reward-tw-06.webp",
  "./images/reward-tw-07.webp",
  "./images/reward-tw-08.webp",
  "./images/reward-tw-09.webp",
  "./images/reward-japan-cherry.webp",
  "./images/reward-japan-surf.webp",
  "./images/reward-hot-spring.webp",
  "./images/reward-jp-01.webp",
  "./images/reward-jp-02.webp",
  "./images/reward-jp-03.webp",
  "./images/reward-jp-04.webp",
  "./images/reward-jp-05.webp",
  "./images/reward-jp-06.webp",
  "./images/reward-jp-07.webp",
  "./images/reward-jp-08.webp",
  "./images/reward-jp-09.webp",
  "./images/reward-es-01.webp",
  "./images/reward-es-02.webp",
  "./images/reward-es-03.webp",
  "./images/reward-es-04.webp",
  "./images/reward-es-05.webp",
  "./images/reward-es-06.webp",
  "./images/reward-es-07.webp",
  "./images/reward-es-08.webp",
  "./images/reward-de-01.webp",
  "./images/reward-de-02.webp",
  "./images/reward-de-03.webp",
  "./images/reward-de-04.webp",
  "./images/reward-de-05.webp",
  "./images/reward-de-06.webp",
  "./images/reward-de-07.webp",
  "./images/reward-de-08.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isShell(url, request) {
  if (request.mode === "navigate") return true;
  return url.pathname.endsWith("/index.html") || /\/js\/[^/]+\.js$/.test(url.pathname);
}

function store(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
  return response;
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => store(request, response))
    .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isShell(url, request)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => store(request, response))
        .catch(() => cached || caches.match("./index.html"));
      return cached || fetched;
    }),
  );
});
