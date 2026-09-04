const CACHE = "the-backyard-shell-v2";
const CORE = ["/", "/manifest.webmanifest", "/brand/the-backyard-logo.svg", "/brand/the-backyard-logo.png"];

async function cacheShell() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(CORE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
  try {
    const response = await fetch(new Request("/", { cache: "reload" }));
    if (!response.ok) return;
    await cache.put("/", response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((url) => url.startsWith("/_next/static/"));
    await Promise.allSettled([...new Set(assets)].map((url) => cache.add(new Request(url, { cache: "reload" }))));
  } catch { /* The next online navigation completes runtime caching. */ }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("the-backyard-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })));
  }
});
