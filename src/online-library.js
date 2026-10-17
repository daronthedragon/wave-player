import { parseMediaLink, loadSavedLinks } from './online-links.js?v=1.2.0';

export function createOnlineLibrary({ pauseLocal, onChange, notify }) {
  const $ = selector => document.querySelector(selector);
  let links;
  try { links = loadSavedLinks(localStorage.getItem('wave-online-links')); }
  catch { links = []; }
  let current = null;
  const providerName = link => link.provider === 'youtube' ? 'YouTube' : 'SoundCloud';
  function persist() {
    try { localStorage.setItem('wave-online-links', JSON.stringify(links)); }
    catch { notify('Link saved for this session. Device storage is unavailable.'); }
    onChange();
  }
  function add(prefill = '') {
    $('#link-form').reset();
    $('#media-link').value = prefill;
    $('#link-error').textContent = '';
    $('#link-dialog').showModal();
    $('#media-link').focus();
  }
  function open(link) {
    pauseLocal();
    current = link;
    $('#online-title').textContent = link.title;
    $('#online-provider').textContent = providerName(link);
    $('#online-source').href = link.url;
    $('#online-source').textContent = 'Open in ' + providerName(link);
    $('#online-hosted').hidden = location.protocol !== 'file:';
    $('#online-hosted').href = 'https://daronthedragon.github.io/wave-player/?share-url=' + encodeURIComponent(link.url);
    const holder = $('#online-embed');
    holder.replaceChildren();
    $('#online-status').textContent = !navigator.onLine
      ? 'You’re offline. Reconnect, then reopen this link to stream it.'
      : 'Use the player controls below. If playback is unavailable, open the original link.';
    if (location.protocol === 'file:' && link.provider === 'youtube') {
      $('#online-status').textContent = 'YouTube needs the hosted WAVE app. Open WAVE online, or use the original YouTube link below.';
    } else if (navigator.onLine) {
      const frame = document.createElement('iframe');
      frame.title = providerName(link) + ' player: ' + link.title;
      frame.src = link.embedUrl;
      frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      holder.append(frame);
    }
    $('#online-player-dialog').showModal();
  }
  $('#link-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const link = parseMediaLink($('#media-link').value);
      const title = $('#link-title').value.trim();
      if (title) link.title = title.slice(0, 100);
      const existing = links.findIndex(item => item.id === link.id);
      if (existing < 0 && links.length >= 100) throw new Error('Your 100-link library is full. Remove a saved link first.');
      if (existing >= 0) links[existing] = link;
      else links.unshift(link);
      persist();
      $('#link-dialog').close();
      open(link);
    } catch (error) {
      $('#link-error').textContent = error.message;
    }
  });
  $('#online-player-dialog').addEventListener('close', () => {
    $('#online-embed').replaceChildren();
    current = null;
  });
  $('#remove-online-link').onclick = () => {
    if (!current) return;
    links = links.filter(link => link.id !== current.id);
    $('#online-player-dialog').close();
    persist();
    notify('Removed from saved links.');
  };
  return {
    add,
    entries: () => [
      { id: 'add-online-link', title: 'Add a link', subtitle: 'YouTube / SoundCloud', description: 'Paste a video, track, or playlist link.', icon: 'plus', action: () => add() },
      ...links.map(link => ({ id: link.id, title: link.title, subtitle: providerName(link), description: 'Stream with the original player. Internet required.', icon: link.provider === 'youtube' ? 'video' : 'music', action: () => open(link) }))
    ],
    receiveSharedLink() {
      const params = new URLSearchParams(location.search);
      if (!params.has('share-url') && !params.has('share-text')) return;
      const shared = params.get('share-url') || params.get('share-text') || '';
      const candidate = shared.match(/https?:\/\/[^\s<>]+/)?.[0] || shared;
      for (const key of ['share-url', 'share-text', 'share-title']) params.delete(key);
      try { history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash); } catch {}
      onChange();
      add(candidate);
    }
  };
}
