import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { applying, applyingIn, runnerHold, runnersWorkingIn, sameWorkFolder, setRunnerLookup } from '../oneWriter';

test('work folders match by path, containment or Git root', () => {
  const first = path.resolve('fixture', 'first');
  const second = path.resolve('fixture', 'second');
  const outside = path.resolve('fixture-other');
  const topLevel = (dir: string) => [first, second].includes(dir) ? path.dirname(first) : undefined;
  assert.equal(sameWorkFolder(first, first, topLevel), true);
  assert.equal(sameWorkFolder(path.join(first, 'child'), first, topLevel), true);
  assert.equal(sameWorkFolder(first, second, topLevel), true);
  assert.equal(sameWorkFolder(first, outside, topLevel), false);
  assert.equal(sameWorkFolder('C:/Work/Project', 'c:/work/PROJECT', topLevel), true);
});

test('the hold names every runner and handles a missing or failed lookup', (t) => {
  t.after(() => setRunnerLookup(undefined));
  assert.equal(runnerHold('fixture', 'Apply'), '');
  setRunnerLookup(() => { throw new Error('registry unavailable'); });
  assert.deepEqual(runnersWorkingIn('fixture'), []);
  setRunnerLookup(() => ['LevelGen autopilot']);
  assert.equal(runnerHold('fixture', 'Apply'), 'Apply is waiting: "LevelGen autopilot" is working in this folder. Stop it in Runners, or wait until it has finished.');
  setRunnerLookup(() => ['LevelGen autopilot', 'Swarm']);
  assert.equal(runnerHold('fixture', 'Undo'), 'Undo is waiting: "LevelGen autopilot" and "Swarm" are working in this folder. Stop them in Runners, or wait until they have finished.');
});

test('applying tracks the folder until the writer returns or fails', async () => {
  const dir = path.resolve('fixture');
  assert.equal(applying(dir, 'Small change', () => 42), 42);
  assert.throws(() => applying(dir, 'Small change', () => {
    assert.equal(applyingIn(path.join(dir, 'child')), 'Small change');
    throw new Error('write failed');
  }), /write failed/);
  assert.equal(applyingIn(dir), undefined);
  const pending = applying(dir, 'Sync', async () => { throw new Error('sync failed'); });
  assert.equal(applyingIn(dir), 'Sync');
  await assert.rejects(pending, /sync failed/);
  assert.equal(applyingIn(dir), undefined);
});
