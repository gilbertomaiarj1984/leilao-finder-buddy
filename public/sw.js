/* Service worker do Garimpo de Vinil (PWA).
 *
 * Só acelera/segura o que é estático — NUNCA cacheia dados: HTML (SSR autenticado), server
 * functions (/_serverFn), /api/* (cron, auth, pregão ao vivo, health) passam direto pela rede,
 * para não mostrar lance/preço velho. O que fica em cache:
 *  - /assets/* (JS/CSS com hash no nome, imutável) → cache-first;
 *  - /icons/*, /manifest → stale-while-revalidate;
 *  - /collection/* (fotos da Coleção) → stale-while-revalidate, limitado;
 *  - navegação sem rede → /offline.html.
 * Mude VERSION para forçar a troca de todos os caches.
 */
const VERSION = "v1";
const STATIC = `garimpo-static-${VERSION}`;
const PHOTOS = `garimpo-photos-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const MAX_PHOTOS = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("garimpo-") && k !== STATIC && k !== PHOTOS)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) {
        cache.put(request, res.clone()).then(() => max && trim(cacheName, max));
      }
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
    return;
  }

  if (path.startsWith("/assets/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (path.startsWith("/icons/") || path === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(request, STATIC));
    return;
  }

  if (path.startsWith("/collection/")) {
    event.respondWith(staleWhileRevalidate(request, PHOTOS, MAX_PHOTOS));
  }
  // Qualquer outra coisa (server functions, /api/*, HTML): sem respondWith → rede normal.
});
