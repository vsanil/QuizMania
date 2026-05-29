// QuizMania Service Worker v1
// Cache strategy: network-first for navigation, cache-first for static assets, skip API calls

const CACHE_NAME = 'quizmania-v2';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json'];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: smart routing
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Always skip non-GET
  if (request.method !== 'GET') return;

  // Always skip API calls — must be live
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (HTML): network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html').then(r => r || new Response(
          '<h1>Offline</h1><p>QuizMania needs a connection to load. Please reconnect and try again.</p>',
          { headers: { 'content-type': 'text/html' } }
        )))
    );
    return;
  }

  // Static assets (fonts, icons, manifest): cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
