import { parseMediaLink, loadSavedLinks } from './online-links.js?v=1.2.1';
import { audioServerURL, fetchAudioFile } from './direct-audio.js?v=1.2.1';

export function createOnlineLibrary({ pauseLocal, playAudio, onChange, notify }) {
  const $ = selector => document.querySelector(selector);
  let links;
  try { links = loadSavedLinks(localStorage.getItem('wave-online-links')); }
  catch { links = []; }
  let current = null;
  let request = null;
  let server = '';
  try { server = localStorage.getItem('wave-audio-server') || ''; } catch {}
  if (!server && location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname)) server = 'http://127.0.0.1:4181';
  $('#audio-server').value = server;
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
    $('#online-player-dialog').showModal();
    void loadAudio();
  }
  async function loadAudio() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const link = current;
    if (!link) return;
    const status = $('#online-status');
    const button = $('#load-online-audio');
    button.disabled = true;
    const timeout = setTimeout(() => controller.abort(new Error('Loading timed out. Try a shorter track.')), 210000);
    try {
      if (!server) throw new Error('Connect an audio server below to load this track. The public site does not have one connected yet.');
      const base = audioServerURL(server);
      status.textContent = 'Loading audio… You can close this window to cancel. Longer tracks take more time.';
      const file = await fetchAudioFile(link, base, controller.signal);
      if (controller.signal.aborted || current !== link) return;
      $('#online-player-dialog').close();
      await playAudio(file);
      notify('Audio added to Music. Use WAVE’s controls and visualizer.');
    } catch (error) {
      if (request !== controller || !$('#online-player-dialog').open) return;
      status.textContent = error.name === 'TypeError'
        ? 'Cannot reach the audio server. Check its address, connection, and allowed website settings.'
        : error.message || 'Unable to load this track.';
    } finally {
      clearTimeout(timeout);
      if (request === controller) { request = null; button.disabled = false; }
    }
  }
  $('#load-online-audio').onclick = () => void loadAudio();
  $('#audio-server-form').onsubmit = event => {
    event.preventDefault();
    try {
      server = audioServerURL($('#audio-server').value.trim());
      try { localStorage.setItem('wave-audio-server', server); } catch {}
      void loadAudio();
    } catch (error) { $('#online-status').textContent = error.message; }
  };
  $('#link-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const link = parseMediaLink($('#media-link').value);
      if (link.id.startsWith('youtube:playlist:') || new URL(link.url).pathname.includes('/sets/')) throw new Error('Paste an individual video or track. Playlist import is not supported yet.');
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
    request?.abort();
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
      { id: 'add-online-link', title: 'Add a link', subtitle: 'YouTube / SoundCloud', description: 'Load a video’s audio or a track into WAVE. Audio server required.', icon: 'plus', action: () => add() },
      ...links.map(link => ({ id: link.id, title: link.title, subtitle: providerName(link), description: 'Load audio into Music with WAVE’s player and visualizer.', icon: 'music', action: () => open(link) }))
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
