/* Classic worker: FFmpeg runs locally, single-threaded, without cross-origin isolation. */
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
let active = false;

self.onmessage = async ({ data }) => {
  if (data.type !== 'convert' || active) return;
  active = true;
  let core;
  let coreBlobURL;
  const logs = [];
  const progress = (value, message) => self.postMessage({ type: 'progress', progress: value, message });
  try {
    if (!(data.bytes instanceof ArrayBuffer) || !data.bytes.byteLength || data.bytes.byteLength > MAX_INPUT_BYTES) throw new Error('Select a non-empty file no larger than 256 MB.');
    if (!['audio', 'video'].includes(data.kind)) throw new Error('Unsupported conversion type.');
    progress(0, 'Loading the local media converter…');
    const config = {};
    let coreURL = data.coreURL;
    if (data.embedded) {
      coreBlobURL = URL.createObjectURL(new Blob([data.embedded.coreSource], { type: 'text/javascript' }));
      coreURL = coreBlobURL;
      const binary = atob(data.embedded.wasmBase64);
      const wasm = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) wasm[i] = binary.charCodeAt(i);
      config.wasmBinary = wasm;
    }
    importScripts(coreURL);
    config.mainScriptUrlOrBlob = `${coreURL}#${btoa(JSON.stringify({ wasmURL: data.wasmURL }))}`;
    core = await self.createFFmpegCore(config);
    core.setLogger(({ message }) => { logs.push(String(message)); if (logs.length > 12) logs.shift(); });
    core.setProgress(({ progress: value }) => progress(Math.max(0, Math.min(0.99, value || 0)), 'Converting on your device…'));
    const extension = String(data.fileName || '').match(/\.([a-zA-Z0-9]{1,10})$/)?.[1] || 'bin';
    const input = `input.${extension}`;
    const output = data.kind === 'video' ? 'output.mp4' : 'output.wav';
    core.FS.writeFile(input, new Uint8Array(data.bytes));
    progress(0.01, 'Converting on your device…');
    const args = data.kind === 'video'
      ? ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]
      : ['-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', output];
    core.setTimeout(10 * 60 * 1000);
    core.exec(...args);
    if (core.ret !== 0) throw new Error(logs.slice(-5).join('\n') || 'The codec is unsupported or the file is damaged.');
    const bytes = core.FS.readFile(output);
    if (!bytes.byteLength) throw new Error('The converted file is empty.');
    if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error('The converted file is too large for this browser. Try a shorter source file.');
    progress(1, 'Conversion complete.');
    self.postMessage({ type: 'result', bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    const detail = String(error?.message || error);
    const memoryError = /memory|out of bounds|allocation|Aborted/i.test(detail);
    self.postMessage({ type: 'error', message: memoryError ? 'This file needs more memory than the browser can provide. Try a smaller or shorter file.' : `Could not convert this file. It may be damaged, encrypted, unsupported, or too complex. ${detail.slice(0, 600)}` });
  } finally {
    if (coreBlobURL) URL.revokeObjectURL(coreBlobURL);
    // The main thread terminates this worker after result/error, releasing WASM memory.
  }
};
