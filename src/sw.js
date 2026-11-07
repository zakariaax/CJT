/* Public install assets only. Never cache authenticated pages, job JSON, preferences, or files. */
const PUBLIC_CACHE = "cjt-public-v1";
const PUBLIC_PATHS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];
const NEVER_CACHE_PREFIXES = ["/api/", "/file/", "/logout"];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.indexOf(pathname) !== -1;
}

function isNeverCache(pathname) {
  for (let i = 0; i < NEVER_CACHE_PREFIXES.length; i++) {
    if (pathname === NEVER_CACHE_PREFIXES[i] || pathname.startsWith(NEVER_CACHE_PREFIXES[i])) return true;
  }
  return pathname === "/" || pathname === "/index.html";
}

async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

function offlineFallback() {
  return new Response("You are offline. Job applications, preferences, and documents are not stored on this device.", {
    status: 503,
    headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}
  });
}

async function networkOnly(request) {
  return fetch(request);
}

async function handleFetch(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return fetch(request);
  if (url.pathname === "/logout") {
    await clearAllCaches();
    return fetch(request);
  }
  if (isNeverCache(url.pathname) || (request.method !== "GET" && request.method !== "HEAD")) {
    if (request.mode === "navigate") {
      try {
        return await fetch(request);
      } catch (err) {
        const cache = await caches.open(PUBLIC_CACHE);
        const offline = await cache.match("/offline.html");
        return offline || offlineFallback();
      }
    }
    return networkOnly(request);
  }
  if (!isPublicPath(url.pathname)) return networkOnly(request);
  const cache = await caches.open(PUBLIC_CACHE);
  const cached = await cache.match(url.pathname);
  if (cached) return cached;
  const response = await fetch(request);
  const cacheControl = response.headers.get("Cache-Control") || "";
  if (response.ok && !/no-store|private/i.test(cacheControl)) {
    await cache.put(url.pathname, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.addAll(PUBLIC_PATHS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== PUBLIC_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handleFetch(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "LOGOUT_CLEAR") event.waitUntil(clearAllCaches());
});

self.handleFetch = handleFetch;
