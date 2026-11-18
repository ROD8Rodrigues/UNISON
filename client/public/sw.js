/* UNISON service worker — offline app shell and safe static caching. */
const VERSION = 'v2';
const SHELL_CACHE = `unison-shell-${VERSION}`;
const ASSET_CACHE = `unison-assets-${VERSION}`;
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon-32.png',
  '/logo-mark.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    const cached = (await cache.match('/')) || (await cache.match('/index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>UNISON</title><body style="background:#0a080d;color:#f3eef7;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><main style="text-align:center"><h1>Sem conexão</h1><p>Abra o UNISON novamente quando estiver online.</p></main></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/uploads')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') {
    return;
  }

  if (url.pathname.startsWith('/assets/') || /\.(?:css|js|png|svg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
