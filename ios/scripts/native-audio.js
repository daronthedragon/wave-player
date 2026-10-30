(() => {
  if (location.protocol !== 'capacitor:' || location.hostname !== 'localhost' || window.top !== window) return;
  const { Capacitor, registerPlugin } = capacitorExports;
  if (Capacitor.getPlatform() !== 'ios') return;
  const Audio = registerPlugin('WaveAudio');
  const limit = 64 * 1024 * 1024;
  let busy = false;
  window.WaveIOSImportAudio = async (url, { signal } = {}) => {
    if (busy) throw new Error('Wait for the current audio import to finish.');
    if (signal?.aborted) throw new DOMException('Audio import cancelled.', 'AbortError');
    busy = true;
    const token = crypto.randomUUID();
    let timedOut = false;
    const cancel = () => { void Audio.cancel({ token }).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; cancel(); }, 180000);
    try {
      const info = await Audio.importAudio({ url, token });
      if (info.token !== token || !Number.isInteger(info.size) || info.size < 1 || info.size > limit || info.type !== 'audio/mp4') {
        throw new Error('The iPhone importer returned invalid audio.');
      }
      const chunks = [];
      let offset = 0;
      while (offset < info.size) {
        if (signal?.aborted) throw new DOMException('Audio import cancelled.', 'AbortError');
        if (timedOut) throw new Error('Audio import timed out. Try again.');
        const { data } = await Audio.readChunk({ token, offset });
        if (typeof data !== 'string' || data.length > 350000) throw new Error('Invalid audio chunk.');
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        if (!bytes.length || bytes.length > 262144 || offset + bytes.length > info.size) throw new Error('Incomplete downloaded audio.');
        chunks.push(bytes);
        offset += bytes.length;
      }
      const name = String(info.name || 'YouTube audio.m4a').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 160);
      return new File(chunks, name, { type: info.type, lastModified: 0 });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Audio import cancelled.', 'AbortError');
      if (timedOut) throw new Error('Audio import timed out. Try again.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      await Audio.cleanup({ token }).catch(() => {});
      busy = false;
    }
  };
  window.WaveIOSImportAudio.providers = ['youtube'];
})();
