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
    { id: 'already-stale', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', '1', '3'), stale: true },
    { id: 'discarded', codebaseId: 'hub', status: 'discarded', diff: diffFor('a.ts', '1', '3') },
  ];
  assert.deepEqual(recheckWaiting(jobs, applied, () => false), { stale: [], olderBase: [] });
});

test('a waiting update that no longer fits is stale; one that fits but shares a file ran its checks on older code', () => {
  const applied: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'applied', diff: diffFor('a.ts', '1', '2') };
  const conflict: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', '1', '3') };
  const sameFile: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'z', 'q') };
  const elsewhere: OverlapJob = { id: 'D', codebaseId: 'hub', status: 'undone', diff: diffFor('b.ts', '1', '2') };
  const fits = (d: string) => d !== conflict.diff;
  assert.deepEqual(recheckWaiting([applied, conflict, sameFile, elsewhere], applied, fits), { stale: ['B'], olderBase: ['C'] });
});

test('with real git: after one update is applied, a second update of the same line no longer fits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-overlap-'));
  try {
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
    const A: OverlapJob = { id: 'A', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'ONE') };
    const B: OverlapJob = { id: 'B', codebaseId: 'hub', status: 'ready', diff: diffFor('a.ts', 'one', 'uno') };
    const C: OverlapJob = { id: 'C', codebaseId: 'hub', status: 'ready', diff: diffFor('b.ts', 'two', 'TWO') };
    assert.ok(fits(A.diff!) && fits(B.diff!) && fits(C.diff!), 'all three fit before anything is applied');
    git(['apply', '-'], A.diff);
    A.status = 'applied';
    assert.deepEqual(recheckWaiting([A, B, C], A, fits), { stale: ['B'], olderBase: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
