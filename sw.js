const CACHE = 'embusteros-v2';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Solo el shell de la app (navegación + index.html/manifest.json) va por red primero,
// con el cache como respaldo offline. Todo lo demás (Supabase, CDN) pasa de largo,
// sin tocar el cache, igual que antes.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isShell = url.origin === location.origin &&
    (e.request.mode === 'navigate' || ASSETS.some(a => url.pathname.endsWith(a.slice(1))));
  if (!isShell) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
