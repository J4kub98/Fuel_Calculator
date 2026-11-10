// Service Worker pro Fuel Calculator PWA
// Zajišťuje offline funkčnost a cachování statických assetů.
//
// APP_VERSION je verze aplikace zobrazená uživateli (Nastavení, package.json).
// BUILD zvyš při KAŽDÉM nasazení změněného frontendu — změní se název cache
// i ?v= u souborů, takže prohlížeče stáhnou nové verze. Stejnou hodnotu
// `${APP_VERSION}-${BUILD}` je potřeba přepsat i v index.html a manifest.json.
const APP_VERSION = '2.0.0';
const BUILD = 2;
const ASSET_VERSION = `${APP_VERSION}-${BUILD}`;
const CACHE_NAME = `fuel-tool-${ASSET_VERSION}`;

// Statické assety, které se cachují při instalaci SW
// (stejné URL včetně ?v=, jaké požaduje index.html)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  `/style.css?v=${ASSET_VERSION}`,
  `/script.js?v=${ASSET_VERSION}`,
  `/theme.js?v=${ASSET_VERSION}`,
  `/manifest.json?v=${ASSET_VERSION}`,
  `/icon.svg?v=${ASSET_VERSION}`,
  `/icon-192.png?v=${ASSET_VERSION}`,
  `/icon-512.png?v=${ASSET_VERSION}`,
  `/apple-touch-icon.png?v=${ASSET_VERSION}`,
  '/fonts/inter-latin-wght-normal.woff2',
  '/fonts/inter-latin-ext-wght-normal.woff2',
];

// Instalace SW — předcachujeme všechny statické assety
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Nová verze SW převezme kontrolu ihned bez čekání na reload
  self.skipWaiting();
});

// Aktivace — smaž staré cache verze
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Převezmi kontrolu nad všemi otevřenými taby ihned
  self.clients.claim();
});

function offlineJson() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Zápisy (POST/DELETE) nikdy neobsluhujeme — při výpadku musí selhat,
  // aby aplikace neoznámila úspěch, který se nestal.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network-first, offline fallback z cache, jinak 503
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || offlineJson()))
    );
    return;
  }

  // Navigace (HTML): network-first, aby se nová verze projevila hned
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Jako aplikaci cachujeme jen HTML stránku aplikace
          const type = response.headers.get('content-type') || '';
          const isAppShell = url.pathname === '/' || url.pathname === '/index.html';
          if (response.ok && isAppShell && type.includes('text/html')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Statické assety: cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
    )
  );
});
