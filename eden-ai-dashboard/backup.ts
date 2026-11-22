// Backups of the hub: its code (including changes not saved in git yet) and its data (projects, team,
// chats, settings and keys). Saved as zip files in your user folder (.eden-hub\backups), outside the hub
// folder, so a bad update or undo can't take them with it.
//   - "Back up now" any time (Account → Settings)
//   - automatically once a day (checked every hour; waits while the PC is busy)
//   - the newest 14 are kept
//   - optional: also copy each new backup to another folder (a USB drive or a private synced folder),
//     with the same newest-14 rule there. The zip contains keys, so that folder must be private.
// Left out: node_modules, built files, logs and the Android build folders (all can be rebuilt).
import { spawn } from 'child_process';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { pcBusy } from './busy';
import { createBackupArchive, publishVerifiedBackup, requiredBackupFiles } from './scripts/backup-archive.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = path.join(os.homedir(), '.eden-hub', 'backups');
const KEEP = 14;
const DAY = 24 * 60 * 60 * 1000;

let running = false;
let lastError = '';
let lastCopyError = '';

// The optional second place for backups (a USB drive or a private synced folder). Empty = not used.
const copyFolder = () => (process.env.BACKUP_COPY_DIR || '').trim();

function list(dir = BACKUP_DIR) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^eden-hub-.*\.zip$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
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

// Checks that the extra folder can be used: it must already exist (so an unplugged drive is noticed
// instead of a new folder being made) and we must be able to write to it. Returns '' when fine,
// otherwise a plain sentence saying what is wrong.
export function checkCopyFolder(dir: string): string {
  if (!dir) return 'No folder chosen.';
  if (!path.isAbsolute(dir)) return `"${dir}" isn't a full folder path (for example E:\\Backups).`;
  if (path.resolve(dir).toLowerCase() === path.resolve(BACKUP_DIR).toLowerCase()) return 'Pick a different folder from the one the hub already saves backups in.';
  try {
    if (!fs.statSync(dir).isDirectory()) return `"${dir}" is a file, not a folder.`;
  } catch {
    return `The folder "${dir}" wasn't found. Is the drive plugged in?`;
  }
  const probe = path.join(dir, `.eden-hub-test-${process.pid}.tmp`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (err: any) {
    return `Can't write to "${dir}": ${err.code === 'EACCES' || err.code === 'EPERM' ? 'no permission' : err.message}`;
  }
  return '';
}

// Copies the new zip to the extra folder and keeps only the newest KEEP there. Never throws: the
// backup in the hub's own folder already worked, so a problem here is reported but doesn't undo it.
async function copyToExtraFolder(source: string, name: string, required: string[]) {
  const dir = copyFolder();
  lastCopyError = '';
  if (!dir) return;
  const part = path.join(dir, `${name}.part`);
  try {
    const problem = checkCopyFolder(dir);
    if (problem) throw new Error(problem);
    const dest = path.join(dir, name);
    // Copy under a temporary name first so a half-copied file is never mistaken for a backup.
    await fs.promises.copyFile(source, part);
    await publishVerifiedBackup(part, dest, required);
    for (const old of list(dir).filter((backup) => backup.name !== name).slice(KEEP - 1)) fs.rmSync(path.join(dir, old.name), { force: true });
    logActivity('done', `Copied backup to ${dir}`);
  } catch (err: any) {
    await fs.promises.rm(part, { force: true }).catch(() => {});
    lastCopyError = err.message;
    logActivity('error', `Couldn't copy the backup to ${dir}: ${err.message}`);
  }
}

export async function backupNow(auto = false): Promise<{ name: string; sizeMb: number }> {
  if (running) throw new Error('A backup is already running.');
  running = true;
  lastError = '';
  const name = `eden-hub-${stamp()}-${randomUUID().slice(0, 8)}${auto ? '-auto' : ''}.zip`;
  const out = path.join(BACKUP_DIR, name);
  let staging: string | undefined;
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    staging = await fs.promises.mkdtemp(path.join(BACKUP_DIR, '.eden-staging-'));
    const pending = path.join(staging, name);
    const required = await requiredBackupFiles(APP_DIR);
    await createBackupArchive(APP_DIR, pending);
    const bytes = await publishVerifiedBackup(pending, out, required);
    for (const old of list().filter((backup) => backup.name !== name).slice(KEEP - 1)) {
      fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
    }
    const sizeMb = Math.round((bytes / 1024 / 1024) * 10) / 10;
    logActivity('done', `Full backup zip saved (${sizeMb} MB${auto ? ', daily' : ''}).`);
    await copyToExtraFolder(out, name, required);
    return { name, sizeMb };
  } catch (err: any) {
    lastError = err.message;
    logActivity('error', `Full backup zip didn't finish: ${err.message}`);
    throw err;
  } finally {
    if (staging) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
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
    res.json({ backups: list(), running, error: lastError, folder: BACKUP_DIR, copyFolder: copyFolder(), copyError: lastCopyError });
  });
  // "Test it": checks a folder the owner typed (saved or not) without changing anything.
  app.post('/api/backups/test-folder', (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Only from the hub on this computer.' });
    const dir = typeof req.body?.folder === 'string' ? req.body.folder.trim() : '';
    const problem = checkCopyFolder(dir);
    res.json(problem ? { ok: false, message: problem } : { ok: true, message: `Works: the hub can save backups to ${dir}.` });
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
