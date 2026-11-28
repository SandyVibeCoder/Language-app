const CACHE = "travel-speak-v26";
// Recorded clips keep their own cache across app updates, so they download once.
const AUDIO_CACHE = "travel-speak-audio";
// The account screen needs the Firebase SDK. Keeping a copy lets a signed-in phone open offline.
const FIREBASE = "https://www.gstatic.com/firebasejs/10.14.1/";
const FIREBASE_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map((name) => FIREBASE + name);

const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/engine.js",
  "./js/courses.js",
  "./js/hear.js",
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

// Saves every recorded clip listed in the manifest that isn't saved yet. Best effort.
async function saveClips() {
  try {
    const res = await fetch("./audio/manifest.json", { cache: "no-cache" });
    if (!res.ok) return;
    const { clips = {} } = await res.json();
    const cache = await caches.open(AUDIO_CACHE);
    const wanted = new Set(Object.values(clips).map((file) => new URL(file, self.registration.scope).href));
    for (const request of await cache.keys()) {
      if (!wanted.has(request.url)) await cache.delete(request);
    }
    const missing = [];
    for (const url of wanted) if (!(await cache.match(url))) missing.push(url);
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.allSettled(missing.slice(i, i + 8).map((url) => cache.add(url)));
    }
  } catch (err) {
    /* Clips still load on demand, and the phone's voice covers the rest. */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(ASSETS).then(() => Promise.allSettled(FIREBASE_FILES.map((url) => cache.add(new Request(url, { mode: "cors" }))))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== AUDIO_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => saveClips()),
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
  if (request.url.startsWith(FIREBASE)) {
    // Versioned SDK files never change, so the saved copy is used first.
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => store(request, response))),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/audio/") && url.pathname.endsWith(".mp3")) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }
  if (url.pathname.endsWith("/audio/manifest.json")) {
    event.respondWith(networkFirst(request));
    return;
  }
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
