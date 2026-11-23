import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { registerHunterGuard } from '../hunterGuard';
import { ensureProjects, registerProjectRoutes } from '../server/routes/projects';
import { workspaceStore } from '../server/workspaceStore';

test('project routes reopen and update the existing workspace JSON layout', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-workspace-'));
  const file = path.join(root, '.nexusflow-store.json');
  const saved = {
    agents: [{ id: 'custom-agent', model: 'custom-model', totalRuns: 17 }],
    pipelines: [{ id: 'custom-pipeline' }],
    files: [], swarmRuns: [], usageLogs: [], cards: [],
    projects: [{ id: 'saved-project', name: 'Saved project', status: 'active', color: '#888' }],
  };
  fs.writeFileSync(file, JSON.stringify(saved));

  const disk = workspaceStore(file);
  const state = disk.load();
  if (ensureProjects(state)) disk.save(state);
  const app = express();
  const externalGuard = t.mock.method(fs, 'existsSync', () => false);
  registerHunterGuard(app, root);
  externalGuard.mock.restore();
  app.use(express.json());
  registerProjectRoutes(app, () => state, () => disk.save(state));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = 'http://127.0.0.1:' + address.port + '/api/projects';
  const before = await fetch(url);
  assert.equal(before.status, 200);
  assert.equal((await before.json()).projects.find((project: { id: string }) => project.id === 'saved-project').name, 'Saved project');

  const denied = await fetch(url, { method: 'POST', headers: { origin: 'https://other.example' } });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'Not allowed from another site.' });

  const updated = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'saved-project', name: 'Renamed project' }),
  });
  assert.equal(updated.status, 200);
  await updated.json();
  const created = await fetch(new URL('/api/cards', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'saved-project', title: 'Verify route extraction' }),
  });
  assert.equal(created.status, 200);
  const { card } = await created.json();
  const reopened = workspaceStore(file).load();
  assert.equal(reopened.cards?.find(item => item.id === card.id)?.title, 'Verify route extraction');
  assert.equal(reopened.projects?.find(project => project.id === 'saved-project')?.name, 'Renamed project');
  assert.deepEqual(reopened.agents.find(agent => agent.id === 'custom-agent'), saved.agents[0]);
  assert.deepEqual(reopened.pipelines.find(pipeline => pipeline.id === 'custom-pipeline'), saved.pipelines[0]);
});
