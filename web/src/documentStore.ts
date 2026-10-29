/**
 * Where document files live. The server only keeps metadata and a `storage_ref`, so the backend can
 * change (device, server, or both) without touching the rest of the app.
 */
export interface StoredFile {
  blob: Blob;
  filename: string;
  mime: string;
}

export interface DocumentStore {
  readonly kind: "device";
  put(blob: Blob, filename: string): Promise<string>;
  get(ref: string): Promise<StoredFile | undefined>;
  remove(ref: string): Promise<void>;
}

const DB_NAME = "insuragent";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "ref" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = op(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Files stay in this browser (IndexedDB). Lost if the user clears site data or switches devices. */
const deviceStore: DocumentStore = {
  kind: "device",

  async put(blob, filename) {
    // Ask the browser not to evict our data under storage pressure (best effort; Safari may still).
    navigator.storage?.persist?.().catch(() => {});
    const ref = crypto.randomUUID();
    await tx("readwrite", (s) => s.put({ ref, blob, filename, mime: blob.type }));
    return ref;
  },

  async get(ref) {
    return tx<StoredFile | undefined>("readonly", (s) => s.get(ref));
  },

  async remove(ref) {
    await tx("readwrite", (s) => s.delete(ref));
  },
};

export const documentStore: DocumentStore = deviceStore;
