import { ApiError } from './apiClient';

/**
 * A one-at-a-time upload queue, used by Master Search when an admin picks many
 * files at once.
 *
 * - Files go up strictly one after another, so a selection of hundreds never
 *   floods the server or the browser — only the File handles are held, and each
 *   is released once it is done.
 * - Obvious rejects are skipped before any upload: wrong type, Excel lock files
 *   (`~$…`), empty files, and names already loaded or already in the queue.
 * - A busy server (429) is waited out and retried; a network blip or a 5xx is
 *   retried a few times; anything else fails that one file and the queue moves
 *   on. A lost session (401/403) stops the queue — every later file would fail.
 * - The queue lives outside React, so it keeps going when the user switches to
 *   another page and back.
 */

export type QueueStatus = 'waiting' | 'uploading' | 'done' | 'skipped' | 'failed' | 'cancelled';

export interface QueueItem {
  id: number;
  name: string;
  size: number;
  status: QueueStatus;
  message?: string;
}

export interface QueueSnapshot {
  items: QueueItem[];
  running: boolean;
  /** Files uploaded successfully since the queue was last cleared. */
  done: number;
}

export interface UploadQueueDeps<F extends { name: string; size: number }, R> {
  upload: (file: F) => Promise<R>;
  /** A line for the finished row, e.g. "1,204 rows". */
  describe?: (result: R) => string;
  sleep?: (ms: number) => Promise<void>;
  /** Allowed extensions, lower case with the dot. */
  extensions: string[];
}

export const BUSY_WAIT_MS = 30_000;
export const MAX_BUSY_RETRIES = 20;
export const MAX_ERROR_RETRIES = 3;

const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
};
const keyOf = (name: string) => name.trim().toLowerCase();

export class UploadQueue<F extends { name: string; size: number }, R = unknown> {
  private items: QueueItem[] = [];
  private files = new Map<number, F>();
  private nextId = 1;
  private running = false;
  private abortCurrent = false;
  private done = 0;
  private snap: QueueSnapshot = { items: [], running: false, done: 0 };
  private listeners = new Set<() => void>();

  constructor(private readonly deps: UploadQueueDeps<F, R>) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): QueueSnapshot => this.snap;

  /**
   * Queue `files`. `loadedNames` are the files already on the server — those are
   * skipped up front rather than uploaded only to be refused.
   */
  add(files: F[], loadedNames: Iterable<string> = []): void {
    const taken = new Set<string>(Array.from(loadedNames, keyOf));
    for (const it of this.items) {
      if (it.status === 'waiting' || it.status === 'uploading' || it.status === 'done') taken.add(keyOf(it.name));
    }
    for (const file of files) {
      const id = this.nextId++;
      const name = file.name;
      const item: QueueItem = { id, name, size: file.size, status: 'waiting' };
      if (name.startsWith('~$')) {
        Object.assign(item, { status: 'skipped', message: 'Excel lock file — not a real spreadsheet' });
      } else if (!this.deps.extensions.includes(extOf(name))) {
        Object.assign(item, { status: 'skipped', message: `Not a spreadsheet — use ${this.deps.extensions.join(', ')}` });
      } else if (file.size === 0) {
        Object.assign(item, { status: 'skipped', message: 'The file is empty' });
      } else if (taken.has(keyOf(name))) {
        Object.assign(item, { status: 'skipped', message: 'A file with this name is already loaded or queued' });
      } else {
        taken.add(keyOf(name));
        this.files.set(id, file);
      }
      this.items.push(item);
    }
    this.emit();
    void this.pump();
  }

  /** Stop: every waiting file is cancelled; a file mid-upload finishes. */
  cancel(): void {
    this.abortCurrent = true;
    let changed = false;
    for (const it of this.items) {
      if (it.status === 'waiting') {
        it.status = 'cancelled'; it.message = undefined; this.files.delete(it.id); changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Drop the finished rows from the list (keeps anything waiting or uploading). */
  clearFinished(): void {
    this.items = this.items.filter(it => it.status === 'waiting' || it.status === 'uploading');
    this.done = 0;
    this.emit();
  }

  private emit(): void {
    this.snap = { items: this.items.map(it => ({ ...it })), running: this.running, done: this.done };
    this.listeners.forEach(fn => fn());
  }

  private patch(id: number, p: Partial<QueueItem>): void {
    const it = this.items.find(i => i.id === id);
    if (it) Object.assign(it, p);
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emit();
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    try {
      for (;;) {
        const item = this.items.find(i => i.status === 'waiting');
        if (!item) break;
        const file = this.files.get(item.id);
        if (!file) { this.patch(item.id, { status: 'cancelled' }); continue; }
        this.abortCurrent = false;
        this.patch(item.id, { status: 'uploading', message: undefined });

        let busyTries = 0;
        let errorTries = 0;
        for (;;) {
          try {
            const result = await this.deps.upload(file);
            this.done++;
            this.patch(item.id, { status: 'done', message: this.deps.describe?.(result) });
            break;
          } catch (e) {
            const status = e instanceof ApiError ? e.status : 0;
            const message = e instanceof Error && e.message ? e.message : 'Upload failed';
            let wait = 0;
            if (status === 429 && busyTries < MAX_BUSY_RETRIES) {
              busyTries++;
              wait = BUSY_WAIT_MS;
              this.patch(item.id, { message: `Server busy — retrying in ${Math.round(wait / 1000)}s` });
            } else if ((status === 0 || status >= 500) && errorTries < MAX_ERROR_RETRIES) {
              errorTries++;
              wait = 2000 * errorTries;
              this.patch(item.id, { message: `Upload interrupted — retry ${errorTries} of ${MAX_ERROR_RETRIES}…` });
            }
            if (wait > 0) {
              await sleep(wait);
              if (this.abortCurrent) { this.patch(item.id, { status: 'cancelled', message: undefined }); break; }
              continue;
            }
            if (status === 409) {
              this.patch(item.id, { status: 'skipped', message });
            } else if (status === 401 || status === 403) {
              this.patch(item.id, { status: 'failed', message });
              this.cancel(); // every later file would be refused the same way
            } else {
              this.patch(item.id, { status: 'failed', message });
            }
            break;
          }
        }
        this.files.delete(item.id);
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }
}
