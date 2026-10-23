import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../editor-save.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('flush waits for a save that is already running', async () => {
  const gate = deferred();
  const written = [];
  const q = new SaveQueue(async (s) => {
    if (s.id === 'A') await gate.promise;
    written.push(s.id);
  });
  q.schedule({ id: 'A' });
  const first = q.flush(); // e.g. the autosave timer firing
  let done = false;
  const second = q.flush().then(() => { done = true; }); // e.g. switching captures
  await Promise.resolve();
  assert.equal(done, false, 'second flush must not finish before the running save');
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(written, ['A']);
});

test('edits made to one capture while another loads are still saved', async () => {
  // Capture A is shown and edited; the editor starts switching to B,
  // A is edited again before B finishes loading, then B is edited.
  const written = [];
  const q = new SaveQueue(async (s) => { written.push(`${s.id}:${s.objects.length}`); }, 10_000);
  const docA = { id: 'A', objects: [1] };
  q.schedule(docA);
  await q.flush(); // open(B) flushes first
  q.schedule({ id: 'A', objects: [1, 2] }); // edit to A during B's load
  q.schedule({ id: 'B', objects: [9] }); // B loaded and edited
  await q.flush();
  assert.deepEqual(written, ['A:1', 'A:2', 'B:1']);
});

test('saves run in order and use the snapshot given, not later state', async () => {
  const seen = [];
  const q = new SaveQueue(async (s) => { seen.push(s.objects.join(',')); });
  const state = { id: 'A', objects: ['x'] };
  q.schedule({ ...state, objects: [...state.objects] });
  state.objects.push('y'); // later change to live state
  await q.flush();
  assert.deepEqual(seen, ['x']);
});

test('dropped captures are not saved', async () => {
  const written = [];
  const q = new SaveQueue(async (s) => { written.push(s.id); });
  q.schedule({ id: 'A' });
  q.schedule({ id: 'B' });
  q.drop('A');
  await q.flush();
  assert.deepEqual(written, ['B']);
});

test('a failed save does not stop later ones', async () => {
  const written = [];
  const q = new SaveQueue(async (s) => {
    if (s.id === 'A') throw new Error('disk full');
    written.push(s.id);
  });
  q.schedule({ id: 'A' });
  await q.flush();
  q.schedule({ id: 'B' });
  await q.flush();
  assert.deepEqual(written, ['B']);
});
