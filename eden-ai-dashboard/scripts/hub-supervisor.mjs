// Keeps Eden AI Hub running on this computer.
//   - starts the hub (server.ts) and starts it again if it stops or crashes
//   - restarts it if it stops answering (hung) for about a minute and a half
//   - writes what happened to .eden-logs/hub.log, so "it stopped and I don't know why" has an answer
//   - only one copy runs: if a hub is already answering on port 3000, it just exits
// Started by "Open Eden" (hidden) or "Start Eden.bat" (in a window, with the log on screen).
// Add --open to also open the Eden AI Hub app window.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;
const HEALTH = `http://127.0.0.1:${PORT}/api/models`;
const LOG_DIR = path.join(APP, '.eden-logs');
const LOG = path.join(LOG_DIR, 'hub.log');
const LOCK = path.join(LOG_DIR, 'supervisor.pid');
const OPEN_APP = process.argv.includes('--open');

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

async function answering(timeout = 4000) {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(timeout) });
    return r.status < 500;
  } catch {
    return false;
  }
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
  // The installed Chrome app if there is one, otherwise a Chrome app window, otherwise the default browser.
  const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
  const appId = 'hbblfifohofgngfbjbiimbbcimepbdcb';
  let child;
  if (process.platform === 'win32' && fs.existsSync(chrome[0])) child = spawn(chrome[0], ['--profile-directory=Default', `--app-id=${appId}`], { detached: true, stdio: 'ignore' });
  else if (process.platform === 'win32' && fs.existsSync(chrome[1])) child = spawn(chrome[1], [`--app=http://localhost:${PORT}`], { detached: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', `http://localhost:${PORT}`] : [`http://localhost:${PORT}`], { detached: true, stdio: 'ignore' });
  child.unref();
}

// ---- one copy only ----
try {
  const other = Number(fs.readFileSync(LOCK, 'utf-8'));
  if (other && other !== process.pid && alive(other)) {
    log(`Already being kept running (supervisor ${other}).`);
    if (OPEN_APP) openApp();
    process.exit(0);
  }
} catch {}
if (await answering()) {
  log('The hub is already running (started some other way). Nothing to do.');
  if (OPEN_APP) openApp();
  process.exit(0);
}
fs.writeFileSync(LOCK, String(process.pid));

// ---- run and watch ----
let child = null;
let startedAt = 0;
let quickCrashes = 0;
let stopping = false;

function start() {
  startedAt = Date.now();
  log('Starting the hub…');
  const tsx = path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  child = spawn(process.execPath, [tsx, 'server.ts'], { cwd: APP, env: { ...process.env, EDEN_SUPERVISED: '1' }, windowsHide: true });
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
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    const ranFor = Math.round((Date.now() - startedAt) / 1000);
    log(`The hub stopped (${signal ? `signal ${signal}` : `exit code ${code}`}) after ${ranFor}s.${code === 0 ? ' (It asked to restart.)' : ''}`);
    quickCrashes = code !== 0 && ranFor < 30 ? quickCrashes + 1 : 0;
    // Crashing straight away again and again: wait longer, so the PC isn't kept busy.
    const wait = quickCrashes >= 3 ? 60000 : code === 0 ? 1500 : 3000;
    if (quickCrashes >= 3) log('It keeps stopping right after starting. Waiting a minute before trying again; see the lines above for the reason.');
    setTimeout(start, wait);
  });
}

// Health check: restart if it hasn't answered for ~90 seconds (after giving it time to start).
let misses = 0;
setInterval(async () => {
  if (!child || Date.now() - startedAt < 60000) return;
  if (await answering(10000)) {
    misses = 0;
    return;
  }
  misses++;
  if (misses >= 3) {
    log('The hub stopped answering for about 90 seconds. Restarting it.');
    misses = 0;
    child?.kill();
  }
}, 30000).unref();

const shutdown = () => {
  stopping = true;
  log('Closing (the hub stops too).');
  child?.kill();
  try {
    if (Number(fs.readFileSync(LOCK, 'utf-8')) === process.pid) fs.rmSync(LOCK);
  } catch {}
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

start();
if (OPEN_APP) openApp(); // shows "Starting the hub…" until it answers, then loads by itself
