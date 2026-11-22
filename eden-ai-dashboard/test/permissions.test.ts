import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { registerPairing } from '../pairing.ts';
import { sendApprovedWebhook } from '../permissions.ts';
import { registerTabletChat } from '../tabletChat.ts';

const code = 'ABCDEF23';
const legacyToken = 'ab'.repeat(32);
const legacyCookie = 'eden_dev=' + legacyToken;
const initialTime = Date.parse('2026-11-22T12:00:00Z');

async function hub(t: TestContext, existingFile?: string) {
  let time = initialTime;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-permissions-'));
  const file = existingFile ?? path.join(root, 'pairing.json');
  if (!existingFile) {
    fs.writeFileSync(file, JSON.stringify({ code, devices: [{
      id: 'tablet', tokenHash: createHash('sha256').update(legacyToken).digest('hex'),
      name: 'Test tablet', ip: '192.0.2.1', kind: 'tablet', agent: 'Browser',
      pairedAt: new Date(time - 60000).toISOString(), lastSeen: new Date(time).toISOString(),
      trusted: true,
    }] }));
  }

  const app = express();
  app.use((req, _res, next) => {
    // Use one local test listener while exercising the remote branch without trusting forwarded headers.
    const address = req.headers['x-test-owner'] ? '127.0.0.1' : '192.0.2.1';
    Object.defineProperty(req.socket, 'remoteAddress', { value: address, configurable: true });
    next();
  });
  registerPairing(app, { file, now: () => time });
  app.use(express.json());
  registerTabletChat(app, async (messages) => {
    assert.deepEqual(messages, [{ role: 'user', content: 'Hello' }]);
    return 'Tablet reply';
  });
  app.all('*', (_req, res) => res.send('downstream'));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port;
  return { file, base, advance(ms: number) { time += ms; }, request(url: string, headers = {}, options: RequestInit = {}) {
    return fetch(base + url, { redirect: 'manual', ...options, headers });
  } };
}

test('paired access denies each private route and defaults to deny even with saved legacy trust', async (t) => {
  const { request, base } = await hub(t);
  for (const [category, method, route] of [
    ['private files', 'GET', '/.eden-chats.json'],
    ['keys on disk', 'GET', '/%2eenv'],
    ['hosted files', 'GET', '/api/files'],
    ['workspace containing hosted files', 'GET', '/api/workspace'],
    ['project files', 'GET', '/api/projects/project/files'],
    ['private repository content', 'POST', '/api/github/fetch-repo'],
    ['private repository sync', 'POST', '/api/github/sync'],
    ['terminal metadata', 'GET', '/api/terminal'],
    ['terminal execution', 'POST', '/api/terminal'],
    ['key details', 'GET', '/api/settings'],
    ['project key details', 'GET', '/api/projects/project/toolbox'],
    ['project key changes', 'POST', '/api/projects/project/keys'],
    ['activity logs', 'GET', '/api/activity'],
    ['owner chats', 'GET', '/api/chats'],
    ['admin update', 'POST', '/api/updates/update-id/apply'],
    ['admin control', 'POST', '/api/ai/pause'],
    ['backup details', 'GET', '/api/backups'],
    ['hub shutdown', 'POST', '/api/stop-server'],
    ['pairing code', 'GET', '/api/pairing'],
    ['device administration', 'POST', '/api/remote-devices/tablet/trust'],
    ['pipeline webhook capability', 'POST', '/api/pipelines/test/execute'],
    ['preview proxy', 'GET', '/api/projects/project/live'],
    ['future API', 'GET', '/api/new-feature'],
    ['non-build files', 'GET', '/assets/private.json'],
    ['unsupported method', 'PUT', '/api/me'],
  ]) {
    const response = await request(route, { cookie: legacyCookie, origin: base, 'x-forwarded-for': '127.0.0.1' }, { method });
    assert.equal(response.status, 403, category);
    assert.doesNotMatch(await response.text(), /downstream/, category);
  }

  const profile = await request('/api/me', { cookie: legacyCookie });
  assert.deepEqual(await profile.json(), { local: false, device: { id: 'tablet', name: 'Test tablet', kind: 'tablet' }, codeUpdates: false });
  assert.equal((await request('/', { cookie: legacyCookie })).status, 200);
  assert.equal((await request('/assets/app-123.js', { cookie: legacyCookie })).status, 200);
  assert.equal((await request('/api/files', { 'x-test-owner': '1' })).status, 200);
});

test('paired tablet chat accepts same-origin text and rejects cross-origin or unauthorized requests', async (t) => {
  const { request, base } = await hub(t);
  const options = { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello', extra: 'ignored' }] }) };
  const headers = { 'content-type': 'application/json', cookie: legacyCookie, origin: base };
  assert.deepEqual(await (await request('/api/tablet/chat', headers, options)).json(), { content: 'Tablet reply' });
  assert.equal((await request('/api/tablet/chat', { ...headers, origin: 'https://other.example' }, options)).status, 403);
  assert.equal((await request('/api/tablet/chat', { ...headers, origin: '' }, options)).status, 403);
  assert.equal((await request('/api/tablet/chat', { ...headers, cookie: '' }, options)).status, 401);
  assert.equal((await request('/api/tablet/chat', headers, { ...options, body: '{"messages":[{"role":"system","content":"Hello"}]}' })).status, 400);
});

test('pairing limits bad codes, drops the code from the URL, and expires the cookie server-side', async (t) => {
  const { request, advance } = await hub(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await request('/?pair=%C3%89BCDEF2')).status, 401);
  }
  const limited = await request('/?pair=' + code);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '300');
  advance(300000);
  const paired = await request('/?pair=' + code);
  assert.equal(paired.status, 302);
  assert.equal(paired.headers.get('location'), '/');
  const session = paired.headers.get('set-cookie')!;
  assert.match(session, /Max-Age=2592000/);
  assert.match(session, /HttpOnly/);
  const cookie = session.split(';')[0];
  assert.equal((await request('/api/me', { cookie })).status, 200);
  advance(30 * 86400000);
  assert.equal((await request('/api/me', { cookie })).status, 401);
  assert.equal((await request('/api/me', { cookie: 'eden_pair=' + code })).status, 401);
});

test('owner revocation persists, and recovery cannot resurrect a revoked session or code', async (t) => {
  const { request, base, file } = await hub(t);
  const owner = { 'x-test-owner': '1', origin: base };
  const post = { method: 'POST' };
  assert.equal((await request('/api/remote-devices/tablet/forget', { ...owner, origin: 'https://other.example' }, post)).status, 403);
  assert.equal((await request('/api/remote-devices/tablet/forget', owner, post)).status, 200);
  assert.equal((await request('/api/me', { cookie: legacyCookie })).status, 401);
  const restarted = await hub(t, file);
  assert.equal((await restarted.request('/api/me', { cookie: legacyCookie })).status, 401);

  fs.writeFileSync(file, 'broken data');
  const recovered = await hub(t, file);
  assert.equal((await recovered.request('/api/me', { cookie: legacyCookie })).status, 401);
  assert.equal((await recovered.request('/?pair=' + code)).status, 401);
  const newCode: string = (await (await recovered.request('/api/pairing', { 'x-test-owner': '1' })).json()).code;
  const paired = await recovered.request('/?pair=' + newCode);
  assert.equal(paired.status, 302);
  const cookie = paired.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await recovered.request('/api/pairing/reset', { ...owner, origin: recovered.base }, post)).status, 200);
  assert.equal((await recovered.request('/api/me', { cookie })).status, 401);
  assert.equal((await recovered.request('/?pair=' + newCode)).status, 401);
});

test('webhooks are disabled without configuration and require an exact HTTPS destination', async () => {
  const approved = 'https://hooks.example/approved';
  const unexpected: typeof fetch = async () => assert.fail('Denied webhook reached fetch');
  await assert.rejects(sendApprovedWebhook(approved, {}, '{}', '', unexpected), /disabled/);
  for (const invalid of [undefined, 'http://hooks.example/approved', approved + '?extra=1',
    approved + '#fragment', 'https://user:pass@hooks.example/approved', 'https://hooks.example/unapproved']) {
    await assert.rejects(sendApprovedWebhook(invalid, {}, '{}', approved, unexpected), /not been approved/);
  }
  for (const status of [200, 302, 307, 500]) {
    let sent = 0;
    const dispatch: typeof fetch = async (destination, options) => {
      sent++;
      assert.equal(destination, approved);
      assert.equal(options?.redirect, 'manual');
      assert.equal(options?.method, 'POST');
      assert.equal(options?.body, '{"test":true}');
      return new Response(null, { status, headers: { location: 'https://other.example/' } });
    };
    const request = sendApprovedWebhook(approved, {}, '{"test":true}', approved, dispatch);
    if (status === 200) assert.equal(await request, 200);
    else await assert.rejects(request, status < 400 ? /redirects are blocked/ : /HTTP 500/);
    assert.equal(sent, 1);
  }
});
