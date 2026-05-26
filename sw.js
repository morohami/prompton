// Prompton service worker — offline caching.
// Strategy:
//   - Precache the shell (index, 404, favicon if present)
//   - Network-first for manifest/profiles/tags JSON so updates appear quickly
//   - Cache-first for htmls/* and other static assets
//   - Bypass GitHub API requests entirely (writes must always hit the network)

const VERSION = 'prompton-v8';
const SHELL = [
  './', './index.html', './404.html',
  './manifest.json', './profiles.json', './tags.json', './playlists.json',
  './manifest.webmanifest', './icons/icon.svg', './icons/maskable.svg',
  // Split CSS / JS modules — precache so the shell renders styled even on
  // first paint and so offline visits don't lose layout.
  './css/main.css',
  './js/github.js', './js/render.js', './js/tags.js', './js/router.js', './js/upload.js',
  // i18n locale files — needed for first paint of localized strings.
  './i18n/en.json', './i18n/ja.json'
];

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
  // Cache-first for /htmls/* and /thumbs/* (write-once-ish prompt outputs).
  const isPromptHtml = path.includes('/htmls/');
  const isThumb = path.includes('/thumbs/');
  // Split shell assets (extracted CSS + JS modules). Treat them like the HTML
  // shell — network-first with a cache fallback so a deploy refreshes them
  // immediately but offline still works.
  const isShellAsset = /\.(css|js)$/.test(path);
  if (isJson || (isHtml && !isPromptHtml) || isShellAsset) {
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

  if (isPromptHtml || isThumb) {
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
