import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mayOverrideUpdateCheck, runReleaseGate, updateCheckIssue } from '../updateReleaseGate.ts';

test('dashboard release gate requires lint, tests and build to pass', async () => {
  const calls: string[] = [];
  const check = await runReleaseGate(async (script) => {
    calls.push(script);
    return { status: 0, out: '' };
  });
  assert.deepEqual(calls, ['lint', 'test', 'build']);
  assert.equal(check.ok, true);
  assert.equal(updateCheckIssue('hub', check), undefined);
});

test('each failed release step reports its command and output', async () => {
  for (const script of ['lint', 'test', 'build'] as const) {
    const check = await runReleaseGate(async (step) => ({
      status: step === script ? 1 : 0,
      out: step === script ? 'fixture error' : '',
    }));
    assert.equal(check.ok, false);
    assert.match(check.output, new RegExp(`npm (?:run )?${script}\\) failed.*exit code 1`));
    assert.match(check.output, /fixture error/);
    assert.match(updateCheckIssue('hub', check) ?? '', /failed/);
  }
});

test('a command that cannot complete fails the gate even without output', async () => {
  const check = await runReleaseGate(async (script) => ({
    status: script === 'build' ? null : 0,
    out: '',
  }));
  assert.equal(check.ok, false);
  assert.match(check.output, /Production build \(npm run build\) failed \(command did not complete\)/);
});

test('older dashboard updates need a new check result or an owner override', () => {
  assert.match(updateCheckIssue('hub') ?? '', /no dashboard release gate result/);
  const oldTypeCheck = { ok: true, output: 'Type check passed.' };
  assert.match(updateCheckIssue('hub', oldTypeCheck) ?? '', /no dashboard release gate result/);
  assert.equal(updateCheckIssue('another-codebase', oldTypeCheck), undefined);
  assert.equal(mayOverrideUpdateCheck(false, true), false);
  assert.equal(mayOverrideUpdateCheck(true, undefined), false);
  assert.equal(mayOverrideUpdateCheck(true, 'true'), false);
  assert.equal(mayOverrideUpdateCheck(true, true), true);
});
