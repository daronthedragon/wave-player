import { selectTracks, moveTrack, mergeTrackIds, collectionDuration } from './library-tools.js?v=2.0.0';

export function createLibraryWorkspace({ engine, getPlaylists, savePlaylists, getFavorites, saveFavorites, beforePlay, notify: notifyMessage, addMedia, onQueueEdit }) {
  let persistenceWarning = false;
  const notify = message => { notifyMessage(message + (persistenceWarning ? ' Changes last for this session only; device storage is unavailable.' : '')); persistenceWarning = false; };
  const host = document.createElement('dialog');
  host.id = 'library-workspace';
  host.setAttribute('aria-labelledby', 'workspace-title');
  host.innerHTML = `
    <header class="workspace-header"><div><span class="workspace-eyebrow">WAVE / COLLECTIONS</span><h2 id="workspace-title">Your listening room.</h2><p id="workspace-summary"></p></div><button data-action="close" class="workspace-close" aria-label="Close library">×</button></header>
    <nav class="workspace-tabs" aria-label="Library sections"><button data-tab="library" class="active">Library</button><button data-tab="playlists">Playlists</button><button data-tab="queue">Play queue</button></nav>
    <div class="workspace-body">
      <section id="workspace-playlists" hidden><div class="playlist-picker"><label>Collection<select id="workspace-playlist" aria-label="Collection"></select></label><button data-action="new" class="glass-button">+ New</button></div><form id="workspace-rename"><input aria-label="Playlist name" maxlength="50" required><button class="glass-button">Rename</button></form><div class="workspace-actions"><button data-action="duplicate">Duplicate</button><button data-action="delete">Delete playlist</button></div><p id="playlist-empty" hidden>Create a playlist, then select tracks in Library to fill it.</p></section>
      <div class="workspace-filters"><input id="workspace-search" type="search" placeholder="Find a title, artist, or album…" aria-label="Search collection"><select id="workspace-filter" aria-label="Filter library"><option value="all">All media</option><option value="audio">Audio</option><option value="video">Video</option><option value="favorites">Favorites</option><option value="saved">Saved offline</option></select><select id="workspace-sort" aria-label="Sort library"><option value="added">Library order</option><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="artist">Artist A–Z</option><option value="album">Album A–Z</option><option value="duration">Longest first</option></select></div>
      <div class="workspace-list-heading"><label id="workspace-select-label"><input id="workspace-select-all" type="checkbox"> Select shown</label><span id="workspace-count"></span><button data-action="play-all" class="glass-button">Play shown</button></div>
      <p id="queue-hint" hidden>Queue order is used when shuffle is off. Removing a track here keeps it in your library.</p>
      <div id="workspace-tracks" class="workspace-tracks"></div>
      <div id="workspace-bulk" class="workspace-bulk" hidden><strong id="workspace-selected"></strong><select id="workspace-destination" aria-label="Destination playlist"></select><button data-action="add-selected" class="glass-button">Add to playlist</button><button data-action="queue-selected">Add to queue</button><button data-action="clear-selection">Clear</button></div>
    </div>
    <footer class="workspace-footer"><button id="workspace-toggle" data-action="toggle" class="glass-button">Play</button><button data-action="import" class="glass-button">+ Add media</button><div class="listening-settings"><label>Speed<select id="workspace-speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><label>Sleep<select id="workspace-sleep" aria-label="Sleep timer"><option value="0">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="90">90 min</option></select></label></div><span id="workspace-sleep-status" role="status"></span></footer>`;
  document.body.append(host);
  const $ = selector => host.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let tab = 'library', playlistId = '', selected = new Set(), shown = [], deletePending = false;
  const playlist = () => getPlaylists().find(item => item.id === playlistId);
  const currentSource = () => tab === 'queue' ? engine.queue : tab === 'playlists'
    ? (playlist()?.tracks || []).map(id => engine.tracks.find(track => track.id === id)).filter(Boolean) : engine.tracks;
  function commit(items) { persistenceWarning = savePlaylists(items) === false; render(); }
  function renderRows() {
    shown = selectTracks(currentSource(), { query: $('#workspace-search').value, filter: tab === 'library' ? $('#workspace-filter').value : 'all', sort: tab === 'library' ? $('#workspace-sort').value : 'added', favorites: getFavorites() });
    const available = new Set(engine.tracks.map(track => track.id));
    selected = new Set([...selected].filter(id => available.has(id)));
    $('[data-action="play-all"]').disabled = !shown.length;
    $('#workspace-count').textContent = `${shown.length} tracks · ${collectionDuration(shown)}`;
    $('#workspace-tracks').innerHTML = shown.map((track, index) => {
      const current = engine.current?.id === track.id;
      const source = currentSource(), sourceIndex = source.findIndex(item => item.id === track.id), currentIndex = source.findIndex(item => item.id === engine.current?.id);
      const canMove = !$('#workspace-search').value.trim() && (tab !== 'queue' || sourceIndex > currentIndex);
      const duration = Number.isFinite(track.duration) ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : '—';
      return `<article class="workspace-track ${current ? 'current' : ''}" data-id="${escape(track.id)}">
        ${tab === 'library' ? `<input type="checkbox" data-select="${escape(track.id)}" aria-label="Select ${escape(track.title)}" ${selected.has(track.id) ? 'checked' : ''}>` : `<span class="track-number">${String(index + 1).padStart(2, '0')}</span>`}
        <button class="workspace-track-title" data-action="play" aria-label="Play ${escape(track.title)}"><strong>${escape(track.title)}</strong><span>${escape(track.artist)} · ${escape(track.album || (track.kind === 'video' ? 'Video' : 'Audio'))}</span></button>
        <span class="track-duration">${duration}</span><span class="storage-badge">${current && !engine.audio.paused ? 'PLAYING' : track.storageState === 'persisted' ? 'SAVED' : 'SESSION'}</span>
        <div class="track-row-actions"><button data-action="favorite" aria-label="${getFavorites().has(track.id) ? 'Unfavorite' : 'Favorite'} ${escape(track.title)}" aria-pressed="${getFavorites().has(track.id)}">${getFavorites().has(track.id) ? '♥' : '♡'}</button>
        ${tab === 'library' ? '<button data-action="next" title="Play next" aria-label="Play next">Next</button>' : `<button data-action="up" aria-label="Move ${escape(track.title)} up" ${!canMove || sourceIndex === 0 || (tab === 'queue' && sourceIndex === currentIndex + 1) ? 'disabled' : ''}>↑</button><button data-action="down" aria-label="Move ${escape(track.title)} down" ${!canMove || sourceIndex === source.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove" aria-label="Remove ${escape(track.title)} from ${tab === 'queue' ? 'queue' : 'playlist'}" ${tab === 'queue' && current ? 'disabled title="Current track stays in the queue"' : ''}>×</button>`}</div></article>`;
    }).join('') || `<div class="workspace-empty"><strong>${$('#workspace-search').value ? 'No matches yet.' : tab === 'queue' ? 'Make room for your next favorite.' : 'A little space for something good.'}</strong><p>${tab === 'playlists' ? 'Select tracks in Library and add them to this playlist.' : 'Add media from your device, or adjust your filters.'}</p></div>`;
    updateSelection();
  }
  function updateSelection() {
    $('#workspace-bulk').hidden = tab !== 'library' || !selected.size;
    $('#workspace-selected').textContent = `${selected.size} selected`;
    const count = shown.filter(track => selected.has(track.id)).length;
    $('#workspace-select-all').checked = shown.length > 0 && count === shown.length;
    $('#workspace-select-all').indeterminate = count > 0 && count < shown.length;
  }
  function updatePlayback() {
    $('#workspace-toggle').textContent = engine.snapshot.playing ? 'Pause' : 'Play';
    $('#workspace-toggle').setAttribute('aria-label', engine.snapshot.playing ? 'Pause playback' : 'Resume playback');
    $('#workspace-toggle').disabled = !engine.queue.length;
    $('#workspace-speed').value = String(engine.snapshot.playbackRate || 1);
    const until = engine.snapshot.sleepUntil;
    $('#workspace-sleep-status').textContent = until ? `Pauses in ${Math.max(1, Math.ceil((until - Date.now()) / 60000))} min` : 'Press Play to resume your saved place. Sleep timers apply while WAVE is open.';
    if (!until) $('#workspace-sleep').value = '0';
  }
  function render() {
    if (!host.open) return;
    const saved = engine.tracks.filter(track => track.storageState === 'persisted').length;
    $('#workspace-summary').textContent = `${engine.tracks.length} tracks · ${getPlaylists().length} playlists · ${saved} saved on this device`;
    $('#workspace-playlists').hidden = tab !== 'playlists';
    $('#workspace-filter').hidden = $('#workspace-sort').hidden = $('#workspace-select-label').hidden = tab !== 'library';
    $('#queue-hint').hidden = tab !== 'queue';
    host.querySelectorAll('[data-tab]').forEach(button => { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-pressed', String(button.dataset.tab === tab)); });
    const choices = getPlaylists();
    if (!choices.some(item => item.id === playlistId)) playlistId = choices[0]?.id || '';
    $('#workspace-playlist').innerHTML = choices.map(item => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join('') || '<option value="">No playlists yet</option>';
    $('#workspace-playlist').value = playlistId;
    $('#workspace-rename input').value = playlist()?.name || '';
    $('#workspace-rename').hidden = !playlist();
    $('#workspace-playlists .workspace-actions').hidden = !playlist();
    $('#playlist-empty').hidden = !!playlist();
    const destination = $('#workspace-destination').value;
    $('#workspace-destination').innerHTML = '<option value="__new__">New playlist…</option>' + choices.map(item => `<option value="${escape(item.id)}">${escape(item.name)}</option>`).join('');
    if (choices.some(item => item.id === destination)) $('#workspace-destination').value = destination;
    $('[data-action="delete"]').textContent = deletePending ? 'Confirm delete playlist' : 'Delete playlist';
    renderRows(); updatePlayback();
  }
  function switchTab(next) { tab = next; deletePending = false; $('#workspace-search').value = ''; render(); }
  $('#workspace-search').oninput = renderRows;
  $('#workspace-filter').onchange = $('#workspace-sort').onchange = renderRows;
  $('#workspace-playlist').onchange = event => { playlistId = event.target.value; deletePending = false; render(); };
  $('#workspace-select-all').onchange = event => { shown.forEach(track => event.target.checked ? selected.add(track.id) : selected.delete(track.id)); renderRows(); };
  $('#workspace-tracks').onchange = event => { const id = event.target.dataset.select; if (id) { event.target.checked ? selected.add(id) : selected.delete(id); updateSelection(); } };
  $('#workspace-rename').onsubmit = event => { event.preventDefault(); const name = $('#workspace-rename input').value.trim(); if (!name || !playlist()) return; commit(getPlaylists().map(item => item.id === playlistId ? { ...item, name: name.slice(0, 50) } : item)); notify('Playlist renamed.'); };
  $('#workspace-speed').onchange = event => engine.setPlaybackRate(Number(event.target.value));
  $('#workspace-sleep').onchange = event => { engine.setSleepTimer(Number(event.target.value)); updatePlayback(); };
  async function playTrack(id, replaceQueue = true) {
    await beforePlay();
    if (replaceQueue) engine.setQueue(shown.map(track => track.id));
    engine.select(id);
  }
  host.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.tab) { switchTab(button.dataset.tab); return; }
    const action = button.dataset.action, id = button.closest('[data-id]')?.dataset.id;
    const p = playlist();
    if (['next', 'queue-selected'].includes(action) || (tab === 'queue' && ['up', 'down', 'remove'].includes(action))) onQueueEdit();
    if (action === 'close') host.close();
    if (action === 'toggle') { await beforePlay(); await engine.toggle(); }
    if (action === 'import') { host.close(); addMedia(); }
    if (action === 'play') { await playTrack(id, tab !== 'queue'); }
    if (action === 'play-all' && shown.length) await playTrack(shown[0].id);
    if (action === 'favorite') { const favorites = new Set(getFavorites()); favorites.has(id) ? favorites.delete(id) : favorites.add(id); if(saveFavorites(favorites) === false) notifyMessage('Favorite changed for this session only; device storage is unavailable.'); renderRows(); }
    if (action === 'next') { notify(engine.playNext(id) ? 'Added to play next.' : 'This track is already playing or selected.'); }
    if (action === 'clear-selection') { selected.clear(); renderRows(); }
    if (action === 'queue-selected') { for (const id of selected) engine.enqueue(id); selected.clear(); renderRows(); notify('Selected tracks added to queue.'); }
    if (action === 'new' || action === 'add-selected') {
      const target = action === 'new' ? '__new__' : $('#workspace-destination').value;
      const additions = action === 'add-selected' ? [...selected] : [];
      let items = getPlaylists();
      if (target === '__new__') {
        const names = new Set(items.map(item => item.name)); let n = 1;
        while (names.has(`New playlist ${n}`)) n++;
        const created = { id: uid(), name: `New playlist ${n}`, tracks: mergeTrackIds([], additions, engine.tracks) };
        playlistId = created.id; items = [...items, created];
      } else items = items.map(item => item.id === target ? { ...item, tracks: mergeTrackIds(item.tracks, additions, engine.tracks) } : item);
      selected.clear(); commit(items);
      if (target === '__new__') { switchTab('playlists'); $('#workspace-rename input').focus(); $('#workspace-rename input').select(); }
      notify(action === 'new' ? 'Playlist created. Give it a name.' : 'Tracks added to playlist.');
    }
    if (action === 'duplicate' && p) { const copy = { ...p, id: uid(), name: `${p.name.slice(0, 43)} (copy)`, tracks: [...p.tracks] }; playlistId = copy.id; commit([...getPlaylists(), copy]); notify('Playlist duplicated.'); }
    if (action === 'delete' && p) {
      if (!deletePending) { deletePending = true; render(); return; }
      deletePending = false; commit(getPlaylists().filter(item => item.id !== p.id)); notify('Playlist deleted. Media stays in your library.');
    }
    if (['up', 'down', 'remove'].includes(action) && id) {
      if (tab === 'queue') { if (action === 'remove') engine.removeQueueItem(id); else engine.moveQueueItem(id, action === 'up' ? -1 : 1); }
      if (tab === 'playlists' && p) { commit(getPlaylists().map(item => item.id === p.id ? { ...item, tracks: action === 'remove' ? item.tracks.filter(trackId => trackId !== id) : moveTrack(item.tracks, id, action === 'up' ? -1 : 1) } : item)); if(persistenceWarning) notify('Playlist updated.'); }
    }
  });
  // Avoid replacing a focused form field on every playback update.
  let lastState = '';
  engine.addEventListener('change', () => {
    if (!host.open) return;
    const snapshot = engine.snapshot;
    const key = JSON.stringify([snapshot.queueIds, snapshot.current?.id, snapshot.playing, snapshot.tracks.map(track => [track.id, track.duration, track.storageState])]);
    if (key !== lastState) { lastState = key; renderRows(); }
    updatePlayback();
  });
  const tick = setInterval(() => { if (host.open) updatePlayback(); }, 10000);
  window.addEventListener('pagehide', () => clearInterval(tick), { once: true });
  return { open(section = 'library') { if (!host.open) host.showModal(); switchTab(section); }, refresh: render };
}
