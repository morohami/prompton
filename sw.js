// Prompton service worker — offline caching.
// Strategy:
//   - Precache the shell (index, 404, favicon if present)
//   - Network-first for the shell, JSON, and prompton files (htmls/*): updates
//     must show up on the very next visit/download, the cache is only the
//     offline fallback. (htmls/* used to be cache-first, which served the OLD
//     file once after every edit.)
//   - Cache-first for thumbnails; each new `?v=` URL replaces older entries of
//     the same file instead of piling up
//   - Bypass GitHub API requests entirely (writes must always hit the network)

const VERSION = 'prompton-v9';
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

// Store a thumbnail response, dropping older cache entries for the same file
// (thumbs/<id>.jpg?v=<old>) so versions don't accumulate until the next
// VERSION bump.
async function putThumb(req, res) {
  const cache = await caches.open(VERSION);
  const url = new URL(req.url);
  const keys = await cache.keys();
  await Promise.all(keys.filter(k => {
    const u = new URL(k.url);
    return u.pathname === url.pathname && u.search !== url.search;
  }).map(k => cache.delete(k)));
  await cache.put(req, res);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Don't intercept cross-origin requests (GitHub API, social plugins, etc).
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  const isJson = /\.(json)$/.test(path);
  const isHtml = /\.html?$/.test(path) || path === '/' || path.endsWith('/');
  const isPromptFile = path.includes('/htmls/');
  const isThumb = path.includes('/thumbs/');
  // Split shell assets (extracted CSS + JS modules).
  const isShellAsset = /\.(css|js)$/.test(path);

  // Network-first (cache = offline fallback): shell, JSON, shell assets, and
  // prompton files themselves.
  if (isJson || isHtml || isPromptFile || isShellAsset) {
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

  if (isThumb) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) putThumb(req, fresh.clone());
      return fresh;
    })());
  }
});
