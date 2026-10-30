import test from 'node:test';
import assert from 'node:assert/strict';
import { audioServerURL, fetchAudioFile, hasNativeAudio, nativeAudioSupports, fetchNativeAudioFile } from '../src/direct-audio.js';

test('server addresses require HTTPS except loopback from local test pages', () => {
  assert.equal(audioServerURL('https://audio.example.com/', 'https:'), 'https://audio.example.com');
  assert.equal(audioServerURL('http://127.0.0.1:4181', 'http:'), 'http://127.0.0.1:4181');
  for (const value of ['http://audio.example.com', 'http://127.0.0.1:4181', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=a', 'file:///test', 'javascript:alert(1)']) assert.throws(() => audioServerURL(value, 'https:'));
});

test('direct audio becomes a local file with deterministic identity', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? Response.json({ audioUrl: '/audio/test-token', title: 'Title', artist: 'Artist', fileName: 'track.m4a' }) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mp4' } });
  });
  const file = await fetchAudioFile({ url: 'https://soundcloud.com/artist/title' }, 'https://audio.example.com', new AbortController().signal);
  assert.equal(file.name, 'Artist - Title.m4a');
  assert.equal(file.type, 'audio/mp4');
  assert.equal(file.size, 3);
  assert.equal(file.lastModified, 0);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].url, 'https://audio.example.com/audio/test-token');
});

test('resolver cannot redirect audio downloads to other hosts or arbitrary paths', async t => {
  for (const audioUrl of ['https://evil.example/audio/token', '/admin', '/audio/token?secret=x', 'https://user:pass@audio.example.com/audio/token']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ audioUrl }));
    await assert.rejects(fetchAudioFile({ url: 'https://soundcloud.com/a/b' }, 'https://audio.example.com'), /invalid audio address/);
    t.mock.restoreAll();
  }
});

test('errors and oversized responses never become library files', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Track is unavailable' }, { status: 422 }));
  await assert.rejects(fetchAudioFile({}, 'https://audio.example.com'), /Track is unavailable/);
  t.mock.restoreAll();
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => ++count === 1 ? Response.json({ audioUrl: '/audio/id' }) : new Response('x', { headers: { 'Content-Length': String(65 * 1024 * 1024) } }));
  await assert.rejects(fetchAudioFile({}, 'https://audio.example.com'), /64 MB/);
});

function nativeBridge(t, respond) {
  const messages = [];
  const bridge = { onmessage: null, postMessage(json) {
    const message = JSON.parse(json);
    messages.push(message);
    if (message.action === 'import') queueMicrotask(() => respond(message, bridge));
  } };
  globalThis.WaveNativeAudio = bridge;
  t.after(() => { delete globalThis.WaveNativeAudio; });
  return { bridge, messages };
}

test('iOS native importer returns retained audio without fetching a remote browser URL', async t => {
  const source = new File([new Uint8Array([1, 2, 3])], 'Track.m4a', { type: 'audio/mp4', lastModified: 0 });
  const signal = new AbortController().signal;
  globalThis.WaveIOSImportAudio = async (url, options) => {
    assert.equal(url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    assert.equal(options.signal, signal);
    return source;
  };
  t.after(() => { delete globalThis.WaveIOSImportAudio; });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must use native importer'); });
  assert.equal(hasNativeAudio(), true);
  assert.equal(nativeAudioSupports({ provider: 'youtube' }), true);
  assert.equal(nativeAudioSupports({ provider: 'soundcloud' }), false);
  globalThis.WaveIOSImportAudio.providers = ['youtube', 'soundcloud'];
  assert.equal(nativeAudioSupports({ provider: 'soundcloud' }), true);
  assert.equal(await fetchNativeAudioFile({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }, signal), source);
});

test('iOS import rejects empty, nonaudio, and aborted results', async t => {
  t.after(() => { delete globalThis.WaveIOSImportAudio; });
  for (const file of [null, new File([], 'empty.mp3', { type: 'audio/mpeg' }), new File(['page'], 'page.html', { type: 'text/html' })]) {
    globalThis.WaveIOSImportAudio = async () => file;
    await assert.rejects(fetchNativeAudioFile({ url: 'https://soundcloud.com/a/b' }), /supported audio file/);
  }
  const controller = new AbortController();
  globalThis.WaveIOSImportAudio = async () => { controller.abort(); return new File(['abc'], 'a.mp3', { type: 'audio/mpeg' }); };
  await assert.rejects(fetchNativeAudioFile({ url: 'https://soundcloud.com/a/b' }, controller.signal), { name: 'AbortError' });
});

test('native import downloads only through the local app endpoint and preserves file identity', async t => {
  assert.equal(hasNativeAudio(), false);
  const { bridge, messages } = nativeBridge(t, (message, target) => {
    target.onmessage({ data: 'not json' });
    target.onmessage({ data: JSON.stringify({ id: 'another-request', ok: false }) });
    target.onmessage({ data: JSON.stringify({ id: message.id, ok: true, title: 'Native track', artist: 'Artist', fileName: 'track.m4a', audioUrl: '/wave-player/__native_audio/token-123' }) });
  });
  assert.equal(hasNativeAudio(), true);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://daronthedragon.github.io/wave-player/__native_audio/token-123');
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([4, 5, 6]));
  });
  const file = await fetchNativeAudioFile({ url: 'https://soundcloud.com/forss/flickermood' });
  assert.equal(file.name, 'Artist - Native track.m4a');
  assert.equal(file.type, 'audio/mp4');
  assert.equal(file.size, 3);
  assert.equal(file.lastModified, 0);
  assert.equal(messages[0].action, 'import');
  assert.equal(bridge.onmessage, null);
});

test('native import cancellation stops the matching job and clears the listener', async t => {
  const { bridge, messages } = nativeBridge(t, () => {});
  const controller = new AbortController();
  const pending = fetchNativeAudioFile({ url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(messages[1].action, 'cancel');
  assert.equal(messages[1].id, messages[0].id);
  assert.equal(bridge.onmessage, null);
});

test('native errors are shown and native results cannot become an arbitrary URL fetch', async t => {
  const { bridge } = nativeBridge(t, (message, target) => target.onmessage({ data: JSON.stringify({ id: message.id, ok: false, error: 'Provider rejected this track' }) }));
  await assert.rejects(fetchNativeAudioFile({ url: 'https://soundcloud.com/a/b' }), /Provider rejected/);
  for (const audioUrl of ['https://evil.example/wave-player/__native_audio/token', '/wave-player/index.html', '/wave-player/__native_audio/token?url=anything', 'https://user@daronthedragon.github.io/wave-player/__native_audio/token']) {
    bridge.postMessage = json => {
      const { id } = JSON.parse(json);
      queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ id, ok: true, audioUrl }) }));
    };
    await assert.rejects(fetchNativeAudioFile({ url: 'https://soundcloud.com/a/b' }), /invalid audio address/);
  }
});
