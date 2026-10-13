/* Service worker do Garimpo de Vinil (PWA).
 *
 * Só acelera/segura o que é estático — NUNCA cacheia dados: HTML (SSR autenticado), server
 * functions (/_serverFn), /api/* (cron, auth, pregão ao vivo, health) passam direto pela rede,
 * para não mostrar lance/preço velho. O que fica em cache:
 *  - /assets/* (JS/CSS com hash no nome, imutável) → cache-first;
 *  - /icons/*, /manifest → stale-while-revalidate;
 *  - /collection/* (fotos da Coleção) → stale-while-revalidate, limitado;
 *  - navegação sem rede → /offline.html.
 * Também recebe Web Push (avisos do "De olho" e lance superado) e mantém o selo do ícone: cada
 * push soma 1; o app aberto grava o número real (`useAppBadge`) e zera ao olhar.
 * Mude VERSION para forçar a troca de todos os caches.
 */
const VERSION = "v2";
const STATIC = `garimpo-static-${VERSION}`;
const PHOTOS = `garimpo-photos-${VERSION}`;
// Contador do selo do ícone — sobrevive à troca de VERSION (não é cache de conteúdo).
const META = "garimpo-meta";
const BADGE_KEY = "/__badge";
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
            .filter((k) => k.startsWith("garimpo-") && k !== STATIC && k !== PHOTOS && k !== META)
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

// ---------------------------------------------------------------------------------------------
// Web Push + selo do ícone
// ---------------------------------------------------------------------------------------------
async function readBadge() {
  const hit = await (await caches.open(META)).match(BADGE_KEY);
  return hit ? parseInt(await hit.text(), 10) || 0 : 0;
}

async function bumpBadge() {
  const n = (await readBadge()) + 1;
  await (await caches.open(META)).put(BADGE_KEY, new Response(String(n)));
  if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Garimpo de Vinil", {
        body: data.body || "",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: data.url || "/" },
      }),
      bumpBadge().catch(() => {}),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    }),
  );
});
