const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{1,150}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SOUNDCLOUD_RESERVED = new Set(['discover', 'search', 'you', 'stream', 'upload', 'settings', 'charts', 'stations', 'pages', 'terms-of-use', 'privacy', 'jobs']);

function readURL(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a YouTube or SoundCloud link.');
  let value = input.trim();
  if (value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) throw new Error('Use a complete YouTube or SoundCloud URL without spaces.');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) value = 'https://' + value;
  let url;
  try { url = new URL(value); } catch { throw new Error('That link is not a valid URL.'); }
  const authority = value.match(/^https?:\/\/([^/\?#]*)/i)?.[1];
  if (!authority || !['https:', 'http:'].includes(url.protocol) || /[@:]/.test(authority)) {
    throw new Error('Use an ordinary HTTPS link without a username, password, or port.');
  }
  return url;
}

function startSeconds(url) {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const value = url.searchParams.get('start') ?? url.searchParams.get('t') ?? fragment.get('t');
  if (!value || value.length > 32) return 0;
  let seconds;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else {
    const parts = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!parts) return 0;
    seconds = Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
  }
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 2147483647 ? seconds : 0;
}

/** Validates a provider URL and builds a fixed-host iframe URL; never fetches media. */
export function parseMediaLink(input) {
  const source = readURL(input);
  const host = source.hostname.toLowerCase();
  if (host === 'on.soundcloud.com') throw new Error('Open the SoundCloud short link first, then paste its full soundcloud.com track or playlist URL.');

  if (YOUTUBE_HOSTS.has(host)) {
    const path = source.pathname.replace(/\/$/, '');
    let videoId;
    if (host === 'youtu.be' || host === 'www.youtu.be') videoId = path.slice(1);
    else if (path === '/watch') videoId = source.searchParams.get('v');
    else videoId = path.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1];
    const list = source.searchParams.get('list');
    // A watch link with playlist context is still a video, not a playlist-only link.
    const playlistOnly = !['youtu.be', 'www.youtu.be'].includes(host) && (path === '/playlist' || path === '/embed/videoseries');
    if (playlistOnly ? !PLAYLIST_ID.test(list || '') : !VIDEO_ID.test(videoId || '')) {
      throw new Error('Use a YouTube video link or a playlist link containing a valid list ID.');
    }
    const url = new URL(playlistOnly ? 'https://www.youtube.com/playlist' : 'https://www.youtube.com/watch');
    const embed = new URL(playlistOnly ? 'https://www.youtube-nocookie.com/embed/videoseries' : `https://www.youtube-nocookie.com/embed/${videoId}`);
    if (!playlistOnly) url.searchParams.set('v', videoId);
    if (list && PLAYLIST_ID.test(list)) {
      url.searchParams.set('list', list);
      embed.searchParams.set('list', list);
    }
    const start = startSeconds(source);
    if (start) {
      url.searchParams.set('t', String(start));
      embed.searchParams.set('start', String(start));
    }
    embed.searchParams.set('playsinline', '1');
    return {
      id: `youtube:${playlistOnly ? 'playlist' : 'video'}:${playlistOnly ? list : videoId}`,
      provider: 'youtube',
      title: playlistOnly ? `YouTube playlist · ${list}` : `YouTube · ${videoId}`,
      url: url.href,
      embedUrl: embed.href
    };
  }

  if (SOUNDCLOUD_HOSTS.has(host)) {
    const parts = source.pathname.replace(/\/$/, '').split('/').slice(1);
    const isTrack = parts.length === 2;
    const isPlaylist = parts.length === 3 && parts[1] === 'sets';
    if ((!isTrack && !isPlaylist) || parts.some(part => !/^[A-Za-z0-9_-]{1,200}$/.test(part)) || SOUNDCLOUD_RESERVED.has(parts[0].toLowerCase()) || (isTrack && parts[1] === 'sets')) {
      throw new Error('Use a full SoundCloud track or playlist link, not a profile or search page.');
    }
    const path = '/' + parts.join('/');
    const url = 'https://soundcloud.com' + path;
    const embed = new URL('https://w.soundcloud.com/player/');
    embed.searchParams.set('url', url);
    embed.searchParams.set('auto_play', 'false');
    embed.searchParams.set('show_comments', 'false');
    embed.searchParams.set('visual', 'true');
    return { id: `soundcloud:${path}`, provider: 'soundcloud', title: `${parts[0]} · ${parts.at(-1).replaceAll('-', ' ')}`.slice(0, 100), url, embedUrl: embed.href };
  }
  throw new Error('Only YouTube and SoundCloud links are supported.');
}

/** Treat persisted objects as untrusted; regenerate IDs, provider and embed URLs. */
export function loadSavedLinks(storageValue) {
  if (typeof storageValue !== 'string' || storageValue.length > 1000000) return [];
  let entries;
  try { entries = JSON.parse(storageValue); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  const saved = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    try {
      const item = parseMediaLink(entry.url);
      if (seen.has(item.id)) continue;
      if (typeof entry.title === 'string') {
        const title = entry.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
        if (title) item.title = title;
      }
      seen.add(item.id);
      saved.push(item);
      if (saved.length === 100) break;
    } catch { /* Ignore obsolete or unsafe saved entries without losing valid links. */ }
  }
  return saved;
}
