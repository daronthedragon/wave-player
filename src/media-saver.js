// Preserve an existing MP3 rather than loading the converter and re-encoding it.
export async function prepareMP3(source, { transcoder, fileName, signal }) {
  signal?.throwIfAborted();
  const header = new Uint8Array(await source.slice(0, 4).arrayBuffer());
  const tagged = header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33 && header[3] >= 2 && header[3] <= 4;
  const frame = header[0] === 0xff && (header[1] & 0xe0) === 0xe0 && (header[1] & 0x18) !== 0x08 && (header[1] & 6) === 2 && (header[2] >> 4) > 0 && (header[2] >> 4) < 15 && (header[2] & 12) !== 12;
  const original = (source.type === 'audio/mpeg' || /\.mp3$/i.test(fileName || '')) && (tagged || frame);
  signal?.throwIfAborted();
  const blob = original ? source : await transcoder.convert(source, { kind: 'audio', audioFormat: 'mp3', fileName, signal });
  return { blob, original };
}

export function createMediaSaver({ engine, transcoder, notify }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'media-saver';
  dialog.setAttribute('aria-labelledby', 'save-title');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="save-title">Save an MP3</h2><button id="save-close" class="glass-button" aria-label="Close MP3 saver">Close</button></div>
    <p id="save-source"></p><p id="save-progress-text" role="status"></p><progress id="save-progress" max="1" value="0"></progress>
    <div id="save-ready" hidden><p id="save-file-info"></p><div class="option-stack"><button id="save-in-library" class="glass-button">Keep MP3 in WAVE</button><button id="save-download" class="glass-button">Download MP3</button><button id="save-share" class="glass-button" hidden>Share / Save to Files</button></div></div>
    <p>Conversion runs on this device. Your original track stays in your library. The converter loads on first use; long tracks can take time on a phone.</p>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let controller, file, downloadURL;
  function release() {
    controller?.abort(); controller = null; file = null;
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = null;
  }
  dialog.addEventListener('close', release);
  $('#save-close').onclick = () => dialog.close();
  transcoder.addEventListener('progress', event => {
    if (!dialog.open || !controller || controller.signal.aborted) return;
    $('#save-progress').value = event.detail.progress;
    $('#save-progress-text').textContent = event.detail.message;
  });
  $('#save-in-library').onclick = async () => {
    const savedFile = file;
    if (!savedFile) return;
    $('#save-in-library').disabled = true;
    try {
      const added = await engine.addFiles([savedFile]);
      const track = added[0] || engine.tracks.find(track => track.signature === `${savedFile.name}:${savedFile.size}:0`);
      $('#save-progress-text').textContent = track?.storageState === 'persisted' ? 'MP3 saved in WAVE. It is ready for offline replay and playlists.' : 'MP3 is available for this session. Download it to keep a separate copy; device storage is unavailable or full.';
      $('#save-in-library').textContent = 'Added to Music';
    } catch (error) { $('#save-progress-text').textContent = error.message || 'Could not save this MP3.'; $('#save-in-library').disabled = false; }
  };
  $('#save-download').onclick = () => {
    if (!file) return;
    if (!downloadURL) downloadURL = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = downloadURL; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    $('#save-progress-text').textContent = 'MP3 download requested. Check your browser’s downloads.';
  };
  $('#save-share').onclick = async () => {
    if (!file) return;
    try { if (typeof globalThis.WaveShareMP3 === 'function') await globalThis.WaveShareMP3(file); else await navigator.share({ files: [file], title: file.name }); }
    catch (error) { if (error.name !== 'AbortError') $('#save-progress-text').textContent = typeof globalThis.WaveShareMP3 === 'function' ? error.message || 'The iPhone could not share this file. Keep the MP3 in WAVE instead.' : 'Sharing is unavailable. Use Download MP3 instead.'; }
  };
  return {
    async open(id) {
      const track = engine.tracks.find(track => track.id === id);
      if (!track) { notify('Choose a saved track first.'); return; }
      if (transcoder.job) { notify('Finish or cancel the current conversion first.'); return; }
      release(); controller = new AbortController();
      const request = controller;
      $('#save-source').textContent = `${track.title} · ${track.artist}`;
      $('#save-progress-text').textContent = 'Preparing a real 192 kbps MP3…';
      $('#save-progress').value = 0; $('#save-progress').hidden = false;
      $('#save-ready').hidden = true;
      $('#save-in-library').disabled = false; $('#save-in-library').textContent = 'Keep MP3 in WAVE';
      if (!dialog.open) dialog.showModal();
      try {
        const source = await engine.getFile(id);
        request.signal.throwIfAborted();
        if (!source) throw new Error('The source file is unavailable. Import it again.');
        const output = await prepareMP3(source, { transcoder, fileName: track.fileName, signal: request.signal });
        request.signal.throwIfAborted();
        const name = `${track.artist || 'WAVE'} - ${track.title || 'Track'}`.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').slice(0, 150).trim();
        file = new File([output.blob], name + '.mp3', { type: 'audio/mpeg', lastModified: 0 });
        $('#save-progress').hidden = true; $('#save-ready').hidden = false;
        $('#save-file-info').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB · MP3 / ${output.original ? 'original quality' : '192 kbps'}`;
        $('#save-progress-text').textContent = 'Your MP3 is ready. Keep it in WAVE or save a separate file.';
        $('#save-download').hidden = /WAVE(?:Android|iOS)\//.test(navigator.userAgent);
        try { $('#save-share').hidden = typeof globalThis.WaveShareMP3 !== 'function' && !navigator.canShare?.({ files: [file] }); } catch { $('#save-share').hidden = true; }
      } catch (error) {
        if (controller !== request || request.signal.aborted) return;
        $('#save-progress').hidden = true;
        $('#save-progress-text').textContent = error.message || 'This track could not be converted to MP3.';
      }
    }
  };
}
