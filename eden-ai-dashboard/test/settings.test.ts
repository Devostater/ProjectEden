import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { parse } from 'dotenv';
import express from 'express';
import { registerSettingsRoutes } from '../settings.ts';

async function settings(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-settings-'));
  const file = path.join(dir, 'test-config');
  const env: NodeJS.ProcessEnv = { OWNER_NAME: 'Before' };
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-test-remote']) {
      Object.defineProperty(req.socket, 'remoteAddress', { value: '192.0.2.1' });
    }
    next();
  });
  app.use(express.json());
  registerSettingsRoutes(app, { file, env });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    try {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = 'http://127.0.0.1:' + address.port + '/api/settings';
  return {
    file, env,
    read: () => fs.readFileSync(file, 'utf8'),
    get: () => fetch(url),
    post: (body: Record<string, unknown>, headers: Record<string, string> = {}) => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  };
}

test('owner settings writes round-trip, retain unrelated lines, and mask and remove fake keys', async (t) => {
  const { file, env, read, get, post } = await settings(t);
  const oldConfig = '# keep this comment\r\nUNRELATED="keep me"\r\nOWNER_NAME="Before"\r\n';
  fs.writeFileSync(file, oldConfig);
  const fakeKey = 'fake-key-for-settings-test';
  const response = await post({
    OPENAI_API_KEY: fakeKey,
    OWNER_NAME: '  After  ',
    BACKUP_COPY_DIR: String.raw`C:\test\new folder`,
    UNRELATED: 'discard me',
    TERMINAL_ENABLED: true,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(read(), /^# keep this comment/m);
  assert.deepEqual(parse(read()), { ...env, UNRELATED: 'keep me' });
  assert.deepEqual(env, {
    OPENAI_API_KEY: fakeKey,
    OWNER_NAME: 'After',
    BACKUP_COPY_DIR: 'C:/test/new folder',
  });

  const result = await get();
  assert.equal(result.status, 200);
  const body = await result.text();
  assert.ok(!body.includes(fakeKey));
  const keySetting = JSON.parse(body).settings.find((setting: { key: string }) => setting.key === 'OPENAI_API_KEY');
  assert.equal(keySetting.set, true);
  assert.match(keySetting.preview, /^fake.+test$/);

  const removed = await post({ OPENAI_API_KEY: '' });
  assert.equal(removed.status, 200);
  await removed.json();
  assert.equal(parse(read()).OPENAI_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test('remote settings writes and failed disk writes leave runtime configuration untouched', async (t) => {
  const { file, env, post } = await settings(t);
  const blocked = await post({ OWNER_NAME: 'Remote' }, {
    'x-test-remote': '1', 'x-forwarded-for': '127.0.0.1',
  });
  assert.equal(blocked.status, 403);
  await blocked.json();
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(env, { OWNER_NAME: 'Before' });

  fs.mkdirSync(file); // Predictably unwritable as a file, even when running as an administrator.
  const failed = await post({ OWNER_NAME: 'Unsaved' });
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).error, /Could not write/);
  assert.deepEqual(env, { OWNER_NAME: 'Before' });
  assert.deepEqual(fs.readdirSync(file), []);
});
