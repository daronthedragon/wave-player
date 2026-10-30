import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

test('first offline shell install includes MP3 controls without eagerly downloading the converter', async () => {
  const listeners = {}; let requested = [], installation;
  vm.runInNewContext(source, {
    URL, Request, Response,
    self: { location: { href: 'https://daronthedragon.github.io/wave-player/sw.js' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    caches: { open: async () => ({ addAll: async requests => { requested = requests.map(request => request.url); } }) }
  });
  listeners.install({ waitUntil: promise => { installation = promise; } });
  await installation;
  assert.ok(requested.some(url => url.includes('/src/media-saver.js')));
  assert.ok(requested.every(url => !url.includes('/vendor/ffmpeg/')));
});

test('service worker leaves temporary native audio entirely outside its cache', () => {
  const listeners = {};
  vm.runInNewContext(source, {
    URL, Request, Response,
    self: { location: { href: 'https://daronthedragon.github.io/wave-player/sw.js' }, addEventListener: (name, fn) => { listeners[name] = fn; } }
  });
  let intercepted = false;
  listeners.fetch({ request: new Request('https://daronthedragon.github.io/wave-player/__native_audio/123abc'), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('service worker respects no-store while still caching ordinary shell assets', async () => {
  const listeners = {};
  let stored = 0;
  let noStore = true;
  vm.runInNewContext(source, {
    URL, Request, Response,
    self: { location: { href: 'https://daronthedragon.github.io/wave-player/sw.js' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    caches: { open: async () => ({ put: async () => { stored++; } }) },
    fetch: async () => ({ ok: true, type: 'basic', headers: new Headers(noStore ? { 'cache-control': 'no-store' } : {}), clone: () => new Response('asset') })
  });
  const request = new Request('https://daronthedragon.github.io/wave-player/src/main.js');
  let response;
  listeners.fetch({ request, respondWith: value => { response = value; } });
  await response;
  assert.equal(stored, 0);
  noStore = false;
  listeners.fetch({ request, respondWith: value => { response = value; } });
  await response;
  assert.equal(stored, 1);
});
