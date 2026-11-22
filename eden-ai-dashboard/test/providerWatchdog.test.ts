import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerTabletChat } from '../tabletChat.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { generatePaid, providerDetails, refreshProviderStatus, UnconfirmedPaidRequestError } from '../providers.ts';

test('provider status reads the cache while a single background refresh is pending', async () => {
  const before = providerDetails();
  let commands = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const refresh = refreshProviderStatus(async (command) => {
    commands++;
    await pending;
    return { ok: command.startsWith('claude'), output: '{"loggedIn":true}' };
  });
  assert.equal(refreshProviderStatus(), refresh);
  assert.deepEqual(providerDetails(), before);
  assert.equal(commands, 3);
  release();
  await refresh;
  assert.equal(commands, 4);
  assert.equal(providerDetails().find((entry) => entry.provider === 'anthropic')?.cliInstalled, true);
});

test('each paid provider aborts a stalled response body and reports a timeout without resending', async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  for (const provider of ['anthropic', 'openai', 'google'] as const) {
    let requests = 0;
    let aborted = false;
    const fake = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      requests++;
      const signal = init.signal!;
      return new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => {
            aborted = true;
            controller.error(signal.reason);
          }, { once: true });
        },
      }), { headers: { 'content-type': 'application/json' } });
    });
    const keepAlive = delay(100, undefined, { ref: true });
    try {
      await assert.rejects(generatePaid(provider, 'fake-model', { prompt: 'fake prompt' }, 30), {
        name: 'Error',
        message: /timed out.*may still finish and charge/,
      });
      assert.equal(requests, 1, provider);
      assert.equal(aborted, true, provider);
    } finally {
      fake.mock.restore();
      await keepAlive;
    }
  }
});

test('Gemini retries one explicit quota rejection and never retries an ambiguous 503', async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  let requests: string[] = [];
  let status = 429;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requests.push(String(url));
    if (requests.length === 1 || status === 503) {
      return Response.json({ error: { code: status, message: 'fake quota or service error' } }, { status });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: 'fake reply' }] } }] });
  });
  const result = await generatePaid('google', 'fake-model', { prompt: 'test' });
  assert.equal(result.text, 'fake reply');
  assert.equal(requests.length, 2);
  assert.match(requests[1], /gemini-3.5-flash-lite/);

  requests = [];
  status = 503;
  await assert.rejects(generatePaid('google', 'fake-model', { prompt: 'test', web: true }), UnconfirmedPaidRequestError);
  assert.equal(requests.length, 1);
});

test('tablet chat reports an unconfirmed request without exposing provider details', async (t) => {
  const app = express();
  app.use(express.json());
  registerTabletChat(app, async () => {
    throw new UnconfirmedPaidRequestError('fake private provider details');
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const response = await fetch('http://127.0.0.1:' + address.port + '/api/tablet/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'fake question' }] }),
  });
  assert.equal(response.status, 503);
  const { error } = await response.json();
  assert.match(error, /may still finish/);
  assert.doesNotMatch(error, /private/);
});
