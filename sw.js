/* The Complexion — service worker
   Strategy:
     - HTML / navigations : network-first, fall back to cache (so edits show up immediately)
     - Same-origin assets : cache-first, refreshed in the background
     - Google Fonts       : cache-first in a separate runtime cache
   Bump VERSION whenever you change the precache list. */

const VERSION = 'v2';
const PREFIX = 'complexion';
const SHELL_CACHE = PREFIX + '-shell-' + VERSION;
const RUNTIME_CACHE = PREFIX + '-runtime-' + VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* ---------- install ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => Promise.all(
        SHELL_ASSETS.map(url =>
          cache.add(new Request(url, { cache: 'reload' }))
            .catch(() => console.warn('[sw] skipped precache:', url))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

/* ---------- activate ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.map(name => {
          const isOurs = name.indexOf(PREFIX + '-') === 0;
          const isCurrent = name === SHELL_CACHE || name === RUNTIME_CACHE;
          if (isOurs && !isCurrent) return caches.delete(name);
          return Promise.resolve(false);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const wantsHTML =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (wantsHTML && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

/* ---------- strategies ---------- */

function networkFirst(request) {
  return fetch(request)
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() =>
      caches.match(request).then(cached =>
        cached ||
        caches.match('./index.html').then(shell =>
          shell ||
          new Response(
            '<!doctype html><meta charset="utf-8">' +
            '<title>Offline</title>' +
            '<body style="background:#150C03;color:#F5EDD8;font-family:sans-serif;' +
            'display:flex;align-items:center;justify-content:center;height:100vh;' +
            'margin:0;text-align:center;padding:2rem;">' +
            '<p>Offline — and this page isn\'t cached yet.<br>' +
            'Reconnect once and it\'ll be available from then on.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        )
      )
    );
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(cached => {
    if (cached) {
      fetch(request)
        .then(response => {
          if (response && (response.ok || response.type === 'opaque')) {
            caches.open(cacheName).then(cache => cache.put(request, response));
          }
        })
        .catch(() => {});
      return cached;
    }

    return fetch(request)
      .then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(cacheName).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => cached);
  });
}

/* ---------- manual update hook ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
