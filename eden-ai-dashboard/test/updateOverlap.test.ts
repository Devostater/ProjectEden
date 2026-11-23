// Run with: npm run test:updates
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesInDiff, recheckWaiting, type OverlapJob } from '../updateOverlap.ts';

const diffFor = (file: string, from: string, to: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

test('filesInDiff lists every file, including both names of a rename', () => {
  const d = diffFor('a.ts', 'x', 'y') + 'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n';
  assert.deepEqual(filesInDiff(d).sort(), ['a.ts', 'new.ts', 'old.ts']);
});

test('only waiting updates of the same codebase are looked at', () => {
  const applied: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'applied', diff: diffFor('a.ts', '1', '2') };
  const jobs: OverlapJob[] = [
    applied,
    { id: 'other-codebase', codebaseId: 'lyra', status: 'ready', diff: diffFor('a.ts', '1', '3') },
    { id: 'queued', codebaseId: 'hub', status: 'queued' },
    { id: 'still-stale', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', '1', '3'), stale: true },
    { id: 'discarded', codebaseId: 'hub', status: 'discarded', diff: diffFor('a.ts', '1', '3') },
  ];
  assert.deepEqual(recheckWaiting(jobs, applied, () => false), { stale: [], refit: [], current: [], recheck: [] });
});

test('every waiting update that still fits needs its checks run again, even with no shared file', () => {
  // Review finding 1: a change to a shared type in another file can break an update that edits different files.
  const applied: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'applied', diff: diffFor('types.ts', '1', '2') };
  const conflict: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('types.ts', '1', '3') };
  const sameFile: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('types.ts', 'z', 'q') };
  const elsewhere: OverlapJob = { id: 'D', codebaseId: 'hub', status: 'undone', diff: diffFor('uses-types.ts', '1', '2') };
  const fits = (d: string) => d !== conflict.diff;
  assert.deepEqual(recheckWaiting([applied, conflict, sameFile, elsewhere], applied, fits), {
    stale: ['B'],
    refit: [],
    current: [],
    recheck: [
      { id: 'C', sameFiles: true },
      { id: 'D', sameFiles: false },
    ],
  });
});

test('filesInDiff reads quoted paths (spaces, quotes, non-ASCII) and unquoted paths with spaces', () => {
  const d = [
    String.raw`diff --git "a/my file.ts" "b/my file.ts"`,
    String.raw`diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"`,
    String.raw`diff --git "a/say \"hi\".ts" "b/say \"hi\".ts"`,
    'diff --git a/src/plain.ts b/src/plain.ts',
    'diff --git a/two words.ts b/two words.ts',
  ].join('\n');
  assert.deepEqual(filesInDiff(d).sort(), ['café.ts', 'my file.ts', 'say "hi".ts', 'src/plain.ts', 'two words.ts'].sort());
});

test('apply marks a conflicting update stale and undo restores its previous check status', () => {
  const applied: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'applied', diff: diffFor('my file.ts', 'one', 'ONE') };
  const conflict: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('my file.ts', 'one', 'uno') };
  const checked: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO'), baseApplied: [] };
  const jobs = [applied, conflict, checked];
  assert.deepEqual(recheckWaiting(jobs, applied, (diff) => diff !== conflict.diff, ['A']), {
    stale: ['B'], refit: [], current: [], recheck: [{ id: 'C', sameFiles: false }],
  });
  conflict.stale = true;
  applied.status = 'undone';
  assert.deepEqual(recheckWaiting(jobs, applied, () => true, []), {
    stale: [], refit: ['B'], current: ['C'], recheck: [{ id: 'B', sameFiles: true }],
  });
});

test('an update made after A was applied still needs a recheck when A is undone', () => {
  const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'undone', diff: diffFor('a.ts', 'one', 'ONE') };
  const D: OverlapJob = { id: 'D', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO'), baseApplied: ['A'] };
  const res = recheckWaiting([A, D], A, () => true, []);
  assert.deepEqual(res.current, []);
  assert.deepEqual(res.recheck, [{ id: 'D', sameFiles: false }]);
});
