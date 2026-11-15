const CACHE = "travel-speak-v7";

const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/engine.js",
  "./js/courses.js",
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match("./index.html"));
      return cached || fetched;
    }),
  );
});
