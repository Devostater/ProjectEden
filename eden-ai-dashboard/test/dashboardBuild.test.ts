// The hub serves a built dashboard. These tests cover what keeps that build in step with the code:
// the build records what it was made from, and the keeper builds again when the code has changed.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { liveDashboardDirs } from '../dashboardSite.ts';
import { BUILD_STAMP, buildIsCurrent, builtFrom, RECOVERY_BUILD, sourceStamp } from '../scripts/build-paths.mjs';

const SCRIPTS = path.resolve(import.meta.dirname, '../scripts');

function write(root: string, file: string, text: string) {
  const location = path.join(root, file);
  fs.mkdirSync(path.dirname(location), { recursive: true });
  fs.writeFileSync(location, text);
}

// A stand-in for Vite: the "page" is the text of src/main.tsx, and a page that says BROKEN does not build.
function fakeVite(root: string) {
  write(root, 'node_modules/vite/bin/vite.js', `
    const fs = require('node:fs');
    const page = fs.readFileSync('src/main.tsx', 'utf8');
    if (page.includes('BROKEN')) {
      console.error('error: src/main.tsx does not build');
      process.exit(1);
    }
    fs.writeFileSync(require('node:path').join(process.argv.at(-1), 'index.html'), page);
  `);
}

test('page changes are live only in development; the normal launch needs a restart for every hub update', () => {
  assert.deepEqual(liveDashboardDirs(true), ['src/', 'public/', 'index.html']);
  assert.deepEqual(liveDashboardDirs(false), []);
});

test('a build records the code it was made from, and only a change to that code makes it out of date', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-stamp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fakeVite(root);
  write(root, 'src/main.tsx', 'first pages');
  write(root, 'src/components/Card.tsx', 'card');
  write(root, 'public/icon.svg', '<svg/>');
  write(root, 'server/routes/updates.ts', 'routes');
  write(root, 'index.html', '<div id="root"></div>');
  write(root, 'package.json', '{}');
  write(root, 'updateReleaseGate.ts', 'export {}');
  const build = () => spawnSync(process.execPath, [path.join(SCRIPTS, 'build-dashboard.mjs')], { cwd: root, encoding: 'utf8' });
  const page = (name: string) => fs.readFileSync(path.join(root, name, 'index.html'), 'utf8');

  assert.equal(buildIsCurrent(root), false, 'no build yet');
  write(root, 'dist/index.html', 'pages built before fingerprints were saved');
  assert.equal(buildIsCurrent(root), false, 'a build with no fingerprint counts as out of date');

  const first = build();
  assert.equal(first.status, 0, first.stderr);
  const firstStamp = sourceStamp(root);
  assert.equal(builtFrom(path.join(root, 'dist')), firstStamp);
  assert.equal(buildIsCurrent(root), true);

  // The hub's own data, keys, logs, tests and installed packages are not what the pages are built from.
  for (const file of ['.eden-chats.json', '.nexusflow-store.json', '.env.local', '.eden-logs/hub.log',
    'node_modules/react/index.js', 'test/extra.test.ts', 'Deliverables/note.md', 'notes.md']) {
    write(root, file, 'not part of the pages');
  }
  assert.equal(sourceStamp(root), firstStamp);
  assert.equal(buildIsCurrent(root), true);

  // Page code, public files, and code files next to the pages (pages import some of them) all count.
  for (const [file, text] of [['src/components/Card.tsx', 'card, changed'], ['public/new-icon.svg', '<svg/>'],
    ['server/routes/updates.ts', 'routes, changed'], ['updateReleaseGate.ts', 'export {} // changed']]) {
    const before = sourceStamp(root);
    write(root, file, text);
    assert.notEqual(sourceStamp(root), before, file);
    assert.equal(buildIsCurrent(root), false, file);
  }

  write(root, 'src/main.tsx', 'second pages');
  const second = build();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(page('dist'), 'second pages');
  assert.equal(buildIsCurrent(root), true);
  // The build it replaced is kept, with its own fingerprint, as the one to fall back on.
  assert.equal(page(RECOVERY_BUILD), 'first pages');
  assert.equal(builtFrom(path.join(root, RECOVERY_BUILD)), firstStamp);

  // A build that fails changes nothing: the pages being served stay, and still count as out of date.
  write(root, 'src/main.tsx', 'BROKEN pages');
  const failed = build();
  assert.equal(failed.status, 1);
  assert.equal(page('dist'), 'second pages');
  assert.equal(buildIsCurrent(root), false);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith('.eden-dist-stage-')), []);
  assert.equal(fs.existsSync(path.join(root, 'dist', BUILD_STAMP)), true);
});

test('the keeper builds an out-of-date dashboard again before it starts the hub, and keeps the last build if that fails', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-keeper-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(new URL('../config.mjs', import.meta.url), path.join(root, 'config.mjs'));
  for (const name of ['hub-supervisor.mjs', 'build-paths.mjs', 'build-dashboard.mjs', 'recover.mjs']) {
    fs.copyFileSync(path.join(SCRIPTS, name), path.join(root, 'scripts', name));
  }
  fakeVite(root);
  // The keeper starts the hub with "--import tsx"; an empty stand-in is enough for this plain-JavaScript hub.
  write(root, 'node_modules/tsx/package.json', '{"name":"tsx","version":"0.0.0","main":"index.js"}');
  write(root, 'node_modules/tsx/index.js', '');
  // A stand-in hub: answers /health like the real one, serves the built page, and restarts or stops when asked
  // (exit code 0 asks the keeper for a restart, 64 tells it to stop). It leaves if the keeper goes away.
  write(root, 'server.ts', `
    const fs = require('node:fs');
    const http = require('node:http');
    const path = require('node:path');
    process.stdin.on('end', () => process.exit(1)).resume();
    http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Eden-Mode': 'production' });
        return res.end(JSON.stringify({ ok: true, pid: process.pid }));
      }
      if (req.url === '/restart' || req.url === '/stop') {
        res.end('ok');
        return setTimeout(() => process.exit(req.url === '/stop' ? 64 : 0), 50);
      }
      res.end(fs.readFileSync(path.join(__dirname, 'dist', 'index.html')));
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `);
  // Like the owner's PC before this fix: a build from an older version of the pages, with no fingerprint.
  write(root, 'dist/index.html', 'old pages');
  write(root, 'src/main.tsx', 'new pages');

  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  probe.close();
  await once(probe, 'close');
  const base = `http://127.0.0.1:${port}`;

  const keeper = spawn(process.execPath, [path.join(root, 'scripts', 'hub-supervisor.mjs')], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  const exited = once(keeper, 'exit');
  t.after(async () => {
    if (keeper.exitCode === null && keeper.signalCode === null) {
      await fetch(base + '/stop').catch(() => {});
      await Promise.race([exited, delay(3000)]);
      keeper.kill();
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const log = () => fs.readFileSync(path.join(root, '.eden-logs', 'hub.log'), 'utf8');
  // Waits for a copy of the hub other than the one given, and returns its process id.
  async function nextHub(previous: number): Promise<number> {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const pid = await fetch(base + '/health').then((r) => r.json()).then((health) => health.pid, () => 0);
      if (pid && pid !== previous) return pid;
      await delay(100);
    }
    throw new Error(`The hub did not come up. Keeper log:\n${log()}`);
  }
  const page = async () => (await fetch(base + '/')).text();

  // First start: the old build is replaced before the hub starts, and kept as the one to fall back on.
  const first = await nextHub(0);
  assert.equal(await page(), 'new pages');
  assert.equal(fs.readFileSync(path.join(root, RECOVERY_BUILD, 'index.html'), 'utf8'), 'old pages');
  assert.match(log(), /The dashboard code has changed since it was built\. Building it again/);

  // A Code update is applied and the owner presses "Restart Eden now": the restart shows the new pages.
  write(root, 'src/main.tsx', 'newer pages');
  await fetch(base + '/restart');
  const second = await nextHub(first);
  assert.equal(await page(), 'newer pages');

  // Code that does not build must not take the hub down: it starts with the last working pages.
  write(root, 'src/main.tsx', 'BROKEN pages');
  await fetch(base + '/restart');
  await nextHub(second);
  assert.equal(await page(), 'newer pages');
  assert.match(log(), /Could not build the dashboard, so the last working build is shown\..*src\/main\.tsx does not build/);

  await fetch(base + '/stop');
  const [code] = await exited;
  assert.equal(code, 0);
  // Exactly three builds were tried: one for each change above, and none besides.
  assert.equal(log().match(/Building it again/g)?.length, 3);
});
