const DB_NAME = 'waveform-player-library';
const AUDIO_EXTENSIONS = /\.(mp3|mp2|wav|wave|flac|aac|m4a|m4b|ogg|oga|opus|aif|aiff|wma|weba|caf|alac|ape|amr|ac3|dts|mka|aiffc|aifc|au|snd)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|qt|mkv|webm|avi|wmv|asf|mpg|mpeg|mpe|m1v|m2v|ts|mts|m2ts|flv|f4v|3gp|3g2|ogv|vob|divx|rm|rmvb)$/i;

export function mediaKind(fileName, type = '') {
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (VIDEO_EXTENSIONS.test(fileName || '')) return 'video';
  if (AUDIO_EXTENSIONS.test(fileName || '')) return 'audio';
  return null;
}
const DEMOS = [
  { id: 'demo-orbit', title: 'Orbital', artist: 'WAVE Sound Lab', album: 'Signals from Home', artwork: 'assets/cover-orbit.svg', notes: [130.81, 164.81, 196, 261.63] },
  { id: 'demo-drift', title: 'Slow drift', artist: 'WAVE Sound Lab', album: 'Signals from Home', artwork: 'assets/cover-drift.svg', notes: [110, 130.81, 164.81, 220] },
  { id: 'demo-nocturne', title: 'After hours', artist: 'WAVE Sound Lab', album: 'Signals from Home', artwork: 'assets/cover-nocturne.svg', notes: [146.83, 174.61, 220, 293.66] },
];

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));

export function metadataFromName(name) {
  const stem = String(name || 'Untitled audio').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const pieces = stem.split(/\s+-\s+/);
  return { title: pieces.length > 1 ? pieces.slice(1).join(' - ') : stem || 'Untitled audio', artist: pieces.length > 1 ? pieces[0] : 'Local library', album: 'Imported audio' };
}

function createWave(notes, seconds = 24) {
  const rate = 22050;
  const frames = rate * seconds;
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const word = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let index = 0; index < frames; index += 1) {
    const t = index / rate;
    const envelope = Math.min(1, t / 2.5, (seconds - t) / 4);
    let left = 0; let right = 0;
    notes.forEach((frequency, voice) => {
      const swell = 0.65 + 0.35 * Math.sin(t * (0.35 + voice * 0.07) + voice);
      left += Math.sin(2 * Math.PI * frequency * t) * swell * 0.095;
      right += Math.sin(2 * Math.PI * frequency * 1.001 * t + voice * 0.12) * swell * 0.095;
    });
    const bell = Math.sin(2 * Math.PI * notes[Math.floor(t / 3) % notes.length] * 4 * t) * Math.exp(-(t % 3) * 2.3) * 0.07;
    view.setInt16(44 + index * 4, clamp((left + bell) * envelope, -1, 1) * 32767, true);
    view.setInt16(46 + index * 4, clamp((right + bell) * envelope, -1, 1) * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class PlayerEngine extends EventTarget {
  constructor(options = {}) {
    super();
    // Keep the audio alias for the shared transport and Web Audio visualizer.
    this.audio = (typeof options?.play === 'function' ? options : options?.media) || new Audio();
    this.audio.preload = 'metadata';
    this.audio.playsInline = true;
    this.audio.volume = 0.75;
    this.tracks = [];
    this.currentIndex = -1;
    this.shuffle = false;
    this.repeat = 'off';
    this.db = null;
    this._initPromise = null;
    this._demoPromise = null;
    this._history = [];
    this._shufflePlayed = new Set();
    this._queueIds = null;
    this._disposed = false;
    this._listeners = [];
    this._files = new Map();
    for (const type of ['play', 'pause', 'playing', 'volumechange']) this._listen(type, () => this._emit());
    this._listen('loadedmetadata', () => {
      if (this.current) {
        if (Number.isFinite(this.audio.duration)) this.current.duration = this.audio.duration;
        if (this.audio.videoWidth > 0) {
          this.current.kind = 'video';
          this.current.videoWidth = this.audio.videoWidth;
          this.current.videoHeight = this.audio.videoHeight;
        }
        void this._persistTrack(this.current).catch(() => {});
      }
      this._emit();
    });
    this._listen('durationchange', () => this._emit());
    this._listen('timeupdate', () => this.dispatchEvent(new CustomEvent('progress', { detail: this.snapshot })));
    this._listen('ended', () => {
      if (this.repeat === 'one') { this.seek(0); void this.play(); }
      else this.next(true);
    });
    this._listen('error', () => {
      if (!this.current) return;
      const kind = this.current.kind || 'audio';
      const messages = { 2: 'This media file could not be read.', 3: 'This file could not be decoded.', 4: 'This media format is not supported by your browser.' };
      const message = messages[this.audio.error?.code] || 'Unable to play this file.';
      this.audio.pause();
      this._error(message);
      if (this.audio.error?.code === 3 || this.audio.error?.code === 4) {
        this.dispatchEvent(new CustomEvent('decodeerror', { detail: { id: this.current.id, message, kind } }));
      }
      this._emit();
    });
    this._setupMediaSession();
  }

  get current() { return this.tracks[this.currentIndex] || null; }
  get queue() {
    if (this._queueIds === null) return [...this.tracks];
    const tracksById = new Map(this.tracks.map(track => [track.id, track]));
    return this._queueIds.map(id => tracksById.get(id)).filter(Boolean);
  }
  get snapshot() {
    return {
      tracks: this.tracks.map(track => ({ ...track })), current: this.current ? { ...this.current } : null,
      currentIndex: this.currentIndex, queueIds: this.queue.map(track => track.id), playing: !this.audio.paused && !this.audio.ended,
      volume: this.audio.volume, shuffle: this.shuffle, repeat: this.repeat,
      currentTime: finite(this.audio.currentTime), duration: finite(this.audio.duration, this.current?.duration || 0),
    };
  }

  _listen(type, handler) { this.audio.addEventListener(type, handler); this._listeners.push([type, handler]); }
  _emit() { if (!this._disposed) this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot })); }
  _error(message) { if (!this._disposed) this.dispatchEvent(new CustomEvent('error', { detail: { message } })); }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        const preferences = JSON.parse(localStorage.getItem('waveform-player-settings') || '{}');
        this.audio.volume = clamp(preferences.volume ?? 0.75, 0, 1);
        this.shuffle = Boolean(preferences.shuffle);
        this.repeat = ['off', 'all', 'one'].includes(preferences.repeat) ? preferences.repeat : 'off';
      } catch { /* Storage may be unavailable in private browsing. */ }
      try {
        if (!globalThis.indexedDB) throw new Error('Storage unavailable');
        this.db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Storage is busy'));
        });
        if (this._disposed) { this.db.close(); return this.snapshot; }
        this.db.onversionchange = () => { this.db.close(); this.db = null; };
        const saved = await this._store('readonly', store => store.getAll());
        for (const record of (saved || []).sort((a, b) => finite(a.addedAt) - finite(b.addedAt))) {
          if (record.blob instanceof Blob && !this.tracks.some(track => track.id === record.id)) {
            const { blob, ...metadata } = record;
            this._files.set(record.id, blob);
            this.tracks.push({ ...metadata, kind: metadata.kind || mediaKind(metadata.fileName, metadata.type) || 'audio', originalFileName: metadata.originalFileName || metadata.fileName, url: URL.createObjectURL(blob) });
          }
        }
        if (this.currentIndex < 0 && this.tracks.length) this.select(this.tracks[0].id, false);
      } catch { /* Playback still works when persistence is unavailable. */ }
      this._emit();
      return this.snapshot;
    })();
    return this._initPromise;
  }

  _store(mode, callback) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('tracks', mode);
      const request = callback(transaction.objectStore('tracks'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  _saveSettings() {
    try { localStorage.setItem('waveform-player-settings', JSON.stringify({ volume: this.audio.volume, shuffle: this.shuffle, repeat: this.repeat })); } catch { /* Optional persistence. */ }
  }

  async _persistTrack(track) {
    const blob = this._files.get(track.id);
    if (!blob) return;
    const { url, ...metadata } = track;
    await this._store('readwrite', store => store.put({ ...metadata, blob }));
  }

  async getFile(id) {
    await this.init();
    if (!this.tracks.some(track => track.id === id)) return null;
    if (this._files.has(id)) return this._files.get(id);
    const record = await this._store('readonly', store => store.get(id));
    if (!(record?.blob instanceof Blob)) return null;
    this._files.set(id, record.blob);
    return record.blob;
  }

  async replaceMedia(id, blob, { fileName, type } = {}) {
    if (!(blob instanceof Blob)) throw new TypeError('Replacement media must be a Blob or File.');
    await this.init();
    const track = this.tracks.find(item => item.id === id);
    if (!track) return null;
    const isCurrent = this.current?.id === id;
    const wasPlaying = isCurrent && !this.audio.paused;
    const oldUrl = track.url;
    const replacementType = type || blob.type || track.type;
    const replacement = replacementType !== blob.type ? new Blob([blob], { type: replacementType }) : blob;
    Object.assign(track, {
      originalFileName: track.originalFileName || track.fileName,
      fileName: fileName || blob.name || track.fileName,
      type: replacementType,
      duration: 0,
      converted: true,
      url: URL.createObjectURL(replacement),
    });
    delete track.videoWidth;
    delete track.videoHeight;
    this._files.set(id, replacement);
    if (isCurrent) {
      this.audio.pause();
      this.audio.src = track.url;
      this.audio.load();
      this._updateMediaSession();
      if (wasPlaying) void this.play();
    }
    URL.revokeObjectURL(oldUrl);
    this._emit();
    try { await this._persistTrack(track); } catch { this._error('The converted file is ready to play, but browser storage is full or unavailable.'); }
    return { ...track };
  }

  _nextAddedAt() {
    return this.tracks.reduce((next, track) => Math.max(next, finite(track.addedAt) + 1), Date.now());
  }

  async addFiles(files) {
    await this.init();
    const added = [];
    let rejected = 0;
    let storageFailed = false;
    for (const file of Array.from(files || [])) {
      if (!(file instanceof Blob)) { rejected += 1; continue; }
      const kind = mediaKind(file.name, file.type);
      if (!kind) { rejected += 1; continue; }
      const signature = `${file.name}:${file.size}:${file.lastModified || 0}`;
      if (this.tracks.some(track => track.signature === signature)) continue;
      const metadata = { id: globalThis.crypto?.randomUUID?.() || `media-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...metadataFromName(file.name), album: kind === 'video' ? 'Imported videos' : 'Imported audio', fileName: file.name, originalFileName: file.name, type: file.type, kind, duration: 0, signature, addedAt: this._nextAddedAt() };
      const track = { ...metadata, url: URL.createObjectURL(file) };
      this._files.set(track.id, file);
      this.tracks.push(track); added.push(track);
      try { await this._store('readwrite', store => store.put({ ...metadata, blob: file })); } catch { storageFailed = true; }
    }
    if (this.currentIndex < 0 && this.tracks.length) this.select(this.tracks[0].id, false);
    this._emit();
    if (rejected) this._error(`${rejected} non-media ${rejected === 1 ? 'file was' : 'files were'} skipped.`);
    if (storageFailed) this._error('Your files are ready to play, but browser storage is full or unavailable. Add them again next time.');
    return added;
  }

  async loadDemo() {
    if (this._demoPromise) return this._demoPromise;
    this._demoPromise = (async () => {
      await this.init();
      for (const { notes, ...metadata } of DEMOS) {
        if (this.tracks.some(track => track.id === metadata.id)) continue;
        const blob = createWave(notes);
        const record = { ...metadata, fileName: `${metadata.title}.wav`, originalFileName: `${metadata.title}.wav`, kind: 'audio', type: 'audio/wav', duration: 24, demo: true, addedAt: this._nextAddedAt() };
        this._files.set(record.id, blob);
        this.tracks.push({ ...record, url: URL.createObjectURL(blob) });
        try { await this._store('readwrite', store => store.put({ ...record, blob })); } catch { /* Demos can always be regenerated from settings. */ }
        // Give the interface a frame between generating each original demo.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (this.currentIndex < 0 && this.tracks.length) this.select(this.tracks[0].id, false);
      this._emit();
      return this.snapshot;
    })();
    try { return await this._demoPromise; } finally { this._demoPromise = null; }
  }

  select(id, autoplay = true) {
    const index = this.tracks.findIndex(track => track.id === id);
    if (index < 0) return false;
    if (this._queueIds !== null && !this._queueIds.includes(id)) this.setQueue(null);
    if (index !== this.currentIndex || !this.audio.src) {
      if (this.current) {
        this._history.push(this.current.id);
        if (this._history.length > 1000) this._history.shift();
      }
      this.currentIndex = index;
      this._shufflePlayed.add(this.current.id);
      this.audio.src = this.current.url;
      this.audio.load();
      this._updateMediaSession();
    }
    this._emit();
    if (autoplay) void this.play();
    return true;
  }

  async play() {
    const queue = this.queue;
    if (!queue.length) return;
    if (!this.current || !queue.some(track => track.id === this.current.id)) this.select(queue[0].id, false);
    if (!this.current) return;
    try { await this.audio.play(); } catch (error) {
      if (error.name !== 'AbortError') this._error(error.name === 'NotAllowedError' ? 'Press Play to allow audio playback.' : 'This file could not be played. Its audio codec may not be supported on this device.');
    }
    this._emit();
  }

  pause() { this.audio.pause(); this._emit(); }
  toggle() { if (this.audio.paused) return this.play(); this.pause(); }

  next(automatic = false) {
    const queue = this.queue;
    if (!queue.length) { if (automatic) this.pause(); return; }
    const currentQueueIndex = queue.findIndex(track => track.id === this.current?.id);
    let index = currentQueueIndex + 1;
    if (this.shuffle && queue.length > 1) {
      let candidates = queue.filter(track => !this._shufflePlayed.has(track.id));
      if (!candidates.length) {
        if (automatic && this.repeat !== 'all') { this.pause(); return; }
        this._shufflePlayed = new Set(this.current ? [this.current.id] : []);
        candidates = queue.filter(track => track.id !== this.current?.id);
      }
      index = queue.indexOf(candidates[Math.floor(Math.random() * candidates.length)]);
    } else if (index >= queue.length) {
      if (automatic && this.repeat !== 'all') { this.pause(); this._emit(); return; }
      index = 0;
    }
    if (index === currentQueueIndex) this.seek(0);
    this.select(queue[index].id);
  }

  previous() {
    const queue = this.queue;
    if (!queue.length) return;
    if (this.audio.currentTime > 3) { this.seek(0); return; }
    if (this.shuffle && this._history.length) {
      const id = this._history.pop();
      if (queue.some(track => track.id === id)) { this.select(id); this._history.pop(); return; }
    }
    const index = Math.max(0, queue.findIndex(track => track.id === this.current?.id));
    this.select(queue[(index - 1 + queue.length) % queue.length].id);
  }

  setQueue(ids = null) {
    const available = new Set(this.tracks.map(track => track.id));
    this._queueIds = ids === null ? null : [...new Set(ids)].filter(id => available.has(id));
    this._history = [];
    this._shufflePlayed = new Set(this.current ? [this.current.id] : []);
    this._emit();
    return this.queue;
  }

  seek(seconds) {
    const duration = this.snapshot.duration;
    if (duration <= 0) return;
    try { this.audio.currentTime = clamp(seconds, 0, duration); } catch { /* Metadata is not ready yet. */ }
    this.dispatchEvent(new CustomEvent('progress', { detail: this.snapshot }));
  }
  setVolume(value) { this.audio.volume = clamp(value, 0, 1); this._saveSettings(); this._emit(); }
  setRepeat(value) { this.repeat = ['off', 'all', 'one'].includes(value) ? value : ({ off: 'all', all: 'one', one: 'off' })[this.repeat]; this._saveSettings(); this._emit(); return this.repeat; }
  setShuffle(value) {
    this.shuffle = typeof value === 'boolean' ? value : !this.shuffle;
    this._shufflePlayed = new Set(this.current ? [this.current.id] : []);
    this._saveSettings(); this._emit(); return this.shuffle;
  }

  async remove(id) {
    const index = this.tracks.findIndex(track => track.id === id);
    if (index < 0) return;
    const wasCurrent = index === this.currentIndex;
    const wasPlaying = !this.audio.paused;
    const queueIndex = this.queue.findIndex(track => track.id === id);
    const [track] = this.tracks.splice(index, 1);
    if (this._queueIds !== null) this._queueIds = this._queueIds.filter(trackId => trackId !== id);
    if (wasCurrent) {
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.currentIndex = -1;
      const queue = this.queue;
      if (queue.length) this.select(queue[Math.min(Math.max(queueIndex, 0), queue.length - 1)].id, wasPlaying);
    } else if (index < this.currentIndex) this.currentIndex -= 1;
    URL.revokeObjectURL(track.url);
    this._files.delete(id);
    this._history = this._history.filter(previous => previous !== id);
    this._shufflePlayed.delete(id);
    this._updateMediaSession();
    this._emit();
    try { await this._store('readwrite', store => store.delete(id)); } catch { this._error('The file was removed for this session, but its saved copy could not be deleted.'); }
  }

  async clear() {
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.tracks.forEach(track => URL.revokeObjectURL(track.url));
    this._files.clear();
    this.tracks = []; this.currentIndex = -1; this._history = []; this._shufflePlayed.clear(); this._queueIds = null;
    this._updateMediaSession(); this._emit();
    try { await this._store('readwrite', store => store.clear()); } catch { this._error('The library was cleared for this session, but saved files could not be deleted.'); }
  }

  _setupMediaSession() {
    if (!globalThis.navigator?.mediaSession) return;
    const handlers = { play: () => this.play(), pause: () => this.pause(), previoustrack: () => this.previous(), nexttrack: () => this.next(), seekto: event => this.seek(event.seekTime), seekbackward: event => this.seek(this.audio.currentTime - (event.seekOffset || 10)), seekforward: event => this.seek(this.audio.currentTime + (event.seekOffset || 10)) };
    for (const [name, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Unsupported action. */ }
    }
  }

  _updateMediaSession() {
    if (!globalThis.navigator?.mediaSession || !globalThis.MediaMetadata) return;
    const track = this.current;
    navigator.mediaSession.metadata = track ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album }) : null;
  }

  dispose() {
    this._disposed = true;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    for (const [type, handler] of this._listeners) this.audio.removeEventListener(type, handler);
    this.tracks.forEach(track => URL.revokeObjectURL(track.url));
    this._files.clear();
    this.db?.close();
  }
}
