import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTracks, moveTrack, mergeTrackIds, collectionDuration } from '../src/library-tools.js';

const tracks = [
  { id: 'a', title: 'Track 10', artist: 'Moon', album: 'Night', kind: 'audio', addedAt: 1, duration: 120, storageState: 'persisted' },
  { id: 'b', title: 'Track 2', artist: 'Sun', album: 'Day', kind: 'video', addedAt: 3, duration: 3700 },
  { id: 'c', title: 'Dawn', artist: 'Moon', album: 'Day', kind: 'audio', addedAt: 2, duration: 30 }
];
test('search matches every word across metadata, filters and sorts without mutation', () => {
  assert.deepEqual(selectTracks(tracks, { query: 'moon day' }).map(t => t.id), ['c']);
  assert.deepEqual(selectTracks(tracks, { filter: 'audio', sort: 'recent' }).map(t => t.id), ['c', 'a']);
  assert.deepEqual(selectTracks(tracks, { sort: 'title' }).map(t => t.id), ['c', 'b', 'a']);
  assert.deepEqual(selectTracks(tracks, { filter: 'favorites', favorites: new Set(['b']) }).map(t => t.id), ['b']);
  assert.deepEqual(selectTracks(tracks, { filter: 'saved' }).map(t => t.id), ['a']);
  assert.deepEqual(tracks.map(t => t.id), ['a', 'b', 'c']);
});
test('playlist order moves safely at boundaries and preserves original array', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveTrack(ids, 'a', -1), ids);
  assert.deepEqual(moveTrack(ids, 'a', 1), ['b', 'a', 'c']);
  assert.deepEqual(moveTrack(ids, 'missing', 1), ids);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
test('bulk playlist additions remove duplicates and stale track references', () => {
  assert.deepEqual(mergeTrackIds(['a', 'gone'], ['a', 'c', 'b'], tracks), ['a', 'c', 'b']);
  assert.equal(collectionDuration(tracks), '1 hr 4 min');
});
