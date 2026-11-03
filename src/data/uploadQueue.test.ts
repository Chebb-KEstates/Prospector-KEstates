import { UploadQueue, QueueSnapshot, MAX_ERROR_RETRIES } from './uploadQueue';
import { ApiError } from './apiClient';

type F = { name: string; size: number };
const file = (name: string, size = 10): F => ({ name, size });
const EXT = ['.xlsx', '.xls', '.xlsm', '.csv'];

/** Resolves once the queue has gone idle. */
function idle(q: UploadQueue<F, any>): Promise<QueueSnapshot> {
  return new Promise(resolve => {
    const check = () => { const s = q.getSnapshot(); if (!s.running) { off(); resolve(s); } };
    const off = q.subscribe(check);
    check();
  });
}
const statuses = (s: QueueSnapshot) => s.items.map(i => `${i.name}:${i.status}`);

test('uploads strictly one at a time, in order', async () => {
  let inFlight = 0, maxInFlight = 0;
  const order: string[] = [];
  const q = new UploadQueue<F, { rows: number }>({
    extensions: EXT,
    upload: async f => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      order.push(f.name); inFlight--;
      return { rows: 3 };
    },
    describe: r => `${r.rows} rows`,
  });
  const many = Array.from({ length: 250 }, (_, i) => file(`f${i}.xlsx`));
  q.add(many);
  const s = await idle(q);
  expect(maxInFlight).toBe(1);
  expect(order).toEqual(many.map(f => f.name));
  expect(s.done).toBe(250);
  expect(s.items.every(i => i.status === 'done' && i.message === '3 rows')).toBe(true);
});

test('skips bad types, lock files, empty files and duplicate names before uploading', async () => {
  const sent: string[] = [];
  const q = new UploadQueue<F>({ extensions: EXT, upload: async f => { sent.push(f.name); return {}; } });
  q.add([
    file('ok.xlsx'), file('notes.pdf'), file('~$ok.xlsx'), file('empty.csv', 0),
    file('OK.XLSX'), file('loaded.csv'), file('b.CSV'),
  ], ['Loaded.csv']);
  const s = await idle(q);
  expect(sent).toEqual(['ok.xlsx', 'b.CSV']);
  expect(statuses(s)).toEqual([
    'ok.xlsx:done', 'notes.pdf:skipped', '~$ok.xlsx:skipped', 'empty.csv:skipped',
    'OK.XLSX:skipped', 'loaded.csv:skipped', 'b.CSV:done',
  ]);
});

test('one bad file fails alone; the rest carry on', async () => {
  const q = new UploadQueue<F>({
    extensions: EXT,
    upload: async f => {
      if (f.name === 'bad.xlsx') throw new ApiError(422, 'unprocessable', 'No rows found in that file.');
      if (f.name === 'dup.xlsx') throw new ApiError(409, 'conflict', 'Already loaded.');
      return {};
    },
  });
  q.add([file('a.xlsx'), file('bad.xlsx'), file('dup.xlsx'), file('c.xlsx')]);
  const s = await idle(q);
  expect(statuses(s)).toEqual(['a.xlsx:done', 'bad.xlsx:failed', 'dup.xlsx:skipped', 'c.xlsx:done']);
  expect(s.items[1].message).toBe('No rows found in that file.');
});

test('a busy server (429) is waited out and retried', async () => {
  let calls = 0;
  const waits: number[] = [];
  const q = new UploadQueue<F>({
    extensions: EXT,
    sleep: async ms => { waits.push(ms); },
    upload: async () => { if (++calls <= 2) throw new ApiError(429, 'rate_limited', 'Too many'); return {}; },
  });
  q.add([file('a.xlsx')]);
  const s = await idle(q);
  expect(statuses(s)).toEqual(['a.xlsx:done']);
  expect(waits).toEqual([30_000, 30_000]);
});

test('network errors and 5xx retry a few times, then fail that file', async () => {
  let calls = 0;
  const q = new UploadQueue<F>({
    extensions: EXT,
    sleep: async () => {},
    upload: async f => {
      if (f.name === 'flaky.xlsx') { calls++; throw new TypeError('Failed to fetch'); }
      return {};
    },
  });
  q.add([file('flaky.xlsx'), file('next.xlsx')]);
  const s = await idle(q);
  expect(calls).toBe(1 + MAX_ERROR_RETRIES);
  expect(statuses(s)).toEqual(['flaky.xlsx:failed', 'next.xlsx:done']);
});

test('a lost session stops the queue', async () => {
  const sent: string[] = [];
  const q = new UploadQueue<F>({
    extensions: EXT,
    upload: async f => { sent.push(f.name); throw new ApiError(401, 'unauthenticated', 'Signed out'); },
  });
  q.add([file('a.xlsx'), file('b.xlsx'), file('c.xlsx')]);
  const s = await idle(q);
  expect(sent).toEqual(['a.xlsx']);
  expect(statuses(s)).toEqual(['a.xlsx:failed', 'b.xlsx:cancelled', 'c.xlsx:cancelled']);
});

test('cancel stops the waiting files; the one uploading finishes', async () => {
  let release!: () => void;
  const q = new UploadQueue<F>({
    extensions: EXT,
    upload: f => (f.name === 'a.xlsx' ? new Promise(r => { release = () => r({}); }) : Promise.resolve({})),
  });
  q.add([file('a.xlsx'), file('b.xlsx'), file('c.xlsx')]);
  await Promise.resolve();
  q.cancel();
  release();
  const s = await idle(q);
  expect(statuses(s)).toEqual(['a.xlsx:done', 'b.xlsx:cancelled', 'c.xlsx:cancelled']);
});

test('files added while running join the same queue; clearFinished keeps active rows', async () => {
  let release!: () => void;
  const sent: string[] = [];
  const q = new UploadQueue<F>({
    extensions: EXT,
    upload: f => {
      sent.push(f.name);
      return f.name === 'a.xlsx' ? new Promise(r => { release = () => r({}); }) : Promise.resolve({});
    },
  });
  q.add([file('a.xlsx')]);
  await Promise.resolve();
  q.add([file('a.xlsx'), file('b.xlsx')]); // a is mid-upload → the second copy is skipped
  q.clearFinished();
  expect(statuses(q.getSnapshot())).toEqual(['a.xlsx:uploading', 'b.xlsx:waiting']);
  release();
  const s = await idle(q);
  expect(sent).toEqual(['a.xlsx', 'b.xlsx']);
  expect(statuses(s)).toEqual(['a.xlsx:done', 'b.xlsx:done']);
});
