import type { Bundle } from "./types";

// IndexedDB cache for the session bundle: refreshes hydrate instantly from the
// last-seen data (no boot screen) while the network copy revalidates in the
// background. All failures degrade to "no cache" -- private mode, quota, etc.

const DB_NAME = "iss-cache";
const STORE = "bundle";
const KEY = "latest";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCachedBundle(): Promise<Bundle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Bundle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveCachedBundle(bundle: Bundle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bundle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best effort
  }
}
