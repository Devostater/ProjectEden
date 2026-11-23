import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Agent, Card, Project } from '../src/types/index';

test('spending controls cover chat, cards, swarm teammates and tablet chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-spending-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.dirname(fileURLToPath(new URL('../providers.ts', import.meta.url)));
  const fixturePath = (file: fs.PathLike) =>
    typeof file === 'string' && path.dirname(file) === appDir && path.basename(file).startsWith('.eden-')
      ? path.join(root, path.basename(file))
      : file;
  const { readFileSync, writeFileSync, renameSync, rmSync } = fs;
  t.mock.method(fs, 'readFileSync', (file: fs.PathLike, options?: unknown) =>
    Reflect.apply(readFileSync, fs, [fixturePath(file), options]));
  t.mock.method(fs, 'writeFileSync', (file: fs.PathLike, ...args: unknown[]) =>
    Reflect.apply(writeFileSync, fs, [fixturePath(file), ...args]));
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) =>
    renameSync(fixturePath(from), fixturePath(to)));
  t.mock.method(fs, 'rmSync', (file: fs.PathLike, options?: fs.RmOptions) =>
    rmSync(fixturePath(file), options));
  t.mock.method(os, 'homedir', () => root);

  const keys = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'CHATGPT_DAILY_LIMIT', 'GEMINI_DAILY_LIMIT'];
  const savedEnv = keys.map(key => [key, process.env[key]] as const);
  t.after(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.ANTHROPIC_API_KEY = 'fake-alternate';
  process.env.GEMINI_API_KEY = 'fake-tablet';
  process.env.OPENAI_API_KEY = 'fake-paid';
  process.env.CHATGPT_DAILY_LIMIT = '1';
  process.env.GEMINI_DAILY_LIMIT = '1';

  const sessions = path.join(root, '.codex', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'fake.jsonl'), JSON.stringify({
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    payload: { rate_limits: { primary: { used_percent: 5, resets_at: Date.now() / 1000 + 1800 } } },
  }) + '\n');

  const nativeFetch = globalThis.fetch;
  let ollamaUp = true;
  let paidCalls = 0;
  let localReplies = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const endpoint = new URL(url);
    if (endpoint.port === '11434') {
      if (!ollamaUp) throw new Error('Fake Ollama is stopped');
      if (endpoint.pathname === '/v1/models') return Response.json({ data: [{ id: 'fixture:4b' }] });
      assert.equal(endpoint.pathname, '/api/chat');
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.model, 'fixture:4b');
      assert.match(sent.messages.at(-1).content, /fixture/i);
      localReplies++;
      return Response.json({ message: { content: 'Local fixture reply' }, eval_count: 4 });
    }
    if (endpoint.hostname === 'api.openai.com') {
      paidCalls++;
      return Response.json({ choices: [{ message: { content: 'Paid fixture reply' } }], usage: { total_tokens: 5 } });
    }
    if (endpoint.hostname === 'generativelanguage.googleapis.com') {
      paidCalls++;
      return Response.json({ error: { code: 429, message: 'Fake quota exhausted' } }, { status: 429 });
    }
    if (endpoint.hostname === 'www.gstatic.com') return new Response(null, { status: 204 });
    if (endpoint.hostname === '127.0.0.1') return nativeFetch(url, init);
    assert.fail('Unexpected outbound request');
  });

  const { generate, refreshProviderStatus, replyToTabletChat, withSpendingNotice } = await import('../providers');
  const { askTeammate, startCardRunner } = await import('../cardRunner');
  const { registerConversationRoutes } = await import('../server/routes/chat');
  const { registerTabletChat } = await import('../tabletChat');
  const app = express();
  app.use(express.json());
  registerConversationRoutes(app, root, () => [], () => {}, () => {});
  registerTabletChat(app, replyToTabletChat);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const chat = (uri: string) => fetch(base + uri, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-fixture', messages: [{ role: 'user', content: 'Fixture question' }] }),
  });

  await t.test('parallel requests consume one remaining daily slot, then chat shows the local fallback', async () => {
    const results = await Promise.all([
      generate({ model: 'gpt-fixture', prompt: 'Fixture one' }),
      generate({ model: 'gpt-fixture', prompt: 'Fixture two' }),
    ]);
    assert.deepEqual(results.map(r => r.provider).sort(), ['extra', 'openai']);
    const { replies: [reply] } = await (await chat('/api/chat')).json();
    assert.equal(reply.content, 'Local fixture reply');
    assert.match(reply.note, /Ollama.*daily message limit/);
    assert.equal(paidCalls, 1);
  });

  const agent: Agent = {
    id: 'fixture', name: 'Fixture', role: 'Writer', avatar: '', model: 'gpt-fixture', systemInstruction: '',
    color: '', connectedTools: [], totalTokens: 0, totalRuns: 0, avgLatencyMs: 0, status: 'idle',
  };
  await t.test('the scheduled card runner shows a local result for a capped project connection', async () => {
    const at = new Date().toISOString();
    const project: Project = { id: 'p', name: 'Fixture project', color: '', goal: '', status: 'active', createdAt: at, updatedAt: at, ai: { use: 'openai' } };
    const card: Card = { id: 'c', projectId: 'p', title: 'Fixture card', details: '', assigneeId: agent.id, column: 'ready', order: 0, priority: 'high', notes: [], createdAt: at, updatedAt: at };
    let tick: (() => void) | undefined;
    const interval = t.mock.method(globalThis, 'setInterval', (callback: () => void) => { tick = callback; });
    const finished = new Promise<void>(resolve => {
      startCardRunner(() => ({ agents: [agent], projects: [project], cards: [card] }), () => {
        if (card.notes.length) resolve();
      });
    });
    interval.mock.restore();
    assert.ok(tick);
    tick();
    await Promise.race([finished, delay(1500, undefined, { ref: false }).then(() => assert.fail('Card did not finish'))]);
    assert.equal(card.column, 'review');
    assert.equal(card.notes[0].via, 'Ollama');
    assert.match(card.notes[0].text, /daily message limit/);
    assert.equal(paidCalls, 1);
  });

  await t.test('a fresh read of an old subscription record stays stale for swarm teammates', async () => {
    process.env.CHATGPT_DAILY_LIMIT = '10';
    delete process.env.OPENAI_API_KEY;
    await refreshProviderStatus(async command => ({ ok: command.startsWith('codex'), output: 'Logged in' }));
    const result = await askTeammate(agent, 'Fixture system', 'Fixture swarm prompt');
    assert.equal(result.provider, 'extra');
    assert.match(withSpendingNotice(result), /Ollama.*plan usage data is stale/);
    assert.equal(paidCalls, 1);
  });

  await t.test('a new quota rejection switches tablet chat to Ollama without retrying the cloud', async () => {
    const res = await chat('/api/tablet/chat');
    assert.equal(res.status, 200);
    assert.match((await res.json()).content, /Ollama.*Gemini reported a usage limit/);
    assert.equal(paidCalls, 2);
  });

  await t.test('unavailable Ollama stops the request and surfaces the reason without using another cloud', async () => {
    const replied = localReplies;
    ollamaUp = false;
    const { replies: [reply] } = await (await chat('/api/chat')).json();
    assert.match(reply.error, /Request skipped.*stale.*No Ollama model/);
    await assert.rejects(askTeammate(agent, 'Fixture system', 'Fixture swarm prompt'), /Request skipped.*stale.*No Ollama model/);
    const tablet = await chat('/api/tablet/chat');
    assert.equal(tablet.status, 503);
    assert.match((await tablet.json()).error, /Request skipped.*Gemini.*No Ollama model/);
    assert.equal(localReplies, replied);
    assert.equal(paidCalls, 2);
  });

  t.mock.timers.tick(5000); // Flush buffered usage and activity writes while the fixture paths are active.
});
