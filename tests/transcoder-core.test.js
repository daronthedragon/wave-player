import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled WASM converts synthetic AVI video to MP4 and encodes playable WAV and MP3 audio', { timeout: 30000 }, async () => {
  const coreSource = await readFile(new URL('../vendor/ffmpeg/ffmpeg-core.js', import.meta.url), 'utf8');
  const wasmBinary = new Uint8Array(await readFile(new URL('../vendor/ffmpeg/ffmpeg-core.wasm', import.meta.url)));
  // The vendored UMD core targets a classic worker. Supply its location without
  // browser navigation; wasmBinary prevents all fetches during this test.
  const createCore = new Function('self', `${coreSource}\nreturn createFFmpegCore;`)({ location: { href: 'https://test.invalid/ffmpeg-core.js' } });
  const core = await createCore({ wasmBinary });
  const logs = [];
  core.setLogger(({ message }) => { logs.push(message); if (logs.length > 5) logs.shift(); });
  function run(...args) {
    core.reset(); core.setTimeout(10000); core.exec(...args);
    assert.equal(core.ret, 0, logs.join('\n'));
  }
  run('-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', 'input.avi');
  run('-i', 'input.avi', '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'output.mp4');
  const mp4 = core.FS.readFile('output.mp4');
  assert.equal(new TextDecoder().decode(mp4.slice(4, 8)), 'ftyp');
  assert.ok(mp4.length > 1000);
  run('-i', 'input.avi', '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'output.wav');
  const wav = core.FS.readFile('output.wav');
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE');
  assert.ok(wav.length > 100000);
  run('-i', 'input.avi', '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', 'output.mp3');
  const mp3 = core.FS.readFile('output.mp3');
  assert.ok(mp3.length > 10000 && mp3.length < wav.length);
  run('-i', 'output.mp3', '-f', 'null', '-'); // A decoder must accept the generated MP3.

});
