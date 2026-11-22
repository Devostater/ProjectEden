import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import express from 'express';
import { dashboardMode, serveDashboard } from '../dashboardSite.ts';
import { findBuild, RECOVERY_BUILD } from '../scripts/build-paths.mjs';

test('only explicit development mode selects the loopback Vite server', () => {
  assert.deepEqual(dashboardMode([]), { dev: false, host: '0.0.0.0' });
  assert.deepEqual(dashboardMode(['--dev']), { dev: true, host: '127.0.0.1' });
});

test('the production site serves build files and returns 404 for private files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const privateFiles = ['.eden-chats.json', '.eden-project-chats.json', '.eden-pairing.json',
    'credentials.json', '.eden-logs/hub.log', '.env', '.env.local'];
  for (const file of [...privateFiles, 'dist/index.html', 'dist/assets/app.js', 'dist/.env']) {
    const location = path.join(root, file);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    fs.writeFileSync(location, 'fake fixture');
  }

  const app = express();
  serveDashboard(app, root);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  for (const url of ['/', '/assets/app.js']) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.equal(await response.text(), 'fake fixture');
  }
  for (const file of [...privateFiles, '%2eenv', 'missing.js', 'api/missing']) {
    const response = await fetch(base + '/' + file);
    assert.equal(response.status, 404, file);
    assert.doesNotMatch(await response.text(), /fake fixture/, file);
  }
});

test('a failed build preserves dist and a successful rebuild retains the previous build', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist/index.html'), 'previous dashboard');
  const bin = path.join(root, 'node_modules/vite/bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'vite.js'), `
    const fs = require('node:fs');
    const out = process.argv.at(-1);
    fs.writeFileSync(require('node:path').join(out, 'index.html'), 'new dashboard');
    process.exit(process.argv.includes('--fail') ? 1 : 0);
  `);
  const script = path.resolve(import.meta.dirname, '../scripts/build-dashboard.mjs');
  const build = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  const readBuild = (name: string) => fs.readFileSync(path.join(root, name, 'index.html'), 'utf8');

  const failed = build('--fail');
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(readBuild('dist'), 'previous dashboard');

  const succeeded = build();
  assert.equal(succeeded.status, 0, succeeded.stderr);
  assert.equal(readBuild('dist'), 'new dashboard');
  assert.equal(readBuild(RECOVERY_BUILD), 'previous dashboard');
  fs.renameSync(path.join(root, 'dist'), path.join(root, 'unavailable'));
  assert.equal(findBuild(root), path.join(root, RECOVERY_BUILD));
});


test('the supervisor refuses to adopt a legacy or development listener', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-supervisor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  for (const name of ['hub-supervisor.mjs', 'build-paths.mjs']) {
    fs.copyFileSync(path.resolve(import.meta.dirname, '../scripts', name), path.join(scripts, name));
  }

  const app = express();
  app.get('/api/models', (_req, res) => {
    res.set('X-Eden-Mode', 'development').json([]);
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await assert.rejects(
    promisify(execFile)(process.execPath, [path.join(scripts, 'hub-supervisor.mjs')], {
      cwd: root, env: { ...process.env, PORT: String(address.port) }, timeout: 10000,
    }),
    { code: 1, stdout: /without EDEN production mode/ },
  );
});
