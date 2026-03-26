self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open('kozlovich-2').then(cache => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});