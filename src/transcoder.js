const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 12 * 60 * 1000;
// The standalone build injects lazy-decoded worker/core/WASM assets here.
const EMBEDDED_FFMPEG = /*__WAVE_FFMPEG__*/ null;

export class MediaTranscoder extends EventTarget {
  constructor() {
    super();
    this.job = null;
  }

  async convert(blob, { kind = 'video', fileName = 'media', signal } = {}) {
    if (!(blob instanceof Blob)) throw new TypeError('Select an audio or video file to convert.');
    if (!['audio', 'video'].includes(kind)) throw new TypeError('Choose audio or video conversion.');
    if (!blob.size) throw new Error('This file is empty.');
    if (blob.size > MAX_INPUT_BYTES) throw new Error('Local conversion supports files up to 256 MB. Convert larger files with a desktop converter.');
    if (this.job) throw new Error('Another conversion is running. Cancel it before starting a new one.');
    if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    if (typeof Worker === 'undefined') throw new Error('This browser does not support local conversion workers.');

    return new Promise((resolve, reject) => {
      const job = { worker: null, workerURL: null, timer: null, done: false, finish: null };
      this.job = job;
      const onAbort = () => job.finish(new DOMException('Conversion cancelled.', 'AbortError'));
      job.finish = (error, result) => {
        if (job.done) return;
        job.done = true;
        clearTimeout(job.timer);
        signal?.removeEventListener('abort', onAbort);
        job.worker?.terminate();
        if (job.workerURL) URL.revokeObjectURL(job.workerURL);
        if (this.job === job) this.job = null;
        if (error) reject(error);
        else resolve(result);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      job.timer = setTimeout(() => job.finish(new Error('Conversion timed out after 12 minutes. Try a shorter or smaller file.')), CONVERSION_TIMEOUT_MS);
      this.dispatchEvent(new CustomEvent('progress', { detail: { progress: 0, message: 'Preparing local converter…' } }));

      (async () => {
        const bytes = await blob.arrayBuffer();
        if (job.done) return;
        const base = new URL('./', document.baseURI);
        if (EMBEDDED_FFMPEG) {
          job.workerURL = URL.createObjectURL(new Blob([EMBEDDED_FFMPEG.workerSource], { type: 'text/javascript' }));
        }
        job.worker = new Worker(job.workerURL || new URL('src/transcoder-worker.js?v=2.0.0', base));
        job.worker.onerror = () => job.finish(new Error('The local converter could not start. Reload the player or use a recent browser.'));
        job.worker.onmessageerror = () => job.finish(new Error('The converter could not read this file in memory. Try a smaller file.'));
        job.worker.onmessage = ({ data }) => {
          if (job.done) return;
          if (data.type === 'progress') {
            this.dispatchEvent(new CustomEvent('progress', { detail: {
              progress: Math.max(0, Math.min(1, Number(data.progress) || 0)),
              message: String(data.message || 'Converting locally…')
            } }));
          } else if (data.type === 'result') {
            job.finish(null, new Blob([data.bytes], { type: kind === 'video' ? 'video/mp4' : 'audio/wav' }));
          } else if (data.type === 'error') job.finish(new Error(data.message || 'This file could not be converted.'));
        };
        job.worker.postMessage({
          type: 'convert', bytes, kind, fileName,
          coreURL: new URL('vendor/ffmpeg/ffmpeg-core.js', base).href,
          wasmURL: new URL('vendor/ffmpeg/ffmpeg-core.wasm', base).href,
          embedded: EMBEDDED_FFMPEG ? { coreSource: EMBEDDED_FFMPEG.coreSource, wasmBase64: EMBEDDED_FFMPEG.wasmBase64 } : null
        }, [bytes]);
      })().catch(error => job.finish(new Error(`Could not prepare local conversion: ${error.message || error}`)));
    });
  }

  cancel() {
    this.job?.finish(new DOMException('Conversion cancelled.', 'AbortError'));
  }
}
