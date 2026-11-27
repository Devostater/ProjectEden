import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { createHub, registerHubRoutes, reelVideoPath, reelVideos, HUB_PROJECTS } from '../hub';

function workspace(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-hub-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reel = path.join(root, 'Reel');
  fs.mkdirSync(path.join(reel, 'projects', 'demo', 'out'), { recursive: true });
  fs.mkdirSync(path.join(reel, 'autopilot'), { recursive: true });
  fs.writeFileSync(path.join(reel, 'autopilot', 'TASKS.md'), '- [x] R1: one\n- [ ] R2: two\n');
  fs.writeFileSync(path.join(reel, 'projects', 'demo', 'out', 'final.mp4'), 'video');
  fs.writeFileSync(path.join(reel, 'projects', 'demo', 'out', 'frame.png'), 'image');
  return root;
}

function fakeSpawn(calls: { command: string; args: string[]; cwd?: string }[]) {
  return ((command: string, args: string[], opts: { cwd?: string }) => {
    calls.push({ command, args, cwd: opts?.cwd });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    return child;
  }) as any;
}

async function listen(t: TestContext, app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return 'http://127.0.0.1:' + address.port;
}

test('every AGENTS.md project is listed, and local-only ones are marked', () => {
  const ids = HUB_PROJECTS.map((p) => p.id);
  for (const id of ['eden', 'nova', 'lyra', 'levelgen', 'levelgen-docs', 'reel', 'deadz', 'passguard', 'syspulse', 'notes', 'devlog']) assert(ids.includes(id), id);
  for (const id of ['levelgen', 'reel', 'passguard', 'syspulse', 'devlog']) assert.equal(HUB_PROJECTS.find((p) => p.id === id)?.localOnly, true, id);
});

test('status reads folders, task progress and runner state', async (t) => {
  const root = workspace(t);
  const hub = createHub(root, { root: () => root, runnerStatus: () => ({ runners: [{ id: 'reel', state: 'Stopped' }] }) });
  const { projects } = await hub.status();
  const reel = projects.find((p) => p.id === 'reel')!;
  assert.equal(reel.exists, true);
  assert.deepEqual([reel.progress?.done, reel.progress?.total, reel.progress?.current?.id], [1, 2, 'R2']);
  assert.equal(reel.runner?.state, 'Stopped');
  assert.deepEqual(reel.launchers.map((l) => l.id), ['studio', 'music']);
  assert.equal(projects.find((p) => p.id === 'nova')!.exists, false);
});

test('Reel videos stay inside projects/<name>/out', (t) => {
  const root = workspace(t);
  const reel = path.join(root, 'Reel');
  assert.deepEqual(reelVideos(reel).map((v) => `${v.project}/${v.file}`), ['demo/final.mp4']);
  assert.equal(reelVideoPath(reel, 'demo', 'final.mp4'), path.join(reel, 'projects', 'demo', 'out', 'final.mp4'));
  for (const [p, f] of [['..', 'final.mp4'], ['demo', '..\\x.mp4'], ['demo', 'frame.png'], ['demo', '../../secret.mp4']]) assert.equal(reelVideoPath(reel, p, f), null, `${p}/${f}`);
});

test('a Reel step runs director hidden, one at a time, and waits for a runner in Reel', (t) => {
  const root = workspace(t);
  const calls: { command: string; args: string[]; cwd?: string }[] = [];
  let working: string[] = [];
  const hub = createHub(root, { root: () => root, spawn: fakeSpawn(calls), workingIn: () => working });
  assert.throws(() => hub.reelStep('demo', 'rm -rf'), /Choose a Reel step/);
  assert.throws(() => hub.reelStep('..', 'cut'), /Choose a Reel project/);
  working = ['Reel autopilot'];
  assert.throws(() => hub.reelStep('demo', 'cut'), /Wait for Reel autopilot/);
  working = [];
  hub.reelStep('demo', 'cut');
  assert.deepEqual(calls[0], { command: 'python', args: ['-m', 'director', 'cut', 'projects\\demo'], cwd: path.join(root, 'Reel') });
  assert.throws(() => hub.reelStep('demo', 'status'), /already running/);
  assert.equal(hub.reelStatus().step?.state, 'Running');
});

test('routes refuse other origins and serve videos only from this PC', async (t) => {
  const root = workspace(t);
  const app = express();
  app.use(express.json());
  registerHubRoutes(app, createHub(root, { root: () => root }));
  const base = await listen(t, app);
  const denied = await fetch(base + '/api/hub/status', { method: 'POST', headers: { origin: 'http://evil.example' } });
  assert.equal(denied.status, 403);
  const ok = await fetch(base + '/api/hub/reel', { method: 'POST', headers: { origin: base } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).videos.length, 1);
  const video = await fetch(base + '/api/hub/reel/video/demo/final.mp4');
  assert.equal(await video.text(), 'video');
  assert.equal((await fetch(base + '/api/hub/reel/video/demo/frame.png')).status, 404);
});
