import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaTranscoder } from '../src/transcoder.js';

test('conversion validates type, size and cancellation before starting a worker', async () => {
  const converter = new MediaTranscoder();
  class LargeBlob extends Blob { get size() { return 257 * 1024 * 1024; } }
  await assert.rejects(converter.convert('not a file'), /Select an audio or video/);
  await assert.rejects(converter.convert(new Blob()), /empty/);
  await assert.rejects(converter.convert(new LargeBlob(['x'])), /256 MB/);
  await assert.rejects(converter.convert(new Blob(['x']), { kind: 'image' }), /audio or video/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(converter.convert(new Blob(['x']), { signal: controller.signal }), { name: 'AbortError' });
});

test('worker conversion produces typed output, reports progress and releases worker', async () => {
  const oldWorker = globalThis.Worker;
  const oldDocument = globalThis.document;
  let worker;
  globalThis.document = { baseURI: 'https://example.com/wave-player/' };
  globalThis.Worker = class {
    constructor(url) { worker = this; this.url = String(url); this.terminated = false; }
    postMessage(message) {
      this.message = message;
      queueMicrotask(() => {
        this.onmessage({ data: { type: 'progress', progress: 0.5, message: 'Converting' } });
        this.onmessage({ data: { type: 'result', bytes: new Uint8Array([1, 2, 3]).buffer } });
      });
    }
    terminate() { this.terminated = true; }
  };
  try {
    const converter = new MediaTranscoder();
    const progress = [];
    converter.addEventListener('progress', event => progress.push(event.detail));
    const output = await converter.convert(new Blob(['source']), { kind: 'video', fileName: 'movie.avi' });
    assert.equal(output.type, 'video/mp4');
    assert.equal(output.size, 3);
    assert.equal(worker.url, 'https://example.com/wave-player/src/transcoder-worker.js?v=1.2.0');
    assert.equal(worker.message.fileName, 'movie.avi');
    assert.equal(worker.message.coreURL, 'https://example.com/wave-player/vendor/ffmpeg/ffmpeg-core.js');
    assert.equal(worker.terminated, true);
    assert.equal(converter.job, null);
    assert.equal(progress.at(-1).progress, 0.5);
  } finally { globalThis.Worker = oldWorker; globalThis.document = oldDocument; }
});

test('cancel interrupts a pending input read, rejects promptly, and allows another job', async () => {
  const oldWorker = globalThis.Worker;
  globalThis.Worker = class { constructor() { throw new Error('Worker should not start after cancellation'); } };
  let finishRead;
  class SlowBlob extends Blob { arrayBuffer() { return new Promise(resolve => { finishRead = resolve; }); } }
  try {
    const converter = new MediaTranscoder();
    const promise = converter.convert(new SlowBlob(['x']));
    await assert.rejects(converter.convert(new Blob(['other'])), /Another conversion/);
    converter.cancel();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(converter.job, null);
    finishRead(new ArrayBuffer(1));
    await Promise.resolve();
  } finally { globalThis.Worker = oldWorker; }
});
