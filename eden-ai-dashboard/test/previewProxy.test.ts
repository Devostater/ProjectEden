import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type https from 'node:https';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { approvedPreview, previewAddress, registerPreviewProxy } from '../previewProxy.ts';

const approved = 'https://app.example.com';
const live = '/api/projects/demo/live';

async function listen(t: TestContext, server: http.Server) {
  if (!server.listening) await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === 'object');
  return 'http://127.0.0.1:' + address.port;
}

test('preview origins require exact owner approval and public HTTPS names', () => {
  assert.equal(approvedPreview(approved + '/project?a=b', approved)?.href, approved + '/project?a=b');
  for (const target of [
    'http://localhost:3000', 'https://127.1', 'https://[::1]', 'https://localhost',
    'https://eden.local', 'https://printer.internal', 'https://10.0.0.5',
    approved + ':3000', 'http://app.example.com', 'https://user@app.example.com',
  ]) assert.equal(approvedPreview(target, target), undefined, target);
  assert.equal(approvedPreview(approved, approved + '.other.example.com'), undefined);
  assert.equal(approvedPreview(approved, approved + '/some-project'), undefined);
  assert.equal(approvedPreview(approved, ''), undefined);
});

test('preview DNS rejects local, private, reserved and mixed address results', async () => {
  for (const addresses of [
    [], ['127.0.0.1'], ['10.0.0.1'], ['100.64.0.1'], ['169.254.169.254'], ['192.168.0.1'],
    ['172.31.0.1'], ['0.0.0.0'], ['224.0.0.1'], ['::ffff:127.0.0.1'], ['8.8.4.4', '127.0.0.1'],
  ]) await assert.rejects(previewAddress('app.example.com', async () => addresses), /public addresses/);
  assert.equal(await previewAddress('app.example.com', async () => ['8.8.4.4']), '8.8.4.4');
});

test('preview activation is disabled by default and requires the owner dashboard', async t => {
  const app = express();
  const getStore = () => ({ projects: [{ id: 'demo', previewUrl: approved }] });
  const close = registerPreviewProxy(app, getStore, '');
  t.after(close);
  const base = await listen(t, app.listen(0, '127.0.0.1'));
  const response = await fetch(base + live, { method: 'POST', headers: { origin: base } });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /disabled/);
  assert.equal((await fetch(base + live)).status, 404);
  const denied = await fetch(base + live, {
    method: 'POST', headers: { origin: base, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /owner PC/);
});

test('live preview uses a distinct loopback origin and forwards only safe reads to the pinned target', async t => {
  let dispatched = 0;
  let answer = ['8.8.4.4'];
  const fixture = await listen(t, http.createServer((req, res) => {
    assert.equal(req.headers.host, 'app.example.com');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:3000' });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': ["frame-ancestors 'none'", "script-src 'none'"],
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Set-Cookie': 'eden_dev=fake',
      'Clear-Site-Data': '"cookies"',
      Refresh: '0; url=http://127.0.0.1:3000',
    });
    res.end('<html><body>Fixture</body></html>');
  }).listen(0, '127.0.0.1'));
  const dispatch = (options: https.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    dispatched++;
    assert.equal(options.hostname, '8.8.4.4');
    assert.equal(options.servername, 'app.example.com');
    return http.request(fixture + options.path, { method: options.method, headers: options.headers }, callback);
  };

  const app = express();
  const project = { id: 'demo', previewUrl: 'https://unapproved.example.com' };
  const close = registerPreviewProxy(app, () => ({ projects: [project] }), approved,
    name => previewAddress(name, async () => answer), dispatch);
  t.after(close);
  const base = await listen(t, app.listen(0, '127.0.0.1'));
  const open = (origin = base) => fetch(base + live, { method: 'POST', headers: { origin } });
  assert.equal((await open()).status, 403);
  project.previewUrl = approved + '/project?a=b';
  assert.equal((await open('https://other.example.com')).status, 403);
  const activation = await open();
  assert.equal(activation.status, 200);
  const { url } = await activation.json() as { url: string };
  const proxy = new URL(url);
  assert.notEqual(proxy.origin, base);
  assert.equal(proxy.hostname, '127.0.0.1');
  assert.equal(proxy.pathname + proxy.search, '/project?a=b');

  const response = await fetch(url, { headers: { cookie: 'eden_dev=fake', authorization: 'Bearer fake' } });
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp ?? '', /frame-ancestors 'none'/);
  assert.match(csp ?? '', /script-src 'none'/);
  assert.match(csp ?? '', /sandbox allow-scripts/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin, no-referrer');
  for (const header of ['set-cookie', 'clear-site-data', 'refresh']) assert.equal(response.headers.get(header), null);
  assert.match(await response.text(), /Fixture<script src="\/__eden_picker\.js"><\/script>/);

  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal(dispatched, 1);
  const redirect = await fetch(proxy.origin + '/redirect', { redirect: 'manual' });
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.get('location'), null);
  answer = ['127.0.0.1'];
  assert.equal((await fetch(url)).status, 502);
  assert.equal(dispatched, 2);
});
