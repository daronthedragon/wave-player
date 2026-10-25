import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerEngine, metadataFromName, mediaKind } from '../src/audio-engine.js';

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
  assert.equal(errors.length, 2);
  assert.match(errors[1], /storage is full or unavailable/);
  assert.equal(engine.storageAvailable, false);
  assert.equal(engine.snapshot.storageAvailable, false);
  assert.ok(engine.tracks.every(track => track.storageState === 'session'));
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
function memoryIndexedDB(options = {}) {
  const records = new Map();
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(_storeName, mode) {
            const transaction = { objectStore: () => ({
              getAll: () => ({ result: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)).map(record => structuredClone(record)) }),
              get: id => ({ result: records.has(id) ? structuredClone(records.get(id)) : undefined }),
              put: record => { if (!options.failWrites) records.set(record.id, structuredClone(record)); return { result: record.id }; },
              delete: id => { records.delete(id); return {}; },
              clear: () => { records.clear(); return {}; },
            }) };
            queueMicrotask(() => {
              if (mode === 'readwrite' && options.failWrites) {
                transaction.error = new DOMException('Quota exceeded', 'QuotaExceededError');
                transaction.onabort?.();
              } else transaction.oncomplete?.();
            });
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
    assert.ok(restored.tracks.every(track => track.storageState === 'persisted'));
    assert.equal(restored.storageAvailable, true);
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

test('online audio retains source identity and bytes across reopening without duplicate imports', async () => {
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const source = { sourceId: 'soundcloud:artist/song', sourceUrl: 'https://soundcloud.com/artist/song', provider: 'soundcloud', title: 'Saved song' };
    const first = new PlayerEngine();
    const saved = await first.importOnlineFile(file('download.mp3'), source);
    assert.equal(saved.storageState, 'persisted');
    const savedId = saved.id;
    const originalUrl = saved.url;
    const duplicate = await first.importOnlineFile(file('different-name.mp3'), source);
    assert.equal(duplicate.id, savedId);
    assert.equal(first.tracks.length, 1);
    first.dispose();
    const reopened = new PlayerEngine();
    await reopened.init();
    const restored = reopened.tracks[0];
    assert.equal(restored.id, savedId, 'playlist references remain valid after reopening');
    assert.equal(restored.sourceId, source.sourceId);
    assert.equal(restored.sourceUrl, source.sourceUrl);
    assert.equal(restored.provider, 'soundcloud');
    assert.equal(restored.title, 'Saved song');
    assert.equal(restored.storageState, 'persisted');
    assert.notEqual(restored.url, originalUrl, 'the playable blob URL is renewed');
    assert.equal(await (await reopened.getFile(savedId)).text(), 'audio-fixture');
    assert.equal((await reopened.importOnlineFile(null, source)).id, savedId, 'cached source can be reused without fetching new bytes');
    assert.equal(reopened.tracks.length, 1);
    reopened.dispose();
  } finally {
    delete globalThis.indexedDB;
  }
});

test('failed storage keeps audio playable for this session and does not claim retention', async () => {
  const options = { failWrites: true };
  globalThis.indexedDB = memoryIndexedDB(options);
  try {
    const engine = new PlayerEngine();
    const errors = [];
    engine.addEventListener('error', event => errors.push(event.detail.message));
    const track = await engine.importOnlineFile(file('online.mp3'), { sourceId: 'youtube:123456789ab', sourceUrl: 'https://www.youtube.com/watch?v=123456789ab', provider: 'youtube' });
    assert.equal(track.storageState, 'session');
    assert.equal(engine.storageAvailable, true, 'a connected database can still reject a write');
    assert.equal(await (await engine.getFile(track.id)).text(), 'audio-fixture');
    assert.match(errors[0], /loaded again next time/);
    const [local] = await engine.addFiles([file('local.mp3')]);
    assert.equal(local.storageState, 'session');
    options.failWrites = false;
    await engine.replaceMedia(local.id, file('local.wav', 'audio/wav'));
    assert.equal(local.storageState, 'persisted', 'successful replacement updates retention status');
    engine.dispose();
    const reopened = new PlayerEngine();
    await reopened.init();
    assert.deepEqual(reopened.tracks.map(item => item.id), [local.id]);
    reopened.dispose();
  } finally {
    delete globalThis.indexedDB;
  }
});

test('same filename from distinct online sources retains both source identities', async () => {
  const engine = new PlayerEngine();
  const first = await engine.importOnlineFile(file('track.mp3'), { sourceId: 'soundcloud:a/song', sourceUrl: 'https://soundcloud.com/a/song', provider: 'soundcloud' });
  const second = await engine.importOnlineFile(file('track.mp3'), { sourceId: 'soundcloud:b/song', sourceUrl: 'https://soundcloud.com/b/song', provider: 'soundcloud' });
  assert.notEqual(first.id, second.id);
  assert.equal(engine.tracks.length, 2);
  engine.dispose();
});

test('upgrades legacy online imports in place and retains source metadata on subsequent launches', async () => {
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const downloaded = new File(['legacy-audio'], 'Artist - Download.mp3', { type: 'audio/mpeg', lastModified: 0 });
    const oldVersion = new PlayerEngine();
    const [legacy] = await oldVersion.addFiles([downloaded]);
    const playlistIds = [legacy.id];
    oldVersion.dispose();

    const upgraded = new PlayerEngine();
    await upgraded.init();
    const oldUrl = upgraded.tracks[0].url;
    const source = { sourceId: 'soundcloud:artist/download', sourceUrl: 'https://soundcloud.com/artist/download', provider: 'soundcloud', title: 'Download' };
    const migrated = await upgraded.importOnlineFile(downloaded, source);
    assert.equal(upgraded.tracks.length, 1);
    assert.equal(migrated.id, legacy.id);
    assert.equal(migrated.url, oldUrl, 'migration keeps the already-loaded audio source');
    assert.equal(migrated.storageState, 'persisted');
    upgraded.setQueue(playlistIds);
    assert.deepEqual(upgraded.queue.map(track => track.id), playlistIds);
    upgraded.dispose();

    const reopened = new PlayerEngine();
    await reopened.init();
    assert.equal(reopened.tracks[0].sourceId, source.sourceId);
    assert.equal(reopened.tracks[0].sourceUrl, source.sourceUrl);
    assert.equal(reopened.tracks[0].provider, source.provider);
    assert.equal(reopened.tracks[0].id, legacy.id);
    assert.equal(await (await reopened.getFile(legacy.id)).text(), 'legacy-audio');
    const distinct = await reopened.importOnlineFile(downloaded, { ...source, sourceId: 'soundcloud:other/download', sourceUrl: 'https://soundcloud.com/other/download' });
    assert.notEqual(distinct.id, legacy.id, 'an identified source is never merged with another source');
    assert.equal(reopened.tracks.length, 2);
    reopened.dispose();
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

test('audio/video imports use MIME and filename fallback, retaining original names', async () => {
  const engine = new PlayerEngine();
  const videoNames = ['sample.mp4', 'sample.MKV', 'sample.mov', 'sample.m4v', 'sample.webm', 'sample.avi', 'sample.wmv', 'sample.mpg', 'sample.mpeg', 'sample.ts', 'sample.mts', 'sample.m2ts', 'sample.flv', 'sample.3gp', 'sample.ogv'];
  await engine.addFiles([
    ...videoNames.map(name => file(name, '')),
    file('unusual.container', 'video/x-custom'),
    file('sound.mp4', 'audio/mp4'),
    file('song.weba', ''),
    file('song.mka', ''),
    null,
  ]);
  assert.equal(engine.tracks.length, videoNames.length + 4);
  assert.equal(engine.tracks.filter(track => track.kind === 'video').length, videoNames.length + 1);
  assert.equal(engine.tracks.find(track => track.fileName === 'sound.mp4').kind, 'audio');
  assert.equal(engine.tracks[0].originalFileName, 'sample.mp4');
  assert.equal(engine.tracks[0].album, 'Imported videos');
  assert.equal(mediaKind('unknown.xyz', ''), null);
  engine.dispose();
});

test('supplied video element drives playback, metadata, and conversion error events', async () => {
  const video = new FakeAudio();
  const engine = new PlayerEngine({ media: video });
  assert.equal(engine.audio, video);
  assert.equal(video.playsInline, true);
  const events = [];
  engine.addEventListener('decodeerror', event => events.push(event.detail));
  await engine.addFiles([file('scene.mkv', '')]);
  video.duration = 123;
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(engine.current.duration, 123);
  assert.equal(engine.current.videoWidth, 1920);
  await engine.play();
  assert.equal(engine.snapshot.playing, true);
  video.error = { code: 4 };
  video.dispatchEvent(new Event('error'));
  assert.equal(events.length, 1);
  assert.equal(events[0].id, engine.current.id);
  assert.equal(events[0].kind, 'video');
  assert.equal(engine.snapshot.playing, false, 'decode failures stop playback before opening conversion UI');
  video.error = { code: 2 };
  video.dispatchEvent(new Event('error'));
  assert.equal(events.length, 1, 'network errors should not suggest codec conversion');
  engine.dispose();
  const direct = new PlayerEngine(video);
  assert.equal(direct.audio, video);
  direct.dispose();
});

test('media replacement retains identity, refreshes active source and persists the converted blob', async () => {
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const engine = new PlayerEngine({ media: new FakeAudio() });
    await engine.addFiles([file('Camera - Holiday.mkv', ''), file('song.mp3')]);
    const { id, title, url } = engine.current;
    const original = await engine.getFile(id);
    assert.equal(await original.text(), 'audio-fixture');
    await engine.play();
    const replacement = new Blob(['converted-video'], { type: 'video/mp4' });
    await engine.replaceMedia(id, replacement, { fileName: 'Holiday.mp4' });
    assert.equal(engine.current.id, id);
    assert.equal(engine.current.title, title);
    assert.equal(engine.current.originalFileName, 'Camera - Holiday.mkv');
    assert.equal(engine.current.fileName, 'Holiday.mp4');
    assert.equal(engine.current.kind, 'video');
    assert.equal(engine.current.converted, true);
    assert.notEqual(engine.current.url, url);
    assert.equal(engine.audio.src, engine.current.url);
    assert.equal(engine.snapshot.playing, true);
    assert.equal(await (await engine.getFile(id)).text(), 'converted-video');
    await assert.rejects(fetch(url), 'old object URL should be revoked');
    const currentUrl = engine.audio.src;
    await engine.replaceMedia(engine.tracks[1].id, new Blob(['wav-conversion']), { fileName: 'song.wav', type: 'audio/wav' });
    assert.equal(engine.audio.src, currentUrl, 'replacing another item does not interrupt current playback');
    engine.dispose();
    const restored = new PlayerEngine();
    await restored.init();
    assert.equal(restored.current.originalFileName, 'Camera - Holiday.mkv');
    assert.equal(restored.current.kind, 'video');
    assert.equal(restored.current.type, 'video/mp4');
    assert.equal(await (await restored.getFile(id)).text(), 'converted-video');
    restored._files.delete(id);
    assert.equal(await (await restored.getFile(id)).text(), 'converted-video', 'blob can be retrieved directly from storage');
    assert.equal(await restored.getFile('missing'), null);
    await restored.remove(id);
    assert.equal(await restored.getFile(id), null);
    restored.dispose();
  } finally {
    delete globalThis.indexedDB;
  }
});


test('manual queue edits preserve playback, deduplicate tracks and honor Play next under shuffle', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('a.mp3'), file('b.mp3'), file('c.mp3'), file('d.mp3')]);
  const [a, b, c, d] = engine.tracks.map(track => track.id);
  engine.setQueue([a, b, c]);
  await engine.play();
  const src = engine.audio.src;
  engine.audio.duration = 100;
  engine.seek(37);
  assert.equal(engine.enqueue(d), true);
  assert.equal(engine.enqueue(b), true);
  assert.deepEqual(engine.snapshot.queueIds, [a, c, d, b]);
  assert.equal(engine.moveQueueItem(b, -1), true);
  assert.deepEqual(engine.snapshot.queueIds, [a, c, b, d]);
  assert.equal(engine.moveQueueItem(c, -1), false, 'upcoming items cannot move before the playing item');
  assert.equal(engine.moveQueueItem(d, 1), false);
  assert.equal(engine.removeQueueItem(a), false, 'removing current playback is not a queue edit');
  assert.equal(engine.enqueue(a), false);
  assert.equal(engine.playNext(a), false);
  assert.equal(engine.playNext('missing'), false);
  assert.equal(engine.enqueue('missing'), false);
  assert.equal(engine.removeQueueItem(c), true);
  assert.equal(engine.tracks.length, 4, 'queue removal leaves the library intact');
  assert.equal(engine.audio.src, src);
  assert.equal(engine.audio.currentTime, 37);
  assert.equal(engine.snapshot.playing, true);
  engine.setShuffle(true);
  assert.equal(engine.playNext(d), true);
  assert.equal(engine.playNext(d), true);
  assert.deepEqual(engine.snapshot.queueIds, [a, d, b]);
  engine.next();
  assert.equal(engine.current.id, d, 'explicit Play next wins over random shuffle');
  engine.dispose();
});

test('queue, selected track, position and playback preferences survive reopening without autoplay', async () => {
  const originalStorage = globalThis.localStorage;
  const settings = new Map();
  globalThis.localStorage = { getItem: key => settings.get(key) || null, setItem: (key, value) => settings.set(key, value) };
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const original = new PlayerEngine();
    await original.addFiles([file('first.mp3'), file('second.mp3'), file('third.mp3')]);
    const [a, b, c] = original.tracks.map(track => track.id);
    original.setQueue([c, b]);
    original.select(b);
    original.audio.duration = 180;
    original.seek(43.5);
    original.setPlaybackRate(1.5);
    original.setVolume(0.25);
    original.setShuffle(true);
    original.setRepeat('all');
    original.dispose();

    const reopened = new PlayerEngine();
    await reopened.init();
    assert.deepEqual(reopened.snapshot.queueIds, [c, b]);
    assert.equal(reopened.current.id, b);
    assert.equal(reopened.snapshot.currentTime, 43.5, 'pending position is visible while metadata loads');
    assert.equal(reopened.snapshot.playing, false);
    assert.equal(reopened.audio.playbackRate, 1.5);
    assert.equal(reopened.audio.defaultPlaybackRate, 1.5);
    assert.equal(reopened.snapshot.volume, 0.25);
    assert.equal(reopened.shuffle, true);
    assert.equal(reopened.repeat, 'all');
    reopened.audio.duration = 180;
    reopened.audio.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(reopened.audio.currentTime, 43.5);
    assert.equal(reopened.snapshot.playing, false, 'metadata restore never starts playback');
    await reopened.remove(b);
    assert.equal(reopened.current.id, c);
    reopened.dispose();

    const afterRemoval = new PlayerEngine();
    await afterRemoval.init();
    assert.deepEqual(afterRemoval.snapshot.queueIds, [c]);
    assert.equal(afterRemoval.current.id, c);
    assert.equal(afterRemoval.tracks.some(track => track.id === a), true);
    afterRemoval.dispose();
  } finally {
    globalThis.localStorage = originalStorage;
    delete globalThis.indexedDB;
  }
});

test('resume metadata is sanitized and changing tracks cancels a pending resume seek', async () => {
  const originalStorage = globalThis.localStorage;
  const settings = new Map();
  globalThis.localStorage = { getItem: key => settings.get(key) || null, setItem: (key, value) => settings.set(key, value) };
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const initial = new PlayerEngine();
    await initial.addFiles([file('a.mp3'), file('b.mp3')]);
    const [a, b] = initial.tracks.map(track => track.id);
    initial.dispose();
    settings.set('waveform-player-settings', JSON.stringify({ currentId: a, currentTime: 900, queueIds: [b, 'missing', a, a], playbackRate: 8 }));
    const resumed = new PlayerEngine();
    await resumed.init();
    assert.deepEqual(resumed.snapshot.queueIds, [b, a]);
    assert.equal(resumed.snapshot.playbackRate, 2);
    resumed.select(b, false);
    resumed.audio.duration = 120;
    resumed.audio.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(resumed.audio.currentTime, 0, 'old pending seek cannot leak into another track');
    resumed.setPlaybackRate(0.2);
    assert.equal(resumed.snapshot.playbackRate, 0.5);
    resumed.dispose();
    settings.set('waveform-player-settings', 'null');
    const legacy = new PlayerEngine();
    await legacy.init();
    assert.equal(legacy.snapshot.playbackRate, 1);
    assert.equal(legacy.snapshot.playing, false);
    legacy.dispose();
  } finally {
    globalThis.localStorage = originalStorage;
    delete globalThis.indexedDB;
  }
});

test('sleep timer pauses at its deadline, supports cancellation and is disposed safely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const engine = new PlayerEngine();
  await engine.addFiles([file('sleep.mp3')]);
  await engine.play();
  let sleeps = 0;
  engine.addEventListener('sleep', () => sleeps++);
  engine.setSleepTimer(10);
  assert.equal(engine.snapshot.sleepUntil, 700_000);
  t.mock.timers.tick(599_999);
  assert.equal(engine.snapshot.playing, true);
  t.mock.timers.tick(1);
  assert.equal(engine.snapshot.playing, false);
  assert.equal(engine.snapshot.sleepUntil, 0);
  assert.equal(sleeps, 1);
  await engine.play();
  engine.setSleepTimer(1);
  engine.setSleepTimer(0);
  t.mock.timers.tick(60_000);
  assert.equal(engine.snapshot.playing, true);
  assert.equal(sleeps, 1);
  engine.setSleepTimer(1);
  engine.dispose();
  t.mock.timers.tick(60_000);
  assert.equal(sleeps, 1);
});


test('Play next priority survives reopening with shuffle enabled', async () => {
  const originalStorage = globalThis.localStorage;
  const settings = new Map();
  globalThis.localStorage = { getItem: key => settings.get(key) || null, setItem: (key, value) => settings.set(key, value) };
  globalThis.indexedDB = memoryIndexedDB();
  try {
    const initial = new PlayerEngine();
    await initial.addFiles([file('a.mp3'), file('b.mp3'), file('c.mp3')]);
    const expected = initial.tracks[2].id;
    initial.setShuffle(true);
    initial.playNext(expected);
    initial.dispose();
    const reopened = new PlayerEngine();
    await reopened.init();
    assert.equal(reopened.snapshot.playing, false);
    reopened.next();
    assert.equal(reopened.current.id, expected);
    reopened.dispose();
  } finally {
    globalThis.localStorage = originalStorage;
    delete globalThis.indexedDB;
  }
});

test('reordering a Play next request follows visible queue order with shuffle off', async () => {
  const engine = new PlayerEngine();
  await engine.addFiles([file('a.mp3'), file('b.mp3'), file('c.mp3'), file('d.mp3')]);
  const [a, b, c, d] = engine.tracks.map(track => track.id);
  engine.playNext(d);
  assert.deepEqual(engine.snapshot.queueIds, [a, d, b, c]);
  engine.moveQueueItem(d, 1);
  assert.deepEqual(engine.snapshot.queueIds, [a, b, d, c]);
  engine.next();
  assert.equal(engine.current.id, b, 'moving the requested track down must not leave an invisible priority');
  engine.next();
  assert.equal(engine.current.id, d);
  engine.dispose();
});
