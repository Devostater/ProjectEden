import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { spawn, SpawnOptions } from 'node:child_process';
import express from 'express';
import { addRunnerToRegistry, createRunners, registerRunnerRoutes } from '../runners';
import { interruptedWork } from '../restartWork';
import { applying } from '../oneWriter';

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-runners-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entries = [
    { id: 'levelgen', name: 'LevelGen', cwd: dir, command: 'registered-levelgen', needsClosed: ['UnrealEditor.exe'], tasksFile: 'TASKS.md' },
    { id: 'swarm', name: 'Swarm', cwd: dir, command: 'registered-swarm', args: 'issueNumbers' },
  ];
  fs.writeFileSync(path.join(dir, '.eden-runners.json'), JSON.stringify({ maxRunners: 1, runners: entries }));
  const spawned: { command: string; options: SpawnOptions; child: EventEmitter }[] = [];
  const killed: number[] = [];
  const processes: string[] = [];
  const livePids = new Set<number>();
  const fakeSpawn = ((_executable: string, args: string[], options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { pid: 101 + spawned.length });
    spawned.push({ command: args[3], options, child });
    return child;
  }) as typeof spawn;
  const deps = { spawn: fakeSpawn, processNames: () => processes, killTree: (pid: number) => { killed.push(pid); }, lockProcessExists: (pid: number) => livePids.has(pid) };
  const runners = createRunners(dir, deps);
  return { dir, runners, spawned, killed, processes, deps, entries, livePids };
}

test('reads TASKS.md progress and truncates the first unfinished task', (t) => {
  const { dir, runners } = fixture(t);
  const title = 'Clear messages ' + 'a'.repeat(100);
  fs.writeFileSync(path.join(dir, 'TASKS.md'),
    ['# Tasks', '- [x] R13: Done', '- [!] **R14**: ' + title, '- [ ] R15: Later', 'Other text'].join('\r\n'));
  assert.deepEqual(runners.status(undefined).runners[0].progress, {
    done: 1, total: 3, current: { index: 2, id: 'R14', text: title.slice(0, 80) },
  });
});

test('a running prerequisite and the concurrency limit both refuse starts', (t) => {
  const { runners, spawned, processes } = fixture(t);
  processes.push('unrealeditor.exe');
  assert.throws(() => runners.start('levelgen', undefined), /Close UnrealEditor.exe/);
  assert.equal(spawned.length, 0);
  processes.pop();
  runners.start('levelgen', undefined);
  assert.throws(() => runners.start('swarm', undefined), /Only 1 runners can run/);
  assert.equal(spawned.length, 1);
});

test('stop uses the tree killer and keeps the slot until exit', (t) => {
  const { runners, spawned, killed } = fixture(t);
  runners.start('levelgen', undefined);
  assert.ok(runners.status(undefined).runners[0].startedAt);
  runners.stop('levelgen');
  assert.deepEqual(killed, [101]);
  assert.equal(runners.status(undefined).running, 1);
  spawned[0].child.emit('exit', 1);
  assert.equal(runners.status(undefined).running, 0);
  assert.equal(runners.status(undefined).runners[0].state, 'Stopped');
  assert.equal(runners.status(undefined).runners[0].exitCode, 1);
  runners.start('swarm', undefined);
});

test('running runners are named, so the hub can warn before a restart stops them', (t) => {
  const { dir, runners, spawned } = fixture(t);
  assert.deepEqual(runners.runningNames(), []);
  runners.start('levelgen', undefined);
  assert.deepEqual(runners.runningNames(), ['LevelGen']);
  assert.deepEqual(runners.workingIn(path.join(dir, 'child')), ['LevelGen']);
  spawned[0].child.emit('exit', 0);
  assert.deepEqual(runners.runningNames(), []);
  assert.deepEqual(runners.workingIn(dir), []);
});

test('live locks count as work but cannot be stopped from the hub', (t) => {
  const { dir, runners, entries, livePids, spawned, killed } = fixture(t);
  const registry = path.join(dir, '.eden-runners.json');
  const runnersWithLocks = [{ ...entries[0], lockFile: 'levelgen.lock' }, { ...entries[1], lockFile: 'swarm.lock' }];
  fs.writeFileSync(registry, JSON.stringify({ runners: runnersWithLocks }));
  fs.writeFileSync(path.join(dir, 'levelgen.lock'), JSON.stringify({ pid: 123, image: 'powershell.exe' }));
  fs.writeFileSync(path.join(dir, 'swarm.lock'), JSON.stringify({ pid: 124 }));
  livePids.add(123);
  assert.deepEqual(runners.workingIn(dir), ['LevelGen']);
  assert.equal(runners.status(undefined).runners[0].state, 'Running outside the hub');
  assert.equal(runners.status(undefined).runners[1].state, 'Stopped');
  assert.throws(() => runners.start('levelgen', undefined), /LevelGen is already running outside the hub/);
  assert.throws(() => runners.stop('levelgen'), /LevelGen was started outside the hub/);
  assert.equal(spawned.length, 0);
  assert.deepEqual(killed, []);
  fs.writeFileSync(registry, JSON.stringify({ runners: [{ ...entries[0], lockFile: 123 }] }));
  assert.throws(() => runners.status(undefined), /Invalid runner entry/);
});

test('start waits while the hub is applying an update in the folder', (t) => {
  const { dir, runners, spawned } = fixture(t);
  applying(dir, 'Fix the header', () => {
    assert.throws(() => runners.start('levelgen', undefined), {
      message: 'Wait: the hub is changing this folder right now (Fix the header). Start LevelGen when it is done.',
    });
    assert.equal(spawned.length, 0);
  });
  runners.start('levelgen', undefined);
  assert.equal(spawned.length, 1);
});

test('the restart warning lists code updates, cards and runners that would be cut off', () => {
  assert.deepEqual(interruptedWork({ working: [], queued: [] }, [], []), { codeUpdates: 0, cards: 0, runners: 0, interrupted: [] });
  assert.deepEqual(
    interruptedWork({ working: ['Fix the header'], queued: ['Add a filter'] }, ['"Store page" (Nova)'], ['LevelGen autopilot']),
    {
      codeUpdates: 2, cards: 1, runners: 1,
      interrupted: [
        'Code update being worked on: Fix the header',
        'Code update waiting in the queue: Add a filter',
        'Card being written: "Store page" (Nova)',
        'Runner still going: LevelGen autopilot',
      ],
    },
  );
  // With only a runner going, a restart must still be held back for the owner to confirm.
  assert.equal(interruptedWork({ working: [], queued: [] }, [], ['Reel autopilot']).interrupted.length, 1);
});

test('status restores an interrupted runner and returns the last 40 captured lines', (t) => {
  const { dir, runners, spawned, deps } = fixture(t);
  runners.start('levelgen', undefined);
  const lines = Array.from({ length: 50 }, (_, index) => 'line ' + (index + 1));
  fs.appendFileSync(path.join(dir, '.eden-logs', 'runners', 'levelgen.log'), lines.join('\n') + '\n');
  const afterRestart = createRunners(dir, deps);
  const status = afterRestart.status('levelgen');
  assert.equal(status.running, 0);
  assert.equal(status.runners[0].state, 'Stopped by restart');
  assert.equal(status.runners[0].log, lines.slice(-40).join('\n'));
  assert.equal(spawned.length, 1);
});

test('HTTP starts require the hub page and use only registry commands and issue numbers', async (t) => {
  const { runners, spawned } = fixture(t);
  const app = express();
  app.use(express.json());
  registerRunnerRoutes(app, runners);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = 'http://127.0.0.1:' + address.port;
  const start = (page: string, body: object) => fetch(origin + '/api/runners/start', {
    method: 'POST',
    headers: { origin: page, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await start('https://other.test', { id: 'swarm' })).status, 403);
  assert.equal((await start(origin, { id: 'swarm', args: '46 & injected-command' })).status, 400);
  assert.equal((await start(origin, { id: 'unknown', command: 'injected-command' })).status, 400);
  assert.equal(spawned.length, 0);
  assert.equal((await start(origin, { id: 'swarm', args: '46, 47', command: 'injected-command' })).status, 200);
  assert.equal(spawned[0].command, 'registered-swarm 46 47');
  assert.equal(spawned[0].options.windowsHide, true);
  assert.equal(spawned[0].options.shell, undefined);
});

test('runner registration preserves the registry and uses the same checks as status', (t) => {
  const { dir, entries, runners } = fixture(t);
  const file = path.join(dir, '.eden-runners.json');
  const entry = { id: 'skytools', name: 'Sky Tools autopilot', cwd: dir, command: 'run-plugin' };
  fs.unlinkSync(file);
  assert.equal(addRunnerToRegistry(dir, entry), 'added');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { maxRunners: 3, runners: [entry] });
  assert.equal(runners.status(undefined).runners[0].id, entry.id);

  const original = { maxRunners: 1, other: { enabled: true }, runners: [{ ...entries[0], extra: [1, 2] }, entries[1]] };
  fs.writeFileSync(file, JSON.stringify(original));
  assert.equal(addRunnerToRegistry(dir, entry), 'added');
  const updated = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(updated), { ...original, runners: [...original.runners, entry] });
  assert.deepEqual(runners.status(undefined).runners.map((runner) => runner.id), ['levelgen', 'swarm', 'skytools']);
  assert.equal(addRunnerToRegistry(dir, { ...entry, name: 'Another name' }), 'exists');
  assert.throws(() => addRunnerToRegistry(dir, { ...entry, id: 'Bad id' }), /Invalid runner entry/);
  assert.equal(fs.readFileSync(file, 'utf8'), updated);
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => addRunnerToRegistry(dir, entry), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});
