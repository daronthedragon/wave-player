import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../scripts/native-audio.js', import.meta.url), 'utf8');
function fixture({ protocol = 'capacitor:', framed = false, size = 3, malformed = false } = {}) {
  const calls = [];
  const native = {
    importAudio: async data => { calls.push(['import', data]); return { token: data.token, type: 'audio/mp4', name: '../song.m4a', size }; },
    readChunk: async data => { calls.push(['read', data]); return { data: malformed ? '' : btoa('abc') }; },
    cleanup: async data => { calls.push(['cleanup', data]); },
    cancel: async data => { calls.push(['cancel', data]); }
  };
  const window = {}; window.top = framed ? {} : window;
  vm.runInNewContext(code, { window, location: { protocol, hostname: 'localhost' }, capacitorExports: {
    Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native
  }, File, DOMException, crypto, atob, Uint8Array, setTimeout, clearTimeout });
  return { run: window.WaveIOSImportAudio, calls };
}
test('import bridge is native top-frame only and advertises YouTube only', () => {
  assert.equal(fixture({ protocol: 'https:' }).run, undefined);
  assert.equal(fixture({ framed: true }).run, undefined);
  assert.equal(fixture().run.providers.join(','), 'youtube');
});
test('native audio returns exact bytes as a File then cleans temporary audio', async () => {
  const f = fixture();
  const file = await f.run('https://youtu.be/jNQXAC9IVRw');
  assert.equal(await file.text(), 'abc');
  assert.equal(file.type, 'audio/mp4');
  assert.equal(file.name, '.._song.m4a');
  assert.equal(file.lastModified, 0);
  assert.equal(f.calls.at(-1)[0], 'cleanup');
});
test('oversized and incomplete native results fail with cache cleanup', async () => {
  for (const options of [{ size: 65 * 1024 * 1024 }, { malformed: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run('https://youtu.be/jNQXAC9IVRw'), /invalid audio|Incomplete/);
    assert.equal(f.calls.at(-1)[0], 'cleanup');
  }
});
test('an already cancelled request does not invoke native extraction', async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.run('https://youtu.be/jNQXAC9IVRw', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
});
