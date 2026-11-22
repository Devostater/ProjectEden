import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { applyWithRecovery } from '../scripts/recover.mjs';

const run = promisify(execFile);

function disposableCopy(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  for (const script of ['recover.mjs', 'build-paths.mjs', 'hub-supervisor.mjs']) {
    write(`scripts/${script}`, fs.readFileSync(path.join(import.meta.dirname, '../scripts', script), 'utf8'));
  }
  write('dist/index.html', 'working dashboard');
  write('dist/assets/app.js', 'working asset');
  write('server.ts', 'working server');
  write('retired.ts', 'working module');
  write('.nexusflow-store.json', '{"fakeProject":true}');
  return { root, write, read };
}

async function availablePort(t: TestContext) {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  t.after(() => { if (server.listening) server.close(); });
  return { server, port: address.port };
}

test('supervisor stops after three broken boots and offline recovery restores the paired files and build', async (t) => {
  const { root, write, read } = disposableCopy(t);
  const { server, port } = await availablePort(t);
  const options = { cwd: root, env: { ...process.env, PORT: String(port) }, timeout: 25_000 };
  const applied = [{ id: 'update-1', codebaseId: 'hub', status: 'applied', restore: { commit: 'original', at: '2026-01-01' } }];
  applyWithRecovery(root, 'update-1', 'original', ['server.ts', 'retired.ts', 'new.ts'], () => {
    write('server.ts', 'broken server');
    fs.unlinkSync(path.join(root, 'retired.ts'));
    write('new.ts', 'new file');
  });
  write('.eden-updates.json', JSON.stringify(applied));
  write('dist/index.html', 'broken dashboard');
  write('dist/assets/app.js', 'broken asset');
  write('.eden-dist-last-good/index.html', 'unrelated older build');
  write('node_modules/tsx/dist/cli.mjs', 'process.exit(1);');
  const cli = (...args: string[]) => run(process.execPath, ['scripts/recover.mjs', ...args], options);

  await assert.rejects(cli('--force'), /Close EDEN/);
  server.close();
  await once(server, 'close');
  await assert.rejects(run(process.execPath, ['scripts/hub-supervisor.mjs'], options), {
    code: 1,
    stdout: /failed to boot 3 times.*Recover Eden\.bat/,
  });
  assert.equal(fs.existsSync(path.join(root, '.eden-logs/supervisor.pid')), false);

  write('server.ts', 'owner edit after the broken update');
  await assert.rejects(cli(), /has changed since Apply/);
  assert.equal(read('server.ts'), 'owner edit after the broken update');
  assert.equal(read('dist/index.html'), 'broken dashboard');
  assert.equal(JSON.parse(read('.eden-updates.json'))[0].status, 'applied');

  await cli('--force');
  assert.equal(read('server.ts'), 'working server');
  assert.equal(read('retired.ts'), 'working module');
  assert.equal(fs.existsSync(path.join(root, 'new.ts')), false);
  assert.equal(read('dist/index.html'), 'working dashboard');
  assert.equal(read('dist/assets/app.js'), 'working asset');
  assert.equal(read('.nexusflow-store.json'), '{"fakeProject":true}');
  assert.equal(JSON.parse(read('.eden-updates.json'))[0].status, 'undone');
  await assert.rejects(cli('--force'), /no applied hub update/);
});

test('recovery refuses a mismatched update and a damaged build even with force', async (t) => {
  const { root, write, read } = disposableCopy(t);
  const { server, port } = await availablePort(t);
  server.close();
  await once(server, 'close');
  const cli = () => run(process.execPath, ['scripts/recover.mjs', '--force'], {
    cwd: root, env: { ...process.env, PORT: String(port) }, timeout: 5000,
  });
  applyWithRecovery(root, 'update-1', 'original', ['server.ts'], () => write('server.ts', 'broken server'));
  const job = { id: 'update-1', status: 'applied', restore: { commit: 'different', at: '2026-01-01' } };
  write('.eden-updates.json', JSON.stringify([job]));
  await assert.rejects(cli(), /no matching offline recovery point/);
  job.restore.commit = 'original';
  write('.eden-updates.json', JSON.stringify([job]));
  write('.eden-offline-restore/build/assets/app.js', 'damaged asset');
  await assert.rejects(cli(), /build is damaged/);
  assert.equal(read('server.ts'), 'broken server');
  write('.eden-offline-restore/build/assets/app.js', 'working asset');
  write('unrelated.ts', 'owner work outside the update');
  await run(process.execPath, ['scripts/recover.mjs'], {
    cwd: root, env: { ...process.env, PORT: String(port) }, timeout: 5000,
  });
  assert.equal(read('server.ts'), 'working server');
  assert.equal(read('unrelated.ts'), 'owner work outside the update');
});
