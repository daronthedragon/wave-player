// Pure collection operations shared by the library manager and its tests.
export function selectTracks(tracks, { query = '', filter = 'all', sort = 'added', favorites = new Set() } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result = tracks.filter(track => {
    if (filter === 'audio' && track.kind === 'video') return false;
    if (filter === 'video' && track.kind !== 'video') return false;
    if (filter === 'favorites' && !favorites.has(track.id)) return false;
    if (filter === 'saved' && track.storageState !== 'persisted') return false;
    const text = [track.title, track.artist, track.album, track.fileName].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
  const compare = (a, b, key) => String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { numeric: true, sensitivity: 'base' });
  if (sort === 'title' || sort === 'artist' || sort === 'album') result.sort((a, b) => compare(a, b, sort) || compare(a, b, 'title'));
  if (sort === 'recent') result.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (sort === 'duration') result.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return result;
}

export function moveTrack(ids, id, delta) {
  const result = [...ids], index = result.indexOf(id);
  if (index < 0 || !Number.isInteger(delta)) return result;
  const target = Math.max(0, Math.min(result.length - 1, index + delta));
  result.splice(index, 1); result.splice(target, 0, id);
  return result;
}

export function mergeTrackIds(existing, additions, tracks) {
  const available = new Set(tracks.map(track => track.id));
  return [...new Set([...existing, ...additions])].filter(id => available.has(id));
}

export function collectionDuration(tracks) {
  const seconds = tracks.reduce((sum, track) => sum + (Number.isFinite(track.duration) ? Math.max(0, track.duration) : 0), 0);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} hr ${Math.floor(seconds % 3600 / 60)} min` : `${Math.floor(seconds / 60)} min`;
}
