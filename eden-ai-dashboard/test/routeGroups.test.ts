import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { registerConversationRoutes } from '../server/routes/chat';
import { createChatHistory } from '../server/routes/chats';
import { registerUpdateRoutes } from '../server/routes/updates';
import { readSettings } from '../codebaseSettings';
import type { Codebase, UpdateJob, UpdateRouteServices } from '../updates';

async function listen(t: TestContext, app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return 'http://127.0.0.1:' + address.port;
}

test('chat routes reopen saved history and validate conversation and model requests', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-chat-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const thread = { id: 'legacy', title: 'Saved chat', messages: [{ id: 'first', content: 'Hello' }], updatedAt: 1 };
  const file = path.join(root, '.eden-chats.json');
  fs.writeFileSync(file, JSON.stringify({ threads: [thread], version: 7 }));
  const modelFile = path.join(root, '.eden-chat-model.json');
  fs.writeFileSync(modelFile, JSON.stringify({ model: 'fixture-unavailable' }));
  const history = createChatHistory(file);
  const app = express();
  app.use(express.json());
  registerConversationRoutes(app, root, () => [], () => assert.fail('No agents to save'), history.appendToChat);
  history.registerChatRoutes(app);
  const base = await listen(t, app);
  assert.deepEqual(await (await fetch(base + '/api/chats')).json(), { threads: [thread], deleted: {}, version: 7 });
  assert.equal((await (await fetch(base + '/api/chat-model')).json()).model, 'fixture-unavailable');

  const headers = { 'content-type': 'application/json', origin: base };
  const invalid = await fetch(base + '/api/chat', { method: 'POST', headers, body: '{}' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'messages required' });

  const unavailable = await fetch(base + '/api/chat', {
    method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
  });
  assert.equal(unavailable.status, 200);
  assert.match((await unavailable.json()).replies[0].error, /fixture-unavailable isn't running/);

  const denied = await fetch(base + '/api/chat-model', {
    method: 'POST', headers: { ...headers, origin: 'https://example.test' }, body: '{"model":"online"}',
  });
  assert.equal(denied.status, 403);
  await denied.json();
  const changed = await fetch(base + '/api/chat-model', { method: 'POST', headers, body: '{"model":"online"}' });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { model: 'online' });
  assert.deepEqual(JSON.parse(fs.readFileSync(modelFile, 'utf8')), { model: 'online' });
});

test('update routes return a saved diff and enforce owner permissions and the apply gate', async (t) => {
  const cb: Codebase = {
    id: 'hub', name: 'Fixture hub', dir: 'unused', check: 'tsc',
    liveDirs: [], restartHint: 'restart', about: '', protect: [],
  };
  const job: UpdateJob = {
    id: 'saved', codebaseId: cb.id, status: 'ready', request: 'Fixture change',
    createdAt: '2026-11-23T00:00:00Z', log: [], diff: 'fixture patch',
  };
  const unexpected = () => assert.fail('The rejected update must not call the update worker');
  let proofLaneBusy = false;
  const services: UpdateRouteServices = {
    jobs: [job], codebases: [cb], findCodebase: id => id === cb.id ? cb : undefined,
    uncommittedNow: unexpected, runBackup: unexpected,
    requestCodeUpdate: (...args) => {
      assert.deepEqual(args, [cb.id, 'Make a change', undefined, false, { allowUnrealChanges: false }]);
      return 'new-job';
    },
    setCodebaseSettings: (id, body) => {
      assert.equal(id, cb.id);
      return Object.assign(cb, readSettings(body, id));
    },
    addCodebase: unexpected, save: unexpected, startRetry: unexpected, git: unexpected,
    currentHead: () => 'current', headNow: () => 'current', packageNow: unexpected,
    startProofAgain: unexpected, stopProof: () => false,
    repoRoot: unexpected, patchPaths: unexpected, saveRestorePoint: unexpected, applyPatch: unexpected,
    recheckAfter: unexpected, restoreFromPoint: unexpected, now: unexpected,
    ideaSet: unexpected, generateIdeas: unexpected, saveIdeas: unexpected, findSameUpdate: unexpected,
    lastBackup: null, backingUp: false, get busy() { return proofLaneBusy; }, restartPending: false,
    markRestartPending: unexpected, onApplied: unexpected,
    appDir: cb.dir, backupBranch: 'fixture', ideasMaxAge: 0, sameIdeaBusy: [],
  };
  const app = express();
  app.use(express.json());
  registerUpdateRoutes(app, services);
  const base = await listen(t, app);
  const diff = await fetch(base + '/api/updates/saved/diff');
  assert.equal(diff.status, 200);
  assert.deepEqual(await diff.json(), { diff: job.diff });
  const missingIdea = await fetch(base + '/api/updates/ideas?codebaseId=missing');
  assert.equal(missingIdea.status, 404);
  assert.deepEqual(await missingIdea.json(), { error: 'Unknown codebase.' });

  const apply = (origin: string) => fetch(base + '/api/updates/saved/apply', { method: 'POST', headers: { origin } });
  const denied = await apply('https://example.test');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'Code updates are only available on the computer running the hub.' });
  const blocked = await apply(base);
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /no dashboard release gate result/);
  assert.equal(job.status, 'ready');

  const post = (url: string, body: unknown, origin = base) => fetch(base + url, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
  });
  const settingsUrl = '/api/codebases/hub/settings';
  const deniedSettings = await post(settingsUrl, { ai: 'codex' }, 'https://example.test');
  assert.equal(deniedSettings.status, 403);
  assert.deepEqual(await deniedSettings.json(), { error: 'Codebase settings can only be changed from the hub on this computer.' });

  const list = async () => (await (await fetch(base + '/api/updates')).json()).codebases;
  assert.equal((await list())[0].ai, 'claude');
  const invalid = await post(settingsUrl, { ai: 'other' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Choose Claude or Codex/);
  const started = await post('/api/updates', { request: 'Make a change', codex: true });
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), { job: { id: 'new-job' } });
  const saved = await post(settingsUrl, { ai: 'codex', unreal: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, codebase: { id: 'hub', ai: 'codex', unreal: true, proofMinutes: 30 } });
  assert.equal((await list())[0].ai, 'codex');

  cb.id = job.codebaseId = 'plugin';
  cb.proof = 'build.cmd';
  proofLaneBusy = true;
  const proofBlocked = await apply(base);
  assert.equal(proofBlocked.status, 409);
  assert.deepEqual(await proofBlocked.json(), { error: 'This update has no proof yet. Press "Run proof". Apply is waiting for the proof.' });
  const busy = await post('/api/updates/saved/proof', {});
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), { error: 'Another update is running. Run the proof again when it has finished.' });
  const stop = await post('/api/updates/saved/proof/stop', {});
  assert.equal(stop.status, 400);
  assert.deepEqual(await stop.json(), { error: 'There is no proof running for this update.' });
});
