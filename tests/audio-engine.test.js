import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerEngine, metadataFromName } from '../src/audio-engine.js';

class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; this.ended = false; this.volume = 0.75; this.duration = NaN; this.currentTime = 0; this.src = ''; }
  load() { this.currentTime = 0; this.duration = NaN; this.paused = true; this.ended = false; }
  async play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
globalThis.Audio = FakeAudio;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

function file(name, type = 'audio/mpeg') { return new File(['audio-fixture'], name, { type, lastModified: 123 }); }

test('imports locally with unavailable persistence, filters non-audio and avoids duplicates', async () => {
  const engine = new PlayerEngine();
  const errors = [];
  engine.addEventListener('error', event => errors.push(event.detail.message));
  const song = file('Air - Moon_Safari.mp3');
  await engine.addFiles([song, song, file('notes.txt', 'text/plain'), file('song.flac', '')]);
  assert.equal(engine.tracks.length, 2);
  assert.equal(engine.current.title, 'Moon Safari');
  assert.equal(engine.current.artist, 'Air');
  assert.equal(engine.snapshot.playing, false);
  assert.equal(errors.length, 1);
  assert.equal(engine.snapshot.duration, 0);
  engine.dispose();
});

test('playback and end-of-queue behavior respects repeat modes', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('first.mp3'), file('second.mp3')]);
  await engine.play();
  assert.equal(engine.snapshot.playing, true);
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.title, 'second');
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.title, 'second');
  assert.equal(engine.snapshot.playing, false);
  engine.setRepeat('all');
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.title, 'first');
  engine.audio.duration = 60;
  engine.audio.currentTime = 60;
  engine.setRepeat('one');
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.title, 'first');
  assert.equal(engine.audio.currentTime, 0);
  engine.dispose();
});

test('removing current track keeps playback on a valid successor and releases file URLs', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('a.mp3'), file('b.mp3'), file('c.mp3')]);
  const firstId = engine.tracks[0].id;
  engine.select(engine.tracks[1].id);
  await engine.remove(firstId);
  assert.equal(engine.currentIndex, 0);
  assert.equal(engine.current.title, 'b');
  await engine.remove(engine.current.id);
  assert.equal(engine.current.title, 'c');
  assert.equal(engine.snapshot.playing, true);
  await engine.clear();
  assert.equal(engine.current, null);
  assert.equal(engine.snapshot.playing, false);
  assert.equal(engine.audio.src, '');
  engine.dispose();
});

test('seek and volume reject unsafe numeric values and clamp to media duration', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('track.mp3')]);
  engine.audio.duration = 100;
  engine.seek(Infinity);
  assert.equal(engine.audio.currentTime, 0);
  engine.seek(200);
  assert.equal(engine.audio.currentTime, 100);
  engine.setVolume(9);
  assert.equal(engine.audio.volume, 1);
  engine.setVolume(NaN);
  assert.equal(engine.audio.volume, 0);
  engine.dispose();
});

test('demo audio contains real stereo PCM data and repeated loading is idempotent', async () => {
  const engine = new PlayerEngine();
  await Promise.all([engine.loadDemo(), engine.loadDemo()]);
  assert.equal(engine.tracks.length, 3);
  const response = await fetch(engine.tracks[0].url);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint32(40, true), 22050 * 24 * 4);
  assert.ok(new Uint8Array(buffer.slice(44)).some(value => value !== 0));
  engine.dispose();
});

test('filename parsing preserves artistless titles and multi-part titles', () => {
  assert.deepEqual(metadataFromName('A_name.flac'), { title: 'A name', artist: 'Local library', album: 'Imported audio' });
  assert.equal(metadataFromName('Artist - Title - Live.mp3').title, 'Title - Live');
});

test('shuffle plays every track once and stops when repeat is off', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('a.mp3'), file('b.mp3'), file('c.mp3')]);
  engine.setShuffle(true);
  await engine.play();
  const heard = new Set([engine.current.id]);
  for (let index = 0; index < 2; index += 1) {
    engine.audio.dispatchEvent(new Event('ended'));
    assert.equal(heard.has(engine.current.id), false);
    heard.add(engine.current.id);
  }
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.snapshot.playing, false);
  assert.equal(heard.size, 3);
  engine.setRepeat('all');
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.snapshot.playing, true);
  engine.dispose();
});

// This small storage double returns records in key order, just like IndexedDB.
// It checks that saving/restoring does not accidentally reorder the user's queue.
function memoryIndexedDB() {
  const records = new Map();
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            const transaction = { objectStore: () => ({
              getAll: () => ({ result: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)).map(record => structuredClone(record)) }),
              put: record => { records.set(record.id, structuredClone(record)); return { result: record.id }; },
              delete: id => { records.delete(id); return {}; },
              clear: () => { records.clear(); return {}; },
            }) };
            queueMicrotask(() => transaction.oncomplete?.());
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('restores imported blobs and demo tracks in original order, and persists deletion', async () => {
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const initial = new PlayerEngine();
    await initial.loadDemo();
    await initial.addFiles([file('z - First.mp3'), file('a - Second.mp3')]);
    const expected = initial.tracks.map(track => ({ id: track.id, title: track.title }));
    const removedId = initial.tracks[1].id;
    initial.dispose();
    const restored = new PlayerEngine();
    await restored.init();
    assert.deepEqual(restored.tracks.map(track => ({ id: track.id, title: track.title })), expected);
    assert.equal(restored.snapshot.playing, false);
    const imported = await fetch(restored.tracks[4].url);
    assert.equal(await imported.text(), 'audio-fixture');
    assert.equal(restored.tracks[0].artist, 'WAVE Sound Lab');
    await restored.remove(removedId);
    restored.dispose();
    const third = new PlayerEngine();
    await third.init();
    assert.equal(third.tracks.length, 4);
    assert.equal(third.tracks.some(track => track.id === removedId), false);
    await third.clear();
    third.dispose();
    const empty = new PlayerEngine();
    await empty.init();
    assert.equal(empty.tracks.length, 0);
    empty.dispose();
  } finally {
    delete globalThis.indexedDB;
  }
});

test('playlist queue uses its own order, stops at its end and never plays outside tracks', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('outside.mp3'), file('first.mp3'), file('outside-too.mp3'), file('second.mp3')]);
  const first = engine.tracks[3].id;
  const second = engine.tracks[1].id;
  engine.setQueue([first, second, first, 'missing-track']);
  assert.deepEqual(engine.snapshot.queueIds, [first, second]);
  await engine.play();
  assert.equal(engine.current.id, first);
  assert.equal(engine.currentIndex, 3);
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.id, second);
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.id, second);
  assert.equal(engine.snapshot.playing, false);
  engine.previous();
  assert.equal(engine.current.id, first);
  engine.setRepeat('all');
  engine.audio.dispatchEvent(new Event('ended'));
  engine.audio.dispatchEvent(new Event('ended'));
  assert.equal(engine.current.id, first);
  engine.setQueue(null);
  assert.equal(engine.queue.length, 4);
  engine.dispose();
});

test('shuffle and removal stay inside the active queue', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('outside.mp3'), file('a.mp3'), file('b.mp3')]);
  const selectedIds = engine.tracks.slice(1).map(track => track.id);
  engine.setQueue(selectedIds);
  engine.setShuffle(true);
  await engine.play();
  engine.next();
  assert.ok(selectedIds.includes(engine.current.id));
  await engine.remove(engine.current.id);
  assert.ok(selectedIds.includes(engine.current.id));
  await engine.remove(engine.current.id);
  assert.equal(engine.queue.length, 0);
  assert.equal(engine.current, null);
  assert.equal(engine.snapshot.playing, false);
  assert.equal(engine.tracks.length, 1);
  await engine.play();
  assert.equal(engine.current, null);
  engine.dispose();
});
