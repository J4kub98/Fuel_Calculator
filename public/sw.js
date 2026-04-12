// Service Worker pro Fuel Calculator PWA
// Zajišťuje offline funkčnost a cachování statických assetů.

const CACHE_NAME = 'fuel-tool-v1';

// Statické assety, které se cachují při instalaci SW
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
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

// Fetch — cache-first pro statiku, network-first pro API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API volání: network-first, při výpadku vrátíme JSON s chybou
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Úspěšnou GET odpověď si uložíme do cache pro případ offline
          if (request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          // Zkus cache, jinak vrať offline odpověď
          caches.match(request).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: 'offline', trips: [] }), {
                headers: { 'Content-Type': 'application/json' },
              })
          )
        )
    );
    return;
  }

  // Statické assety: cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) => cached || fetch(request).then((response) => {
        // Ulož do cache pro příště
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
    )
  );
});
