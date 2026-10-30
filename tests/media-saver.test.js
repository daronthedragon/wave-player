import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMP3 } from '../src/media-saver.js';

test('existing MP3 bytes are preserved without starting the converter', async () => {
  const transcoder = { convert() { throw new Error('Converter must stay unloaded'); } };
  for (const bytes of [[0x49, 0x44, 0x33, 4, 0, 0], [0xff, 0xfb, 0x90, 0x64, 0]]) {
    const source = new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });
    const result = await prepareMP3(source, { transcoder, fileName: 'song.mp3' });
    assert.equal(result.blob, source);
    assert.equal(result.original, true);
  }
});

test('renamed non-MP3 files and other formats still go through real encoding', async () => {
  for (const fileName of ['song.mp3', 'song.wav']) {
    const source = new Blob(['RIFF not MP3'], { type: 'audio/mpeg' });
    const output = new Blob(['encoded'], { type: 'audio/mpeg' });
    const result = await prepareMP3(source, { fileName, transcoder: { async convert(blob, options) {
      assert.equal(blob, source);
      assert.equal(options.audioFormat, 'mp3');
      return output;
    } } });
    assert.equal(result.blob, output);
    assert.equal(result.original, false);
  }
});

test('cancelled exports never start conversion', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareMP3(new Blob(['audio']), { signal: controller.signal, transcoder: { convert() { assert.fail('cancelled'); } } }), { name: 'AbortError' });
});
