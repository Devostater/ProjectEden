import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { packageState, proofFilesTouched, proofIssue, runProof, type ProofResult } from '../proof';
import { stopProcessTree } from '../processTree';

const command = (code: string) => `"${process.execPath}" -e "${code}"`;
const cwd = process.cwd();

test('proof records output, environment and exit code', async () => {
  const passed = await runProof(command("console.log('proof', process.env.CI, process.env.EDEN_PROOF)"), { cwd, minutes: 1 });
  assert.equal(passed.ok, true);
  assert.equal(passed.exitCode, 0);
  assert.match(passed.output, /proof 1 1/);
  const failed = await runProof(command("console.error('x'.repeat(7000) + 'failed'); process.exitCode = 1"), { cwd, minutes: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.output, /failed\s*$/);
  assert.equal(failed.output.length, 6000);
});

test('a proof timeout stops the shell and its grandchild', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'worker.cjs'), 'console.log(process.pid); setTimeout(() => {}, 60000);');
  fs.writeFileSync(path.join(dir, 'parent.cjs'), "require('node:child_process').spawn(process.execPath, ['worker.cjs'], { stdio: 'inherit' });");
  const result = await runProof(`"${process.execPath}" parent.cjs`, { cwd: dir, minutes: 0.05 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.output, /^Stopped: it was still running after 0\.05 minutes\./);
  const pid = Number(result.output.split('\n')[1]?.trim());
  assert.ok(pid > 0, result.output);
  const running = () => {
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        // A dead process can briefly remain in the table until its new parent reaps it.
        return !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
      }
      return true;
    } catch (err) {
      if (['ESRCH', 'ENOENT'].includes((err as NodeJS.ErrnoException).code || '')) return false;
      throw err;
    }
  };
  t.after(() => { if (running()) process.kill(pid); });
  for (let i = 0; i < 100 && running(); i++) await delay(50);
  assert.equal(running(), false);
});

test('a caller can stop a proof', async () => {
  const result = await runProof(command('setTimeout(() => {}, 60000)'), {
    cwd, minutes: 1, onChild: (child) => stopProcessTree(child),
  });
  assert.equal(result.ok, false);
  assert.equal(result.stopped, true);
  assert.match(result.output, /^Stopped before it finished\./);
});

test('proof script names match whole paths, ignoring case and slash direction', () => {
  assert.deepEqual(
    proofFilesTouched('pwsh -File ".\\Tools\\Build Proof.ps1" && Other\\check.cmd.bak', ['tools/Build Proof.ps1', 'Build Proof.ps1', 'other/check.cmd']),
    ['tools/Build Proof.ps1'],
  );
});

test('proof gate gives the first applicable reason', () => {
  const result: ProofResult = { command: 'build', ok: true, output: '', exitCode: 0, startedAt: '', finishedAt: '', head: 'one' };
  assert.equal(proofIssue({ job: { proofRunning: true } }), undefined);
  assert.equal(proofIssue({ proof: 'build', job: { proofRunning: true } }), 'The proof is still running.');
  assert.equal(proofIssue({ proof: 'build', job: { olderBase: 'other' } }), 'This update has no proof yet. Press "Run proof".');
  assert.equal(proofIssue({ proof: 'new', job: { proof: { ...result, ok: false } } }), 'The proof command changed after this proof ran. Run the proof again.');
  for (const [flags, reason] of [
    [{}, 'The proof did not pass.'],
    [{ stopped: true }, 'The proof was stopped.'],
    [{ timedOut: true }, 'The proof ran out of time.'],
  ] as const) {
    assert.equal(proofIssue({ proof: 'build', job: { proof: { ...result, ...flags, ok: false }, olderBase: 'other' } }), reason);
  }
  const changed = 'The code changed after this proof ran. Run the proof again.';
  assert.equal(proofIssue({ proof: 'build', head: 'one', job: { proof: result, olderBase: 'other' } }), changed);
  assert.equal(proofIssue({ proof: 'build', head: 'two', job: { proof: result } }), changed);
  assert.equal(proofIssue({ proof: 'build', job: { proof: { ...result, head: undefined } } }), changed);
  assert.equal(proofIssue({ proof: 'build', head: 'one', job: { proof: result } }), undefined);
});

test('package age compares the oldest package to source and skips every package', () => {
  const opts = {
    dir: 'plugin', pattern: 'dist\\*.zip', sourceFiles: ['dist/a.zip', 'dist/b.zip', 'source.cpp', 'deleted.cpp'],
    readFiles: () => ['b.zip', 'a.zip', 'ignore.txt'],
  };
  const times: Record<string, number> = { 'a.zip': 10, 'b.zip': 20, 'source.cpp': 10 };
  const fileTime = (file: string) => times[path.basename(file)];
  assert.deepEqual(packageState({ ...opts, fileTime }), { state: 'fresh', file: 'dist/a.zip' });
  times['source.cpp'] = 11;
  assert.deepEqual(packageState({ ...opts, fileTime }), { state: 'older', file: 'dist/a.zip', newer: 'source.cpp' });
  assert.deepEqual(packageState({ ...opts, readFiles: () => ['ignore.txt'], fileTime }), { state: 'missing' });
});
