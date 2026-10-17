import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineLibrary } from '../src/online-library.js';

test('GitHub web app saves a bookmark without attempting a download, and reopens saved audio offline', async t => {
  const elements = new Map();
  const storage = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', hidden: false, open: false, handlers: {},
      addEventListener(name, handler) { this.handlers[name] = handler; },
      reset() {}, replaceChildren() {}, add() {}, focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close?.(); },
    });
    return elements.get(selector);
  };
  const globals = {
    document: { querySelector: element },
    location: { protocol: 'https:', hostname: 'daronthedragon.github.io' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async () => { downloads++; throw new Error('Unexpected download'); });
  let saved = null;
  let plays = 0;
  const library = createOnlineLibrary({
    pauseLocal() {}, playAudio() { assert.fail('A bookmark is not an audio file'); },
    async playSaved() { plays++; }, findSaved: () => saved,
    getPlaylists: () => [], onChange() {}, notify() {},
  });
  library.add('https://youtu.be/jNQXAC9IVRw');
  assert.equal(element('#link-submit').textContent, 'Save link');
  assert.equal(element('#link-destination').hidden, true);
  element('#link-form').handlers.submit({ preventDefault() {} });
  assert.equal(downloads, 0);
  assert.equal(element('#load-online-audio').hidden, true);
  assert.equal(element('#online-import-file').hidden, false);
  assert.match(element('#online-status').textContent, /cannot retrieve YouTube audio directly/);
  assert.equal(element('#online-source').href, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(JSON.parse(storage.get('wave-online-links'))[0].id, 'youtube:video:jNQXAC9IVRw');
  assert.match(library.entries()[1].subtitle, /Saved link/);
  saved = { title: 'Saved audio', storageState: 'persisted' };
  element('#online-player-dialog').close();
  await library.entries()[1].action();
  assert.equal(plays, 1);
  assert.equal(downloads, 0);
  assert.equal(element('#online-player-dialog').open, false);
});
