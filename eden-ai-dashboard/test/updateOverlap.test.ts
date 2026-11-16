// Run with: npm run test:updates
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filesInDiff, recheckWaiting, type OverlapJob } from '../updateOverlap.ts';

const diffFor = (file: string, from: string, to: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

// A throwaway git repo with a.ts ("one") and b.ts ("two") committed.
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-overlap-'));
  const git = (args: string[], input?: string) => execFileSync('git', args, { cwd: dir, input, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.ts'), 'one\n');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'two\n');
  git(['add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start']);
  const fits = (diff: string) => {
    try {
      git(['apply', '--check', '-'], diff);
      return true;
    } catch {
      return false;
    }
  };
  return { dir, git, fits, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

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

test('with real git: apply A makes B stale, a disjoint C still needs a recheck', () => {
  const r = tempRepo();
  try {
    const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'ONE') };
    const B: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'uno') };
    const C: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO') };
    assert.ok(r.fits(A.diff!) && r.fits(B.diff!) && r.fits(C.diff!), 'all three fit before anything is applied');
    r.git(['apply', '-'], A.diff);
    A.status = 'applied';
    assert.deepEqual(recheckWaiting([A, B, C], A, r.fits), { stale: ['B'], refit: [], current: [], recheck: [{ id: 'C', sameFiles: false }] });
  } finally {
    r.done();
  }
});

test('with real git: Apply -> stale -> Undo clears the stale mark (review finding 2)', () => {
  const r = tempRepo();
  try {
    const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'ONE') };
    const B: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'uno') };
    r.git(['apply', '-'], A.diff);
    A.status = 'applied';
    const afterApply = recheckWaiting([A, B], A, r.fits);
    assert.deepEqual(afterApply.stale, ['B']);
    B.stale = true;
    r.git(['apply', '-R', '-'], A.diff); // Undo
    A.status = 'undone';
    assert.deepEqual(recheckWaiting([A, B], A, r.fits), { stale: [], refit: ['B'], current: [], recheck: [{ id: 'B', sameFiles: true }] });
  } finally {
    r.done();
  }
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

test('with real git: a path with a space is matched for the same-file warning', () => {
  const r = tempRepo();
  try {
    fs.writeFileSync(path.join(r.dir, 'my file.ts'), 'one\n');
    r.git(['add', '-A']);
    r.git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'space']);
    fs.writeFileSync(path.join(r.dir, 'my file.ts'), 'ONE\n');
    const realDiff = r.git(['diff']);
    r.git(['checkout', '--', '.']);
    assert.deepEqual(filesInDiff(realDiff), ['my file.ts']);
  } finally {
    r.done();
  }
});

test('Apply then Undo of A: an update checked before A counts as current again, not "check again"', () => {
  const r = tempRepo();
  try {
    const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'ONE'), baseApplied: [] };
    const C: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO'), baseApplied: [] };
    r.git(['apply', '-'], A.diff);
    A.status = 'applied';
    assert.deepEqual(recheckWaiting([A, C], A, r.fits, ['A']).recheck, [{ id: 'C', sameFiles: false }]);
    r.git(['apply', '-R', '-'], A.diff);
    A.status = 'undone';
    const afterUndo = recheckWaiting([A, C], A, r.fits, []);
    assert.deepEqual(afterUndo.current, ['C']);
    assert.deepEqual(afterUndo.recheck, []);
  } finally {
    r.done();
  }
});

test('an update made after A was applied still needs a recheck when A is undone', () => {
  const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'undone', diff: diffFor('a.ts', 'one', 'ONE') };
  const D: OverlapJob = { id: 'D', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO'), baseApplied: ['A'] };
  const res = recheckWaiting([A, D], A, () => true, []);
  assert.deepEqual(res.current, []);
  assert.deepEqual(res.recheck, [{ id: 'D', sameFiles: false }]);
});
