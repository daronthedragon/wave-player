/* Installed only into the packaged iOS main frame, after the pinned Capacitor core. */
(() => {
  if (location.protocol !== 'capacitor:' || location.hostname !== 'localhost' || window.top !== window) return;
  const { Capacitor, registerPlugin } = capacitorExports;
  if (Capacitor.getPlatform() !== 'ios') return;
  const Filesystem = registerPlugin('Filesystem');
  const Share = registerPlugin('Share');
  let busy = false;
  window.WaveShareMP3 = async file => {
    if (!(file instanceof File) || file.type !== 'audio/mpeg' || !/\.mp3$/i.test(file.name) || !file.size) throw new Error('Choose a converted MP3 file to share.');
    if (file.size > 64 * 1024 * 1024) throw new Error('iPhone sharing supports MP3 files up to 64 MB. Keep larger files in WAVE.');
    if (busy) throw new Error('Finish the current share first.');
    busy = true;
    const name = file.name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').slice(0, 120).replace(/\.mp3$/i, '') + '.mp3';
    const path = `wave-export/wave-${crypto.randomUUID()}-${name}`;
    try {
      // Only our disposable MP3 export folder is read. Remove leftovers from
      // an earlier app termination; original media lives in IndexedDB.
      try {
        const previous = await Filesystem.readdir({ path: 'wave-export', directory: 'CACHE' });
        for (const item of previous.files || []) {
          if (/^wave-[a-f0-9-]{36}-[^/\\]+\.mp3$/.test(item.name)) await Filesystem.deleteFile({ path: `wave-export/${item.name}`, directory: 'CACHE' }).catch(() => {});
        }
      } catch { /* First export has no temporary directory yet. */ }
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read this MP3 for sharing.'));
        reader.readAsDataURL(file);
      });
      const saved = await Filesystem.writeFile({ path, directory: 'CACHE', data, recursive: true });
      if (!String(saved.uri).startsWith('file://')) throw new Error('The iPhone returned an invalid temporary file.');
      await Share.share({ title: file.name, files: [saved.uri], dialogTitle: 'Save MP3' });
    } catch (error) {
      if (/cancel/i.test(String(error?.message || ''))) throw new DOMException('Share cancelled.', 'AbortError');
      throw error;
    } finally {
      await Filesystem.deleteFile({ path, directory: 'CACHE' }).catch(() => {});
      busy = false;
    }
  };
})();
