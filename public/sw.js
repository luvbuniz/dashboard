// Minimal service worker: network-first with cache fallback, so the
// dashboard opens instantly from the home screen and still works offline
// (data is in localStorage anyway — this just keeps the shell available).
const CACHE = "amys-cc-v4";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // only same-origin GETs — never touch webhook/Telegram/GitHub traffic
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Revalidate page loads instead of trusting the HTTP cache (Pages sends
  // max-age=600) — a refresh should always pick up a fresh deploy.
  const req =
    e.request.mode === "navigate"
      ? new Request(e.request, { cache: "no-cache" })
      : e.request;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(
          (hit) =>
            hit ||
            (e.request.mode === "navigate"
              ? caches.match("./index.html")
              : Response.error())
        )
      )
  );
});
