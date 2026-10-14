/* Bump this version whenever a new release changes the offline shell. */
const CACHE_NAME = 'wave-shell-v2';
const BASE = new URL('./', self.location.href);
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/main.js', './src/styles.css', './src/audio-engine.js', './src/visualizer.js',
  './assets/wave-background.svg', './assets/cover-drift.svg',
  './assets/cover-nocturne.svg', './assets/cover-orbit.svg',
  './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('wave-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Local user audio uses blob URLs / IndexedDB and never enters this cache.
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname) || request.headers.has('range')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const home = await cache.match(new URL('./index.html', BASE).href);
        if (home) return home;
      }
      return new Response('This file is unavailable offline. Reconnect once to cache the latest app.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
