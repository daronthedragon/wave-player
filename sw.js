/* Bump this version whenever a new release changes the offline shell. */
const CACHE_NAME = 'wave-shell-v6';
const BASE = new URL('./', self.location.href);
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/main.js?v=1.2.0', './src/online-library.js?v=1.2.0', './src/online-links.js?v=1.2.0', './src/styles.css?v=1.2.0', './src/audio-engine.js?v=1.2.0', './src/visualizer.js?v=1.2.0', './src/ps3-wave.js?v=1.2.0',
  './src/transcoder.js?v=1.2.0', './src/transcoder-worker.js?v=1.2.0',
  './vendor/ffmpeg/ffmpeg-core.js', './vendor/ffmpeg/ffmpeg-core.wasm',
  './assets/wave-background.svg', './assets/cover-drift.svg',
  './assets/cover-nocturne.svg', './assets/cover-orbit.svg',
  './assets/ps3/xmb_icon_001.png', './assets/ps3/xmb_icon_003.png', './assets/ps3/xmb_icon_004.png', './assets/ps3/xmb_icon_037.png', './assets/ps3/xmb_icon_008.png', './assets/ps3/icon_fw_track.png', './assets/ps3/icon_fw_folder.png',
  './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
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
      const response = await fetch(request, { cache: 'no-cache' });
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
