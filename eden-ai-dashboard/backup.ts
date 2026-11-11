// Backups of the hub: its code (including changes not saved in git yet) and its data (projects, team,
// chats, settings and keys). Saved as zip files in your user folder (.eden-hub\backups), outside the hub
// folder, so a bad update or undo can't take them with it.
//   - "Back up now" any time (Account → Settings)
//   - automatically once a day (checked every hour; waits while the PC is busy)
//   - the newest 14 are kept
// Left out: node_modules, built files, logs and the Android build folders (all can be rebuilt).
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { pcBusy } from './busy';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = path.join(os.homedir(), '.eden-hub', 'backups');
const KEEP = 14;
const DAY = 24 * 60 * 60 * 1000;
const EXCLUDE = ['node_modules', './dist', './.eden-logs', './mobile/android/app/build', './mobile/android/.gradle', './mobile/android/build', '*.apk', '*.zip'];

let running = false;
let lastError = '';

function list() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^eden-hub-.*\.zip$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, sizeMb: Math.round((st.size / 1024 / 1024) * 10) / 10, at: st.mtime.toISOString(), auto: f.includes('-auto') };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export async function backupNow(auto = false): Promise<{ name: string; sizeMb: number }> {
  if (running) throw new Error('A backup is already running.');
  running = true;
  lastError = '';
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `eden-hub-${stamp()}${auto ? '-auto' : ''}.zip`;
  const out = path.join(BACKUP_DIR, name);
  try {
    // Windows' own tar writes zip files (-a picks the format from the .zip name).
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'zip';
    const args = process.platform === 'win32' ? ['-a', '-c', '-f', out, ...EXCLUDE.flatMap((e) => ['--exclude', e]), '-C', APP_DIR, '.'] : ['-r', '-q', out, '.', ...EXCLUDE.flatMap((e) => ['-x', `${e.replace(/^\.\//, '')}/*`])];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(tar, args, { cwd: APP_DIR, windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-1)[0] || `stopped with code ${code}`));
      });
    });
    for (const old of list().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
    const sizeMb = Math.round((fs.statSync(out).size / 1024 / 1024) * 10) / 10;
    logActivity('done', `Backed up the hub (${sizeMb} MB${auto ? ', daily backup' : ''}).`);
    return { name, sizeMb };
  } catch (err: any) {
    fs.rmSync(out, { force: true });
    lastError = err.message;
    logActivity('error', `Backup didn't finish: ${err.message}`);
    throw err;
  } finally {
    running = false;
  }
}

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

export function registerBackupRoutes(app: Express) {
  // Daily backup: checked a minute after starting, then every hour.
  const daily = () => {
    const last = list()[0];
    if (running || pcBusy() || (last && Date.now() - new Date(last.at).getTime() < DAY)) return;
    backupNow(true).catch(() => {});
  };
  setTimeout(daily, 60000).unref?.();
  setInterval(daily, 60 * 60 * 1000).unref?.();

  app.get('/api/backups', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    res.json({ backups: list(), running, error: lastError, folder: BACKUP_DIR });
  });
  app.post('/api/backups', async (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Only from the hub on this computer.' });
    try {
      res.json(await backupNow(false));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/backups/open-folder', (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Only from the hub on this computer.' });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [BACKUP_DIR], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true });
  });
}
