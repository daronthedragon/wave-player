import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../scripts/native-share.js', import.meta.url), 'utf8');
function fixture({ shareError, protocol = 'capacitor:', framed = false } = {}) {
  const writes = [], deletes = [], shares = [];
  const plugins = {
    Filesystem: {
      readdir: async () => ({ files: [] }),
      writeFile: async data => { writes.push(data); return { uri: 'file:///cache/' + data.path }; },
      deleteFile: async data => { deletes.push(data); }
    },
    Share: { share: async data => { shares.push(data); if (shareError) throw shareError; } }
  };
  const window = {}; window.top = framed ? {} : window;
  class FileReader {
    readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = 'data:audio/mpeg;base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }); }
  }
  vm.runInNewContext(code, { window, location: { protocol, hostname: 'localhost' }, capacitorExports: { Capacitor: { getPlatform: () => 'ios' }, registerPlugin: name => plugins[name] }, File, FileReader, DOMException, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } });
  return { share: window.WaveShareMP3, writes, deletes, shares };
}

test('native export is unavailable on a website or in a frame', () => {
  assert.equal(fixture({ protocol: 'https:' }).share, undefined);
  assert.equal(fixture({ framed: true }).share, undefined);
});
test('native export shares exact MP3 bytes from cache and cleans up after completion', async () => {
  const f = fixture();
  await f.share(new File(['MP3 test bytes'], '../artist/track.mp3', { type: 'audio/mpeg' }));
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].directory, 'CACHE');
  assert.equal(Buffer.from(f.writes[0].data, 'base64').toString(), 'MP3 test bytes');
  assert.match(f.writes[0].path, /^wave-export\/wave-[\da-f-]+-[^/\\]+\.mp3$/);
  assert.equal(f.shares[0].files[0], 'file:///cache/' + f.writes[0].path);
  assert.equal(f.deletes.at(-1).path, f.writes[0].path);
});
test('native export rejects oversized and non-MP3 input before touching storage', async () => {
  const f = fixture();
  class LargeFile extends File { get size() { return 65 * 1024 * 1024; } }
  await assert.rejects(f.share(new LargeFile(['x'], 'track.mp3', { type: 'audio/mpeg' })), /64 MB/);
  await assert.rejects(f.share(new File(['x'], 'track.txt', { type: 'text/plain' })), /MP3/);
  assert.equal(f.writes.length, 0);
});
test('share cancellation cleans the temporary file and releases the busy state', async () => {
  const f = fixture({ shareError: new Error('Share cancelled') });
  const file = new File(['x'], 'track.mp3', { type: 'audio/mpeg' });
  await assert.rejects(f.share(file), { name: 'AbortError' });
  await assert.rejects(f.share(file), { name: 'AbortError' });
  assert.equal(f.writes.length, 2);
  assert.equal(f.deletes.length, 2);
});
