import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'prospector';
const DB_VERSION = 5;
const STORES = ['properties', 'datasets', 'calls', 'requests', 'settings', 'audit', 'users', 'leads'];
const CHUNK = 2000;

class VaultDb {
  private db: IDBPDatabase | null = null;

  private async open(): Promise<IDBPDatabase> {
    if (this.db) return this.db;
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      },
    });
    return this.db;
  }

  async getAll(store: string): Promise<Record<string, unknown>[]> {
    const db = await this.open();
    return (await db.getAll(store)) as Record<string, unknown>[];
  }

  async putAll(
    store: string,
    byId: Record<string, Record<string, unknown>>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const db = await this.open();
    const entries = Object.entries(byId);
    for (let i = 0; i < entries.length; i += CHUNK) {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const chunk = entries.slice(i, i + CHUNK);
      for (const [key, value] of chunk) {
        await os.put(value, key);
      }
      await tx.done;
      onProgress?.(Math.min(i + CHUNK, entries.length), entries.length);
    }
  }

  async deleteAll(store: string, ids: string[]): Promise<void> {
    const db = await this.open();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const chunk = ids.slice(i, i + CHUNK);
      for (const id of chunk) {
        await os.delete(id);
      }
      await tx.done;
    }
  }
}

export const vaultDb = new VaultDb();
