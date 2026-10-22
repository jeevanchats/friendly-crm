const CACHE_NAME = 'friendly-crm-v2';

// Pre-cached essential static assets for app shell
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Static asset extension allowlist
const STATIC_ASSET_EXTENSIONS = [
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
];

function isStaticAsset(url) {
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname.startsWith('/icons/')) return true;
  return STATIC_ASSET_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

function isExcludedFromCache(url) {
  // Explicitly exclude all authenticated APIs and dynamic business data
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/q/')) return true;
  if (url.pathname.startsWith('/documents/')) return true;
  return false;
}

// Install Event: Cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => {
        console.warn('[SW] Pre-caching encountered an error:', err);
      })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Correct standard service worker API: self.clients.claim()
  if (self.clients && typeof self.clients.claim === 'function') {
    event.waitUntil(self.clients.claim());
  }
});

// Message Event: Allow client to trigger skipWaiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Fetch Event: Safe static caching, never cache authenticated APIs or return HTML for API errors
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  // 1. Authenticated APIs: Network-only, NEVER cache, NEVER return homepage HTML on failure
  if (isExcludedFromCache(requestUrl)) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            statusCode: 503,
            error: 'ServiceUnavailable',
            message: 'You are offline or the network is unavailable. Dynamic CRM data cannot be loaded offline.',
            offline: true,
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
          }
        );
      })
    );
    return;
  }

  // 2. Static Assets Allowlist: Cache-first / Network-fallback with caching
  if (isSameOrigin && isStaticAsset(requestUrl)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Navigation requests (HTML pages): Network-first with cached shell fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const rootFallback = await caches.match('/');
          if (rootFallback) return rootFallback;
          return new Response('Offline - Please reconnect to access Friendly CRM', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Default: Direct network fetch
  event.respondWith(fetch(event.request));
});
