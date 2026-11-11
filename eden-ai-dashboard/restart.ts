// "Restart hub": starts a fresh copy of the hub and closes this one, so you don't have to close and reopen Start Eden.
// The new copy waits a few seconds first, so this one has let go of its port by then.
// Only the computer running the hub, from the hub's own page, can do this.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

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

function startNewCopy() {
  if (process.platform === 'win32') {
    // Opens a new window for the hub, like Start Eden does.
    spawn('cmd', ['/c', 'start "EDEN AI Dashboard Server" cmd /c "timeout /t 4 /nobreak >nul & npm run dev"'], {
      cwd: APP_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
  } else {
    spawn('sh', ['-c', 'sleep 4 && npm run dev'], { cwd: APP_DIR, detached: true, stdio: 'ignore' }).unref();
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
  app.post('/api/restart', (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'The hub can only be restarted from this computer.' });
    logActivity('work', 'Hub restarting (asked for from Settings).');
    res.json({ ok: true });
    res.on('finish', () => {
      if (process.env.EDEN_SUPERVISED === '1') return void setTimeout(() => process.exit(0), 300);
      try {
        startNewCopy();
      } catch {
        return; // couldn't start a new copy: keep this one running rather than leave you with no hub
      }
      setTimeout(() => process.exit(0), 300);
    });
  });
}
