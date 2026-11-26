import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codebaseAI, followCodebaseAI, notSignedIn, readSettings, restoreHubSettings, savedHubSettings } from '../codebaseSettings';
import { diagnose, planFixAll, type FixableJob } from '../src/updateFixes';

test('a job that waited in the queue follows the AI setting as it is when it starts', () => {
  // Asked for while the codebase used Claude on this PC; the owner switched it to Codex before it started.
  const waiting: { codex?: boolean; local?: boolean; allowUnrealChanges?: boolean } = { local: true };
  followCodebaseAI(waiting, { ai: 'codex' });
  assert.deepEqual(waiting, { codex: true });

  // Switched back to Claude: the job is no longer a Codex job and loses the Codex-only Unreal permission.
  const codexJob = { codex: true, allowUnrealChanges: true };
  followCodebaseAI(codexJob, { ai: 'claude', unreal: true });
  assert.deepEqual(codexJob, {});

  // Still Codex and still an Unreal project: the per-job permission is kept. No longer Unreal: it is dropped.
  const unrealJob = { codex: true, allowUnrealChanges: true };
  followCodebaseAI(unrealJob, { ai: 'codex', unreal: true });
  assert.deepEqual(unrealJob, { codex: true, allowUnrealChanges: true });
  followCodebaseAI(unrealJob, { ai: 'codex' });
  assert.deepEqual(unrealJob, { codex: true });
});

test('the not-signed-in message names the AI and says a Codex job was not given to Claude', () => {
  assert.match(notSignedIn('codex'), /ChatGPT is not signed in/);
  assert.match(notSignedIn('codex'), /not given to Claude/);
  assert.match(notSignedIn('claude'), /Sign in to Claude/);
});

test('codebases use Claude unless Codex is explicitly saved', () => {
  assert.equal(codebaseAI({}), 'claude');
  for (const ai of ['claude', 'Codex', true, null]) assert.equal(codebaseAI({ ai }), 'claude');
  assert.equal(codebaseAI({ ai: 'codex' }), 'codex');
});

test('only valid AI and Unreal settings are accepted', () => {
  assert.deepEqual(readSettings({ ai: 'codex', unreal: true, dir: 'other' }), { ai: 'codex', unreal: true });
  assert.deepEqual(readSettings({ ai: 'claude', unreal: false }), { ai: 'claude', unreal: false });
  assert.deepEqual(readSettings({ dir: 'other' }), {});
  assert.throws(() => readSettings({ ai: 'other' }), /Choose Claude or Codex/);
  assert.throws(() => readSettings({ unreal: 'false' }), /must be on or off/);
});

test('the hub saves only its folder and non-default settings, and restores only the settings', () => {
  const hub = { id: 'hub', dir: 'built-in folder', check: 'tsc', protect: ['private'] };
  assert.deepEqual(savedHubSettings({ ...hub, ai: 'claude', unreal: false }), { id: 'hub', dir: hub.dir });
  const saved = savedHubSettings({ ...hub, ai: 'codex', unreal: true });
  assert.deepEqual(saved, { id: 'hub', dir: hub.dir, ai: 'codex', unreal: true });
  const edited = { ...saved, dir: 'old folder', check: 'node', protect: [] };
  assert.deepEqual(restoreHubSettings(hub, edited), { ...hub, ai: 'codex', unreal: true });
  assert.deepEqual(restoreHubSettings(hub), hub);
});

test('a Codex model error never offers a switch to Claude', () => {
  const job: FixableJob = {
    id: 'failed', request: 'Make a change', status: 'failed', createdAt: '2026-11-23T00:00:00Z',
    error: 'unrecognized_model', codex: true, codebaseId: 'fixture',
  };
  assert.notEqual(diagnose(job, [job])?.action, 'retryClaude');
  const localJob = { ...job, codex: false, local: true };
  assert.equal(diagnose(localJob, [localJob])?.action, 'retryClaude');
  const codebases = [{ id: 'fixture', ai: 'codex' }];
  const plan = planFixAll([localJob], Date.now(), false, true, codebases);
  assert.equal(plan.run, 1);
  assert.notEqual(plan.plan[0].fix.action, 'retryClaude');
  assert.equal(planFixAll([localJob], Date.now(), true, false, codebases).blocked, 1);
});
test('proof settings trim, clear and validate the saved values', () => {
  assert.deepEqual(readSettings({ proof: ' build.cmd ', proofMinutes: 240, packageFiles: ' dist\\*.zip ' }), {
    proof: 'build.cmd', proofMinutes: 240, packageFiles: 'dist\\*.zip',
  });
  assert.deepEqual(readSettings({ proof: ' ', proofMinutes: '', packageFiles: '' }), {
    proof: undefined, proofMinutes: undefined, packageFiles: undefined,
  });
  for (const proofMinutes of [0, 241, 1.5]) assert.throws(() => readSettings({ proofMinutes }), /1 to 240 whole minutes/);
  for (const packageFiles of ['../a.zip', 'dist/**.zip', 'dist*/a.zip', 'C:\\a.zip', '/a.zip']) {
    assert.throws(() => readSettings({ packageFiles }), /upload package path/);
  }
  assert.deepEqual(readSettings({ packageFrom: ' Plugins\\Kit ' }), { packageFrom: 'Plugins\\Kit' });
  assert.deepEqual(readSettings({ packageFrom: '' }), { packageFrom: undefined });
  for (const packageFrom of ['..\\Other', 'C:\\Kit', '/Kit', 'Plugins\\*', 7]) {
    assert.throws(() => readSettings({ packageFrom }), /folder the package is made from/);
  }
  assert.throws(() => readSettings({ proof: 'a\nb' }), /one line/);
  assert.throws(() => readSettings({ proof: 'a'.repeat(501) }), /500 characters/);
  assert.throws(() => readSettings({ proof: 'build.cmd' }, 'hub'), /type check, tests and build/);
});
