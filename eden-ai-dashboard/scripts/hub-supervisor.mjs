// Keeps Eden AI Hub running on this computer.
//   - starts the hub (server.ts) and starts it again if it stops or crashes
//   - restarts it if it stops answering (hung) for about a minute and a half
//   - writes what happened to .eden-logs/hub.log, so "it stopped and I don't know why" has an answer
//   - only one copy runs; a hub that was started some other way is watched, and started here when it stops
// Started by "Open Eden" (hidden) or "Start Eden.bat" (in a window, with the log on screen).
// Add --open to also open the Eden AI Hub app window.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findBuild } from './build-paths.mjs';
import { livePid, RECOVERY_LOCK } from './recover.mjs';

// Console handle: who and what is running in this window, so it's easy to tell apart from other consoles.
process.title = 'Devostater - Eden AI Hub - keeper (closing this window stops Eden)';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;
const HEALTH = `http://127.0.0.1:${PORT}/api/models`;
const LOG_DIR = path.join(APP, '.eden-logs');
const LOG = path.join(LOG_DIR, 'hub.log');
const LOCK = path.join(LOG_DIR, 'supervisor.pid');
const MAX_BOOT_FAILURES = 3;
const STOP_CODE = 64; // the hub exits with this when asked to stop (restart.ts)
const OPEN_APP = process.argv.includes('--open');
const HUB_ENV = { ...process.env, NODE_ENV: 'production', EDEN_SUPERVISED: '1' };

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(line) {
  const d = new Date();
  const stamp = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace('T', ' ').slice(0, 19); // local time
  const text = `${stamp}  ${line}\n`;
  process.stdout.write(text);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2 * 1024 * 1024) fs.renameSync(LOG, path.join(LOG_DIR, 'hub.old.log'));
    fs.appendFileSync(LOG, text);
  } catch {}
}

async function probeHub(timeout = 4000) {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(timeout) });
    return r.headers.get('x-eden-mode') === 'production' && r.status < 500 ? 'production' : 'other';
  } catch {
    return 'offline';
  }
}

async function answering(timeout) {
  return (await probeHub(timeout)) === 'production';
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function openApp() {
  // Always opens Eden's own address, so it can't open a different installed app (LYRA has one too).
  // A Chrome app window if Chrome is installed, otherwise the default browser.
  const url = `http://localhost:${PORT}`;
  const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
  let child;
  if (process.platform === 'win32' && chrome) child = spawn(chrome, [`--app=${url}`], { detached: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

// With --open: the hub window is for this computer; the tablet gets LYRA, on her EDEN page.
// Waits for the hub to answer first (it may still be starting), then asks it to do the opening.
// LYRA's auto-open setting (Eden -> LYRA tab). Off unless turned on; read at start.
function lyraAutoOpen() {
  try { return JSON.parse(fs.readFileSync(path.join(APP, '.eden-lyra-autoopen.json'), 'utf-8')).autoOpen === true; } catch { return false; }
}
async function openLyraOnTablet() {
  if (!lyraAutoOpen()) return log('Auto-open LYRA is off (turn it on in Eden, LYRA tab).');
  for (let i = 0; i < 45 && !(await answering(3000)); i++) await new Promise((r) => setTimeout(r, 2000));
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/devices/open-lyra-on-tablets`, { method: 'POST', signal: AbortSignal.timeout(180000) });
    const j = await r.json().catch(() => ({}));
    log(j.ok ? `Opened LYRA on the tablet (${(j.opened || []).join(', ')}).` : `LYRA was not opened on the tablet: ${j.error || `the hub answered ${r.status}`}`);
  } catch (err) {
    log(`LYRA was not opened on the tablet: ${err?.message || err}`);
  }
}

// ---- one copy only ----
const recoveryRunning = () => livePid(path.join(APP, RECOVERY_LOCK));
if (recoveryRunning()) {
  log('EDEN recovery is running. Start EDEN after it finishes.');
  process.exit(1);
}
const runningHub = await probeHub();
if (runningHub === 'other') {
  log(`Port ${PORT} is already serving a hub or another app without EDEN production mode. Close it and start EDEN again.`);
  process.exit(1);
}
try {
  const other = Number(fs.readFileSync(LOCK, 'utf-8'));
  // A supervisor can still own the hub while it is booting or between retries.
  if (other && other !== process.pid && alive(other)) {
    log(`Already being kept running (supervisor ${other}).`);
    if (OPEN_APP && runningHub === 'production') {
      openApp();
      await openLyraOnTablet();
    }
    process.exit(0);
  }
  if (other && other !== process.pid) log(`Found a leftover lock (process ${other}). Taking over.`);
} catch {}
// A hub started some other way (an old window, a developer tool) isn't touched: it is watched, and when it
// stops, the hub is started here, so from now on it is kept running like any other.
let adopted = false;
if (runningHub === 'production') {
  log('The hub is already running (started some other way). Keeping watch: if it stops, it is started again here.');
  adopted = true;
}
fs.writeFileSync(LOCK, String(process.pid));
function releaseLock() {
  try {
    if (Number(fs.readFileSync(LOCK, 'utf-8')) === process.pid) fs.rmSync(LOCK);
  } catch {}
}
process.on('exit', releaseLock);
if (recoveryRunning()) {
  log('EDEN recovery is running. Start EDEN after it finishes.');
  process.exit(1);
}
const recoveryHint = 'With EDEN closed, run Recover Eden.bat, then run Start Eden.bat.';
if (!adopted && !findBuild(APP)) {
  log('No dashboard build found. Building EDEN for production.');
  const result = spawnSync(process.execPath, ['scripts/build-dashboard.mjs'], {
    cwd: APP, env: HUB_ENV, stdio: 'inherit', windowsHide: true,
  });
  if (result.status !== 0 || !findBuild(APP)) {
    log(`Could not build the EDEN dashboard${result.error ? `: ${result.error.message}` : '.'}`);
    log(recoveryHint);
    process.exit(1);
  }
}

// Whatever goes wrong in here, keep supervising; and always leave a line saying why this stopped.
process.on('uncaughtException', (err) => log(`Supervisor error (carrying on): ${err?.stack || err}`));
process.on('unhandledRejection', (err) => log(`Supervisor error (carrying on): ${err?.stack || err}`));
process.on('exit', (code) => log(`The supervisor stopped (code ${code}). The hub is no longer being kept running.`));

// ---- run and watch ----
let child = null;
let startedAt = 0;
let bootFailures = 0;
let booted = false;
let stopping = false;

function start() {
  startedAt = Date.now();
  booted = false;
  misses = 0;
  log('Starting the hub…');
  const tsx = path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  child = spawn(process.execPath, [tsx, 'server.ts'], { cwd: APP, env: HUB_ENV, windowsHide: true });
  const pipe = (stream, tag) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line && !/^◇ injected env|^\s*$/.test(line)) log(`${tag} ${line}`);
      }
    });
  };
  pipe(child.stdout, '  hub:');
  pipe(child.stderr, '  hub error:');
  child.on('error', error => log(`Could not start the hub: ${error.message}`));
  child.on('close', (code, signal) => {
    child = null;
    if (stopping) return;
    if (code === STOP_CODE) {
      // "Stop the server" in Settings: stop for real. Open Eden or Start Eden starts it again.
      log('The hub was stopped from Settings. Not restarting it; open Eden to start it again.');
      return void setTimeout(() => process.exit(0), 300);
    }
    const ranFor = Math.round((Date.now() - startedAt) / 1000);
    log(`The hub stopped (${signal ? `signal ${signal}` : `exit code ${code}`}) after ${ranFor}s.${code === 0 ? ' (It asked to restart.)' : ''}`);
    if (!booted && ++bootFailures >= MAX_BOOT_FAILURES) {
      log(`EDEN failed to boot ${bootFailures} times. Automatic restarts have stopped. ${recoveryHint}`);
      process.exit(1);
    }
    setTimeout(() => { if (!stopping) start(); }, code === 0 ? 1500 : 3000);
  });
}

// Health check: restart if it hasn't answered for ~90 seconds (after giving it time to start).
let misses = 0;
setInterval(async () => {
  if (adopted && !child) {
    // Watching a hub this supervisor didn't start: take over once it has been gone for about a minute.
    if (await answering(8000)) return void (misses = 0);
    if (++misses < 2) return;
    misses = 0;
    adopted = false;
    log('The hub that was started some other way has stopped. Starting it here.');
    return start();
  }
  const checkedChild = child;
  if (!checkedChild) return;
  const healthy = await answering(10000);
  if (child !== checkedChild || stopping) return;
  if (healthy) {
    booted = true;
    bootFailures = 0;
    misses = 0;
    return;
  }
  if (Date.now() - startedAt < 60000) return;
  misses++;
  if (misses >= 3) {
    log('The hub stopped answering for about 90 seconds. Restarting it.');
    misses = 0;
    child?.kill();
  }
}, 30000); // not unref'd: while only watching a hub started some other way, this keeps the supervisor alive

const shutdown = () => {
  stopping = true;
  log('Closing (the hub stops too).');
  child?.kill();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

if (!adopted) start();
if (OPEN_APP) openLyraOnTablet();
if (OPEN_APP) openApp(); // shows "Starting the hub…" until it answers, then loads by itself
