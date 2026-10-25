import { parseMediaLink, loadSavedLinks } from './online-links.js?v=2.0.0';
import { audioServerURL, fetchAudioFile, hasNativeAudio, fetchNativeAudioFile } from './direct-audio.js?v=2.0.0';

export function createOnlineLibrary({ pauseLocal, playAudio, playSaved, findSaved, getPlaylists, onChange, notify }) {
  const $ = selector => document.querySelector(selector);
  let links;
  try { links = loadSavedLinks(localStorage.getItem('wave-online-links')); }
  catch { links = []; }
  let current = null;
  let targetPlaylist = '';
  let request = null;
  let server = '';
  try { server = localStorage.getItem('wave-audio-server') || ''; } catch {}
  if (!server && location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname)) server = 'http://127.0.0.1:4181';
  $('#audio-server').value = server;
  const nativeAudio = hasNativeAudio();
  $('.audio-connection').hidden = nativeAudio;
  $('#native-audio-hint').hidden = !nativeAudio;
  $('#browser-audio-hint').hidden = nativeAudio;
  const providerName = link => link.provider === 'youtube' ? 'YouTube' : 'SoundCloud';
  const canRetrieveAudio = () => nativeAudio || Boolean(server);
  function updateCapabilities() {
    const available = canRetrieveAudio();
    $('#link-capability').textContent = available
      ? 'Load audio from a YouTube video or SoundCloud track into WAVE’s music player.'
      : 'YouTube and SoundCloud links are bookmarks in the website and Home Screen app. To play audio here, import an audio file. The Android APK can download supported links on the phone.';
    $('#link-submit').textContent = available ? 'Load audio' : 'Save link';
    $('#link-destination').hidden = !available;
    $('#load-online-audio').hidden = !available;
    $('#online-import-file').hidden = available;
  }
  updateCapabilities();
  function persist() {
    try { localStorage.setItem('wave-online-links', JSON.stringify(links)); }
    catch { notify('Link saved for this session. Device storage is unavailable.'); }
    onChange();
  }
  function add(prefill = '') {
    updateCapabilities();
    $('#link-form').reset();
    $('#media-link').value = prefill;
    $('#link-error').textContent = '';
    const choices = $('#link-playlist');
    choices.replaceChildren(new Option('Music library', ''), new Option('Create a new playlist…', '__new__'));
    for (const playlist of getPlaylists()) choices.add(new Option(playlist.name, playlist.id));
    $('#link-new-playlist').hidden = true;
    $('#link-new-playlist-name').required = false;
    $('#link-dialog').showModal();
    $('#media-link').focus();
  }
  async function open(link, playlist = '') {
    pauseLocal();
    if (findSaved(link.id)) {
      try { await playSaved(link, playlist); }
      catch (error) { notify(error.message || 'Unable to open the saved track.'); }
      return;
    }
    current = link;
    targetPlaylist = playlist;
    $('#online-title').textContent = link.title;
    $('#online-provider').textContent = providerName(link);
    $('#online-source').href = link.url;
    $('#online-source').textContent = 'Open in ' + providerName(link);
    $('#online-player-dialog').showModal();
    updateCapabilities();
    if (canRetrieveAudio()) void loadAudio();
    else $('#online-status').textContent = 'Link saved. This website and its Home Screen app cannot retrieve ' + providerName(link) + ' audio directly. Import an audio file to listen in WAVE, or open the original link.';
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
      if (!nativeAudio && !server) throw new Error('Use the Android APK to retrieve this link on your phone, or import an audio file. The GitHub web app cannot retrieve provider audio directly.');
      status.textContent = nativeAudio
        ? 'Downloading on this phone… Keep WAVE open. Close this window to cancel.'
        : 'Loading audio… You can close this window to cancel. Longer tracks take more time.';
      const file = nativeAudio
        ? await fetchNativeAudioFile(link, controller.signal)
        : await fetchAudioFile(link, audioServerURL(server), controller.signal);
      if (controller.signal.aborted || current !== link) return;
      const destination = targetPlaylist;
      $('#online-player-dialog').close();
      try { await playAudio(file, link, destination); }
      catch (error) { notify(error.message || 'Unable to save this audio.'); }
    } catch (error) {
      if (request !== controller) return;
      if (!$('#online-player-dialog').open) { if (!controller.signal.aborted) notify(error.message || 'Unable to save this audio.'); return; }
      status.textContent = error.name === 'TypeError'
        ? nativeAudio ? 'The phone could not finish downloading this track. Check your connection and try again.' : 'Cannot reach your audio companion. Check its address, connection, and allowed website settings.'
        : error.message || 'Unable to load this track.';
    } finally {
      clearTimeout(timeout);
      if (request === controller) { request = null; button.disabled = false; }
    }
  }
  $('#load-online-audio').onclick = () => void loadAudio();
  $('#online-import-file').onclick = () => {
    $('#online-player-dialog').close();
    $('#file-input').click();
  };
  $('#link-playlist').onchange = () => {
    $('#link-new-playlist').hidden = $('#link-playlist').value !== '__new__';
    $('#link-new-playlist-name').required = $('#link-playlist').value === '__new__';
  };
  $('#audio-server-form').onsubmit = event => {
    event.preventDefault();
    try {
      server = audioServerURL($('#audio-server').value.trim());
      try { localStorage.setItem('wave-audio-server', server); } catch {}
      updateCapabilities();
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
      const destination = $('#link-playlist').value === '__new__'
        ? { name: $('#link-new-playlist-name').value.trim() } : $('#link-playlist').value;
      if (typeof destination === 'object' && !destination.name) throw new Error('Give the new playlist a name.');
      const existing = links.findIndex(item => item.id === link.id);
      if (existing < 0 && links.length >= 100) throw new Error('Your 100-link library is full. Remove a saved link first.');
      if (existing >= 0) links[existing] = link;
      else links.unshift(link);
      persist();
      $('#link-dialog').close();
      void open(link, destination);
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
      { id: 'add-online-link', title: 'Add a link', subtitle: 'YouTube / SoundCloud', description: nativeAudio ? 'Download a track on this phone and keep it in your library. No server setup.' : 'Save a link. Use the Android APK to download its audio on your phone, or import a file.', icon: 'plus', action: () => add() },
      ...links.map(link => {
        const saved = findSaved(link.id);
        return { id: link.id, title: saved?.title || link.title,
          subtitle: providerName(link) + (saved ? saved.storageState === 'persisted' ? ' · Saved on device' : ' · This session' : canRetrieveAudio() ? '' : ' · Saved link'),
          description: saved ? 'Play the saved audio immediately. No server needed.' : canRetrieveAudio() ? 'Load audio into Music with WAVE’s player and visualizer.' : 'Saved bookmark. Open the original link, or import an audio file to listen in WAVE.',
          icon: 'music', action: () => open(link) };
      })
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
