// Prompton service worker — offline caching.
// Strategy:
//   - Precache the shell (index, 404, favicon if present)
//   - Network-first for manifest/profiles/tags JSON so updates appear quickly
//   - Cache-first for htmls/* and other static assets
//   - Bypass GitHub API requests entirely (writes must always hit the network)

const VERSION = 'prompton-v2';
const SHELL = ['./', './index.html', './404.html', './manifest.json', './profiles.json', './tags.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    try { await cache.addAll(SHELL); } catch (_) { /* offline first load ok */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Don't intercept cross-origin requests (GitHub API, social plugins, etc).
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  const isJson = /\.(json)$/.test(path);
  const isHtml = /\.html?$/.test(path) || path === '/' || path.endsWith('/');

  // Network-first for JSON and for the app shell (index.html and friends).
  // We only fall back to cache when offline — otherwise edits show up immediately.
  // Cache-first only for /htmls/* (write-once prompt outputs).
  const isPromptHtml = path.includes('/htmls/');
  if (isJson || (isHtml && !isPromptHtml)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(VERSION);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }

  if (isPromptHtml) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        fetch(req).then(r => { if (r && r.ok) caches.open(VERSION).then(c => c.put(req, r)); }).catch(() => {});
        return cached;
      }
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
});
