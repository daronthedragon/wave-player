const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

export function audioServerURL(value, pageProtocol = globalThis.location?.protocol) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter your audio server’s full HTTPS address.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && pageProtocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use an HTTPS server address without a path or credentials. Local HTTP works from the local test site.');
  }
  return url.origin;
}

export async function fetchAudioFile(link, server, signal) {
  const response = await fetch(server + '/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: link.url }), signal, credentials: 'omit', redirect: 'error'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The audio server could not load this track.');
  const audioURL = new URL(result.audioUrl, server);
  if (audioURL.origin !== server || !/^\/audio\/[A-Za-z0-9_-]+$/.test(audioURL.pathname) || audioURL.search || audioURL.hash || audioURL.username || audioURL.password) throw new Error('The server returned an invalid audio address.');
  const media = await fetch(audioURL, { signal, credentials: 'omit', redirect: 'error' });
  if (!media.ok) throw new Error('Audio download failed. Try loading the track again.');
  if (Number(media.headers.get('content-length')) > MAX_AUDIO_BYTES) throw new Error('This track exceeds the 64 MB audio limit.');
  const reader = media.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error('This track exceeds the 64 MB audio limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (!size) throw new Error('The server returned an empty audio file.');
  const extension = String(result.fileName || '').match(/\.(m4a|mp3|ogg|opus|webm|wav)$/i)?.[1]?.toLowerCase();
  if (!extension) throw new Error('The server returned an unsupported audio file.');
  const mime = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', wav: 'audio/wav' }[extension];
  const clean = text => String(text || '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').slice(0, 100).trim();
  const name = `${clean(result.artist) || 'Online audio'} - ${clean(result.title) || clean(link.title)}.${extension}`;
  return new File(chunks, name, { type: mime, lastModified: 0 });
}
