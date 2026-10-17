/** Storage protection is optional; actual track writes are checked by PlayerEngine. */
export async function requestLibraryProtection(storage = globalThis.navigator?.storage) {
  try {
    if (await storage?.persisted?.()) return true;
    return Boolean(await storage?.persist?.());
  } catch { return false; }
}

export async function libraryStorageStatus(engine, storage = globalThis.navigator?.storage) {
  const saved = engine.tracks.filter(track => track.storageState === 'persisted').length;
  const temporary = engine.tracks.length - saved;
  let protectedStorage = false;
  let usage = null;
  try { protectedStorage = Boolean(await storage?.persisted?.()); } catch {}
  try { const estimate = await storage?.estimate?.(); if (Number.isFinite(estimate?.usage)) usage = estimate.usage; } catch {}
  return { saved, temporary, protectedStorage, usage, available: engine.storageAvailable };
}
