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
  const services: UpdateRouteServices = {
    jobs: [job], codebases: [cb], findCodebase: id => id === cb.id ? cb : undefined,
    uncommittedNow: unexpected, runBackup: unexpected, requestCodeUpdate: unexpected,
    addCodebase: unexpected, save: unexpected, startRetry: unexpected, git: unexpected,
    repoRoot: unexpected, patchPaths: unexpected, saveRestorePoint: unexpected, applyPatch: unexpected,
    recheckAfter: unexpected, restoreFromPoint: unexpected, now: unexpected,
    ideaSet: unexpected, generateIdeas: unexpected, saveIdeas: unexpected, findSameUpdate: unexpected,
    lastBackup: null, backingUp: false, busy: false, restartPending: false,
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
});
