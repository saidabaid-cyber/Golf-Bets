// Bump this version whenever the deploy changes the app shell.
const CACHE = "the-backyard-shell-v6";
const OPTIONAL_SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-192.png", "/icons/maskable-512.png", "/apple-icon.png"];

function shellRequest(path) {
  return new Request(new URL(path, self.location.origin), { cache: "reload", credentials: "omit", redirect: "error" });
}

async function requiredResponse(request) {
  const response = await fetch(request);
  if (!response.ok) throw new Error("required shell response unavailable");
  return response;
}

async function cacheShell() {
  const rootRequest = shellRequest("/");
  const offlineRequest = shellRequest("/offline.html");
  const rootResponse = await requiredResponse(rootRequest);
  const offlineResponse = await requiredResponse(offlineRequest);
  const html = await rootResponse.clone().text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith("/_next/static/")))];
  if (!assets.length) throw new Error("required shell assets unavailable");
  const requiredAssets = await Promise.all(assets.map(async (path) => {
    const request = shellRequest(path);
    return [request, await requiredResponse(request)];
  }));
  const cache = await caches.open(CACHE);
  const requiredWrites = await Promise.allSettled([
    cache.put(rootRequest, rootResponse),
    cache.put(offlineRequest, offlineResponse),
    ...requiredAssets.map(([request, response]) => cache.put(request, response)),
  ]);
  const failedWrite = requiredWrites.find((result) => result.status === "rejected");
  if (failedWrite) {
    await caches.delete(CACHE);
    throw failedWrite.reason;
  }
  await Promise.allSettled(OPTIONAL_SHELL.map(async (path) => {
    const request = shellRequest(path);
    const response = await requiredResponse(request);
    await cache.put(request, response);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
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
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      const fallback = url.pathname === "/" ? shellRequest("/") : shellRequest("/offline.html");
      return (await cache.match(fallback)) || Response.error();
    }));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(request)) || fetch(request).then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })));
    return;
  }
  if (url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/") || url.pathname === "/apple-icon.png" || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.open(CACHE).then(async (cache) => fetch(request).then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(async () => (await cache.match(request)) || Response.error())));
  }
});
