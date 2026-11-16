// "Restart hub": starts a fresh copy of the hub and closes this one, so you don't have to close and reopen Start Eden.
// The new copy waits a few seconds first, so this one has let go of its port by then.
// Only the hub's own page can do this: on the computer running the hub, or on a paired device with "Code updates" switched on.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { logActivity } from './activity';
import { mayManage } from './pairing';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

function startNewCopy() {
  // The supervisor (scripts/hub-supervisor.mjs) starts the hub and keeps it running; plain "npm run dev" is the fallback.
  const command = fs.existsSync(path.join(APP_DIR, 'scripts', 'hub-supervisor.mjs')) ? 'node scripts/hub-supervisor.mjs' : 'npm run dev';
  if (process.platform === 'win32') {
    // Opens a new window for the hub, like Start Eden does.
    spawn('cmd', ['/c', `start "EDEN AI Dashboard Server" cmd /c "timeout /t 4 /nobreak >nul & ${command}"`], {
      cwd: APP_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
  } else {
    spawn('sh', ['-c', `sleep 4 && ${command}`], { cwd: APP_DIR, detached: true, stdio: 'ignore' }).unref();
  }
}

// Starts a fresh copy of the hub and closes this one.
export function restartHub() {
  // Kept running by scripts/hub-supervisor.mjs: just stop, and it starts a fresh copy.
  if (process.env.EDEN_SUPERVISED === '1') return void setTimeout(() => process.exit(0), 300);
  try {
    startNewCopy();
  } catch {
    return;
  }
  setTimeout(() => process.exit(0), 300);
}

export function registerRestartRoutes(app: Express) {
  app.post('/api/stop-server', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'The hub can only be stopped from this computer, or from a device with "Code updates" switched on.' });
    logActivity('work', 'Hub server stopping (asked for from Settings).');
    res.json({ ok: true });
    res.on('finish', () => {
      setTimeout(() => process.exit(0), 300);
    });
  });

  app.post('/api/restart', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'The hub can only be restarted from this computer, or from a device with "Code updates" switched on.' });
    logActivity('work', 'Hub restarting (asked for from Settings).');
    res.json({ ok: true });
    // restartHub keeps this copy running if a new one can't be started, rather than leave you with no hub.
    res.on('finish', () => restartHub());
  });
}
