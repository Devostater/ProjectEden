import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { ensureProjects, registerProjectRoutes } from '../server/routes/projects';
import { manualProviderFor } from '../src/grok';
import type { Agent, Card, Project } from '../src/types/index';

test('research cards route to Grok and pasted replies become handoff files', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-grok-'));
  const store: { agents: Agent[]; cards?: Card[]; projects?: Project[] } = { agents: [] };
  ensureProjects(store);
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, () => store, () => {}, folder);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    try {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const post = (route: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const created = await post('/api/cards', {
    projectId: store.projects![0].id, title: '../Launch Pricing?', column: 'ready', tags: ['Research'],
  });
  assert.equal(created.status, 200);
  const { card } = await created.json() as { card: Card };
  assert.equal(manualProviderFor(card.tags), 'grok');
  for (const tag of ['market', 'pricing', 'launch-copy']) assert.equal(manualProviderFor([tag]), 'grok');
  assert.equal(manualProviderFor(['engineering']), undefined);

  const route = `/api/cards/${card.id}/grok-reply`;
  const reply = '# Findings\n\nLaunch at $10.\n';
  const saved = await post(route, { reply });
  assert.equal(saved.status, 200);
  const result = await saved.json() as { path: string };
  assert.equal(path.dirname(result.path), folder);
  assert.match(path.basename(result.path), /^\d{4}-\d{2}-\d{2}-grok-launch-pricing\.md$/);
  assert.equal(fs.readFileSync(result.path, 'utf8'), reply);
  assert.equal(store.cards![0].column, 'review');
  assert.equal(store.cards![0].notes[0].text, reply);
  const duplicate = await post(route, { reply });
  assert.equal(duplicate.status, 409);
  await duplicate.json();
  assert.deepEqual(fs.readdirSync(folder), [path.basename(result.path)]);
});
