// Run the hub on a phone or tablet, and choose which device is the "main server".
//
// Install (over the USB cable, no typing on the device):
//   1. installs Termux (a free Linux app for Android; the official GitHub build, checksum-verified)
//   2. installs Node inside Termux
//   3. copies a packed hub (one server file plus the pages) and a start script that keeps it running
//   4. opens Termux, which starts the hub on the device at port 3100
// This works because the GitHub build of Termux allows `run-as`, so commands run as Termux over the cable.
//
// Main server: the hub whose data (projects, team, chats, keys, free-AI list) is the live copy.
// Moving it copies the data across and pauses the AI on the other hub, so two hubs never work the same cards.
// On a device hub, Claude and ChatGPT (subscription tools) and Ollama aren't available; Gemini, Google AI
// Studio and free AIs with keys are. While the device is plugged in, it can also reach LYRA on this PC.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { listDevices } from './devices';
import { setPaused } from './control';
import { restartHub } from './restart';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = path.join(os.homedir(), '.eden-hub');
const STATE_FILE = path.join(APP_DIR, '.eden-main.json');

export const ON_DEVICE = process.env.EDEN_DEVICE_HUB === '1';
const DEVICE_PORT = 3100;

const TERMUX_APK = path.join(HOME_DIR, 'termux', 'termux.apk');
const TERMUX_URL = 'https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_arm64-v8a.apk';
const TERMUX_SHA256 = '72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e';
const T = '/data/data/com.termux/files';
const TERMUX_ENV = `export PREFIX=${T}/usr HOME=${T}/home TMPDIR=${T}/usr/tmp PATH=${T}/usr/bin LANG=en_US.UTF-8 DEBIAN_FRONTEND=noninteractive; cd ${T}/home;`;

// The data that makes up "your hub". Keys in .env.local go too, so Gemini and free AIs keep working.
const DATA_FILES = ['.nexusflow-store.json', '.env.local', '.eden-ai.json', '.eden-pairing.json', '.eden-usage.json'];

interface MainState {
  main: 'pc' | string; // 'pc' or a device serial
  mainName?: string;
}
let state: MainState = { main: 'pc' };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
} catch {}
const saveState = () => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
  } catch {}
};

// ---- helpers -------------------------------------------------------------------------------------

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function fromOwnPage(req: Request) {
  try {
    return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], opts: { timeout?: number; cwd?: string; input?: Buffer; shell?: boolean } = {}) {
  return new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, shell: opts.shell });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), opts.timeout ?? 60000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out, err: err || e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim() });
    });
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

const adbRun = (serial: string, args: string[], timeout = 60000) => run(adbBin(), ['-s', serial, ...args], { timeout });
let adbBinCache = '';
function adbBin() {
  if (adbBinCache) return adbBinCache;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge', 'tools', 'platform-tools', 'adb.exe'),
  ];
  adbBinCache = candidates.find((p) => fs.existsSync(p)) || 'adb';
  return adbBinCache;
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
// Runs a bash script inside Termux on the device, as the Termux app.
const termux = (serial: string, script: string, timeout = 120000) =>
  adbRun(serial, ['shell', `run-as com.termux ${T}/usr/bin/bash -c ${sq(TERMUX_ENV + script)}`], timeout);

// Each device's hub is reachable from this PC at its own local port (through the cable).
const hostPort = (serial: string) => 3101 + ([...serial].reduce((n, c) => n + c.charCodeAt(0), 0) % 60);
async function forward(serial: string) {
  await adbRun(serial, ['forward', `tcp:${hostPort(serial)}`, `tcp:${DEVICE_PORT}`], 15000);
  return `http://127.0.0.1:${hostPort(serial)}`;
}
async function deviceHubUp(serial: string): Promise<boolean> {
  try {
    const base = await forward(serial);
    const r = await fetch(`${base}/api/hub/info`, { headers: { 'x-eden-hub': '1' }, signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function wifiAddress(serial: string): Promise<string | undefined> {
  const r = await adbRun(serial, ['shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], 8000);
  return r.out.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
}

// ---- packing the hub ----------------------------------------------------------------------------

const PACK = path.join(HOME_DIR, 'pack', 'eden-hub.tgz');
async function buildPack(): Promise<string> {
  const stage = path.join(HOME_DIR, 'pack', 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const vite = await run('npx', ['vite', 'build'], { cwd: APP_DIR, timeout: 180000, shell: true });
  if (!vite.ok) throw new Error(`Couldn't build the pages: ${(vite.err || vite.out).slice(-300)}`);
  const esbuild: any = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(APP_DIR, 'server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['vite', 'esbuild'],
    outfile: path.join(stage, 'hub.mjs'),
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'silent',
  });
  fs.cpSync(path.join(APP_DIR, 'dist'), path.join(stage, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'eden-hub', private: true, type: 'module' }));
  const start = `#!${T}/usr/bin/bash
# Keeps the Eden AI Hub running on this device (port ${DEVICE_PORT}). Restarts it if it stops.
cd ~/eden-hub
echo $$ > hub.pid
termux-wake-lock 2>/dev/null
echo "Eden AI Hub is running. Keep Termux open in the background."
while true; do
  NODE_ENV=production PORT=${DEVICE_PORT} EDEN_DEVICE_HUB=1 node hub.mjs
  echo "Hub stopped. Starting again in 3 seconds..."
  sleep 3
done
`;
  fs.writeFileSync(path.join(stage, 'start.sh'), start.replace(/\r/g, ''));
  fs.rmSync(PACK, { force: true });
  const tar = await run('tar', ['-czf', PACK, '-C', stage, '.'], { timeout: 120000 });
  if (!tar.ok) throw new Error(`Couldn't pack the hub: ${tar.err}`);
  return PACK;
}

async function termuxApk(): Promise<string> {
  const ok = () => fs.existsSync(TERMUX_APK) && crypto.createHash('sha256').update(fs.readFileSync(TERMUX_APK)).digest('hex') === TERMUX_SHA256;
  if (ok()) return TERMUX_APK;
  fs.mkdirSync(path.dirname(TERMUX_APK), { recursive: true });
  const res = await fetch(TERMUX_URL, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`Couldn't download Termux (${res.status}).`);
  fs.writeFileSync(TERMUX_APK, Buffer.from(await res.arrayBuffer()));
  if (!ok()) {
    fs.rmSync(TERMUX_APK, { force: true });
    throw new Error("The Termux download didn't match its official checksum, so it wasn't installed.");
  }
  return TERMUX_APK;
}

// ---- install -------------------------------------------------------------------------------------

const progress = new Map<string, { step: string; error?: string; done?: boolean; at: number }>();
const setStep = (serial: string, step: string) => progress.set(serial, { step, at: Date.now() });

async function installHub(serial: string, name: string) {
  try {
    setStep(serial, 'Installing Termux…');
    const has = await adbRun(serial, ['shell', 'pm', 'path', 'com.termux'], 15000);
    if (!has.out.includes('package:')) {
      const apk = await termuxApk();
      const inst = await adbRun(serial, ['install', '-r', apk], 180000);
      if (!/Success/i.test(inst.out + inst.err)) throw new Error(`Termux didn't install: ${(inst.err || inst.out).slice(-200)}`);
    }

    setStep(serial, 'Getting Termux ready (first start takes about a minute)…');
    const hasBash = async () => (await adbRun(serial, ['shell', `run-as com.termux ls ${T}/usr/bin/bash`], 10000)).ok;
    if (!(await hasBash())) {
      await adbRun(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], 5000);
      await adbRun(serial, ['shell', 'am', 'start', '-n', 'com.termux/.app.TermuxActivity'], 15000);
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        ready = await hasBash();
      }
      if (!ready) throw new Error('Termux didn\'t finish setting up. Unlock the device, open Termux once, wait for the prompt, then try again.');
      await new Promise((r) => setTimeout(r, 4000));
    }
    const runAs = await termux(serial, 'echo ok', 15000);
    if (!runAs.out.includes('ok')) throw new Error(`Couldn't run commands in Termux: ${(runAs.err || runAs.out).slice(-200)}`);

    setStep(serial, 'Installing Node in Termux (a few minutes)…');
    const node = await termux(
      serial,
      `if ! node --version >/dev/null 2>&1; then (apt-get update -y && apt-get full-upgrade -y -o Dpkg::Options::=--force-confnew && apt-get install -y -o Dpkg::Options::=--force-confnew nodejs-lts) > ~/eden-node-install.log 2>&1; fi; node --version && command -v node`,
      15 * 60 * 1000,
    );
    // Termux's starting packages are older than Node needs, so they are upgraded first (above).
    if (!/\/node/.test(node.out)) {
      const log = await termux(serial, 'tail -n 8 ~/eden-node-install.log', 15000);
      throw new Error(`Node didn't install. ${log.out.slice(-300)}`);
    }

    setStep(serial, 'Packing and copying the hub…');
    const pack = await buildPack();
    const remote = '/data/local/tmp/eden-hub.tgz';
    const push = await adbRun(serial, ['push', pack, remote], 180000);
    if (!push.ok) throw new Error(`Couldn't copy the hub: ${push.err.slice(-200)}`);
    // cat runs as the USB shell (which owns the file) and pipes it to Termux, which unpacks it in its home.
    const unpack = await adbRun(serial, ['shell', `cat ${remote} | run-as com.termux ${T}/usr/bin/bash -c ${sq(`${TERMUX_ENV} mkdir -p eden-hub && tar xzf - -C eden-hub && chmod +x eden-hub/start.sh && echo unpacked`)}`], 120000);
    await adbRun(serial, ['shell', 'rm', '-f', remote], 10000);
    if (!unpack.out.includes('unpacked')) throw new Error(`Couldn't unpack the hub: ${(unpack.err || unpack.out).slice(-200)}`);
    // Opening Termux starts the hub (unless it's already running).
    await termux(
      serial,
      // Asks the hub itself whether it's running (a saved process number can go stale after a reboot).
      `touch .bashrc; sed -i '/[Ee]den[ -]*[Hh]ub/d' .bashrc; printf '%s\\n' '# Eden AI Hub: start it when Termux opens' 'curl -s -m 2 -o /dev/null -H x-eden-hub:1 http://127.0.0.1:${DEVICE_PORT}/api/hub/info || bash ~/eden-hub/start.sh' >> .bashrc; echo done`,
      15000,
    );

    setStep(serial, 'Starting the hub on the device…');
    await adbRun(serial, ['shell', 'am', 'force-stop', 'com.termux'], 15000);
    await adbRun(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], 5000);
    await adbRun(serial, ['shell', 'am', 'start', '-n', 'com.termux/.app.TermuxActivity'], 15000);
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      up = await deviceHubUp(serial);
    }
    if (!up) throw new Error('The hub was installed but didn\'t start. Unlock the device and open Termux: the hub starts when it opens.');
    progress.set(serial, { step: 'The hub is running on the device.', done: true, at: Date.now() });
    logActivity('done', `Hub installed and running on ${name}.`);
  } catch (err: any) {
    progress.set(serial, { step: 'Install stopped', error: err.message, at: Date.now() });
    logActivity('error', `Installing the hub on ${name} stopped: ${err.message}`);
  }
}

// ---- main server -----------------------------------------------------------------------------------

function readData(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of DATA_FILES) {
    try {
      files[f] = fs.readFileSync(path.join(APP_DIR, f), 'utf-8');
    } catch {}
  }
  return files;
}
function writeData(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    if (!DATA_FILES.includes(name) && name !== '.eden-control.json') continue;
    fs.writeFileSync(path.join(APP_DIR, name), content, 'utf-8');
  }
}

async function makeDeviceMain(serial: string, name: string) {
  if (!(await deviceHubUp(serial))) throw new Error('The hub isn\'t running on that device. Install it (or open Termux on it) first.');
  const base = await forward(serial);
  const files = { ...readData(), '.eden-control.json': JSON.stringify({ paused: false }) };
  const r = await fetch(`${base}/api/hub/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eden-hub': '1' },
    body: JSON.stringify({ files }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`The device didn't accept the data (${r.status}).`);
  setPaused(true, `Main server moved to ${name}: AI on this PC is paused.`);
  state = { main: serial, mainName: name };
  saveState();
  logActivity('done', `${name} is now the main server. Your projects, team and chats were copied to it.`);
}

async function makePcMain() {
  if (state.main === 'pc') return false;
  const serial = state.main;
  if (!(await deviceHubUp(serial))) throw new Error(`Plug in ${state.mainName || 'the device'} and open Termux on it, so its latest data can be copied back.`);
  const base = await forward(serial);
  const r = await fetch(`${base}/api/hub/export`, { headers: { 'x-eden-hub': '1' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Couldn't read the device's data (${r.status}).`);
  const { files } = (await r.json()) as { files: Record<string, string> };
  // Pause the device's AI first, so it stops working cards once this PC takes over.
  await fetch(`${base}/api/hub/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-eden-hub': '1' },
    body: JSON.stringify({ files: { '.eden-control.json': JSON.stringify({ paused: true }) } }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
  writeData({ ...files, '.eden-control.json': JSON.stringify({ paused: false }) });
  const name = state.mainName;
  state = { main: 'pc' };
  saveState();
  logActivity('done', `This PC is the main server again (data copied back from ${name || 'the device'}). Restarting to load it.`);
  return true;
}

// ---- routes ---------------------------------------------------------------------------------------

export const mainServer = () => state;

export function registerDeviceHubRoutes(app: Express) {
  // Used between hubs over the cable (this PC <-> a device). The custom header stops web pages from calling these.
  const hubCall = (req: Request) => isLocal(req) && req.headers['x-eden-hub'] === '1';

  app.get('/api/hub/info', (req, res) => {
    if (!hubCall(req)) return res.status(403).json({ error: 'Not allowed.' });
    res.json({ onDevice: ON_DEVICE, port: Number(process.env.PORT) || 3000 });
  });
  app.get('/api/hub/export', (req, res) => {
    if (!hubCall(req)) return res.status(403).json({ error: 'Not allowed.' });
    res.json({ files: readData() });
  });
  app.post('/api/hub/import', (req, res) => {
    // Only a hub running on a phone or tablet accepts data this way; it restarts itself to load it.
    if (!hubCall(req) || !ON_DEVICE) return res.status(403).json({ error: 'Not allowed.' });
    try {
      writeData(req.body?.files || {});
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ ok: true });
    res.on('finish', () => setTimeout(() => process.exit(0), 300)); // start.sh starts it again
  });

  if (ON_DEVICE) return; // the rest manages devices from the PC

  // Status of the hub on each plugged-in device. Checking Termux costs a few adb calls, so it's cached.
  const cache = new Map<string, { termux: boolean; running: boolean; wifi?: string; at: number }>();
  app.get('/api/device-hubs', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const out: Record<string, any> = {};
    for (const d of listDevices().filter((x) => x.state === 'device')) {
      let c = cache.get(d.serial);
      if (!c || Date.now() - c.at > 60000 || req.query.refresh) {
        const termuxApp = (await adbRun(d.serial, ['shell', 'pm', 'path', 'com.termux'], 10000)).out.includes('package:');
        const running = termuxApp ? await deviceHubUp(d.serial) : false;
        c = { termux: termuxApp, running, wifi: running ? await wifiAddress(d.serial) : undefined, at: Date.now() };
        cache.set(d.serial, c);
      }
      const p = progress.get(d.serial);
      out[d.serial] = {
        termux: c.termux,
        running: c.running,
        link: c.running && c.wifi ? `http://${c.wifi}:${DEVICE_PORT}` : undefined,
        installing: p && !p.done && !p.error ? p.step : undefined,
        error: p?.error,
      };
    }
    res.json({ main: state.main, mainName: state.mainName, devices: out });
  });

  app.post('/api/device-hubs/:serial/:action', async (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Only from the hub on this computer.' });
    const { serial, action } = req.params;
    if (action === 'make-pc-main') {
      try {
        const changed = await makePcMain();
        res.json({ ok: true, restarting: changed });
        if (changed) res.on('finish', () => setTimeout(restartHub, 500));
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
      return;
    }
    const device = listDevices().find((d) => d.serial === serial && d.state === 'device');
    if (!device) return res.status(404).json({ error: 'Plug the device in and unlock it first.' });
    const name = device.name || device.model || 'the device';
    if (action === 'install') {
      const p = progress.get(serial);
      if (p && !p.done && !p.error) return res.json({ ok: true, step: p.step });
      setStep(serial, 'Starting…');
      cache.delete(serial);
      installHub(serial, name).finally(() => cache.delete(serial));
      return res.json({ ok: true });
    }
    if (action === 'make-main') {
      try {
        await makeDeviceMain(serial, name);
        return res.json({ ok: true });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
    }
    res.status(400).json({ error: 'Unknown action.' });
  });
}
