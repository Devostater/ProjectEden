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
import { activeUpdateNames } from './updates';
import { runningCardNames } from './cardRunner';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

function startNewCopy() {
  // The supervisor (scripts/hub-supervisor.mjs) starts the hub and keeps it running; plain "npm start" is the fallback.
  const command = fs.existsSync(path.join(APP_DIR, 'scripts', 'hub-supervisor.mjs')) ? 'node scripts/hub-supervisor.mjs' : 'npm start';
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

// Set once a restart has been accepted, so a second quick press doesn't log or start it again.
let restartRequested = false;

// Code updates and card jobs that a restart would cut off.
function runningWork() {
  const updates = activeUpdateNames();
  const cardNames = runningCardNames();
  const codeUpdates = updates.working.length + updates.queued.length;
  const interrupted = [
    ...updates.working.map((n) => `Code update being worked on: ${n}`),
    ...updates.queued.map((n) => `Code update waiting in the queue: ${n}`),
    ...cardNames.map((n) => `Card being written: ${n}`),
  ];
  return { codeUpdates, cards: cardNames.length, interrupted };
}

export function registerRestartRoutes(app: Express) {
  app.post('/api/stop-server', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'The hub can only be stopped from this computer, or from a device with "Code updates" switched on.' });
    logActivity('work', 'Hub server stopping (asked for from Settings).');
    res.json({ ok: true });
    res.on('finish', () => {
      // 64 tells scripts/hub-supervisor.mjs to stop for real; exit code 0 means "restart me".
      setTimeout(() => process.exit(64), 300);
    });
  });

  // Lets the Settings page ask "is anything still running?" before it restarts the hub.
  app.get('/api/restart/status', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'The hub can only be restarted from this computer, or from a device with "Code updates" switched on.' });
    res.json(runningWork());
  });

  app.post('/api/restart', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'The hub can only be restarted from this computer, or from a device with "Code updates" switched on.' });
    // Pressed twice quickly: the restart is already on its way, so don't log it or start it again.
    if (restartRequested) return res.json({ ok: true });
    // Warn first if a restart would cut off work in progress. "force" means the owner has seen the list and wants to go ahead.
    const { interrupted, codeUpdates, cards } = runningWork();
    if (interrupted.length) {
      const summary = `${interrupted.length} thing${interrupted.length === 1 ? '' : 's'} in progress`;
      if (req.body?.force !== true) {
        logActivity('info', `Hub restart skipped: ${summary} would have been interrupted. ${interrupted.join('; ')}.`);
        return res.status(409).json({
          error: 'A restart now would interrupt work that is still going.',
          interrupted,
          codeUpdates,
          cards,
        });
      }
      logActivity('work', `Hub restarting anyway (asked for from Settings): ${summary} will be interrupted. ${interrupted.join('; ')}.`);
    } else {
      logActivity('work', 'Hub restarting (asked for from Settings).');
    }
    restartRequested = true;
    res.json({ ok: true });
    // restartHub keeps this copy running if a new one can't be started, rather than leave you with no hub.
    res.on('finish', () => restartHub());
  });
}
