import test from 'node:test';
import assert from 'node:assert/strict';
import { audioServerURL, fetchAudioFile } from '../src/direct-audio.js';

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
