import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { spawn, SpawnOptions } from 'node:child_process';
import express from 'express';
import { createRunners, registerRunnerRoutes } from '../runners';
import { interruptedWork } from '../restartWork';

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
  const fakeSpawn = ((_executable: string, args: string[], options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { pid: 101 + spawned.length });
    spawned.push({ command: args[3], options, child });
    return child;
  }) as typeof spawn;
  const deps = { spawn: fakeSpawn, processNames: () => processes, killTree: (pid: number) => { killed.push(pid); } };
  const runners = createRunners(dir, deps);
  return { dir, runners, spawned, killed, processes, deps };
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
  const { runners, spawned } = fixture(t);
  assert.deepEqual(runners.runningNames(), []);
  runners.start('levelgen', undefined);
  assert.deepEqual(runners.runningNames(), ['LevelGen']);
  spawned[0].child.emit('exit', 0);
  assert.deepEqual(runners.runningNames(), []);
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
