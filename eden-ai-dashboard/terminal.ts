// Terminal: runs a command on this computer and returns its output, for the bottom panel.
//
// Running arbitrary commands is the most powerful thing the hub can do, so it is guarded three ways:
//   1. It is OFF until the owner turns it on in Account → Preferences (TERMINAL_ENABLED=1).
//   2. Requests are accepted only from this computer (loopback address).
//   3. Requests must come from the hub's own page (Origin must match the address it was served from),
//      so another website open in the browser cannot trigger a command.
// The AI teammates have no access to this route; only the person at the keyboard does.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 120000;
const MAX_OUTPUT = 200000;

export const terminalEnabled = () => process.env.TERMINAL_ENABLED === '1';

function fromThisComputer(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function fromOwnPage(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false; // browsers always send Origin on POST; anything else is not the hub's page
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerTerminalRoutes(app: Express) {
  app.get('/api/terminal', (_req, res) => {
    res.json({ enabled: terminalEnabled(), cwd: ROOT });
  });

  app.post('/api/terminal', (req, res) => {
    if (!terminalEnabled()) return res.status(403).json({ error: 'The terminal is turned off. Turn it on in Account → Preferences.' });
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'Commands can only be run from the hub on this computer.' });

    const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    let cwd = typeof req.body?.cwd === 'string' && req.body.cwd ? req.body.cwd : ROOT;
    if (!command) return res.status(400).json({ error: 'Type a command first.' });
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) cwd = ROOT;

    // `cd` has to be handled here: each command runs in its own shell, so the folder is remembered by the page.
    const cd = command.match(/^cd(?:\s+(?:\/d\s+)?(.+))?$/i);
    if (cd) {
      const target = path.resolve(cwd, (cd[1] || ROOT).replace(/^["']|["']$/g, ''));
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        return res.json({ output: `No such folder: ${target}`, exitCode: 1, cwd });
      }
      return res.json({ output: '', exitCode: 0, cwd: target });
    }

    logActivity('info', `Terminal: ${command}`);
    const child = spawn(command, { shell: true, cwd, windowsHide: true });
    let output = '';
    let finished = false;
    const add = (d: Buffer) => {
      if (output.length < MAX_OUTPUT) output += d.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const finish = (exitCode: number | null, note = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const clean = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n/g, '\n');
      res.json({ output: (clean.length >= MAX_OUTPUT ? `${clean}\n… output cut off` : clean) + note, exitCode: exitCode ?? 1, cwd });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(124, `\nStopped: still running after ${TIMEOUT_MS / 1000} seconds.`);
    }, TIMEOUT_MS);
    child.on('error', (err) => finish(1, `\n${err.message}`));
    child.on('close', (code) => finish(code));
    child.stdin.end();
  });
}
