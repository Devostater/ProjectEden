// LYRA panel: lets the owner talk to LYRA directly from the bottom panel, without picking a teammate.
// Like the terminal, it only answers from this computer and from the hub's own page.
import type { Express, Request } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { generate, lyraConnected, pingLyra } from './providers';
import { logActivity } from './activity';

// Where LYRA's Nova.bat lives. The owner can set LYRA_START_PATH to its full path; otherwise we look in the usual place.
function findNovaBat(): string | null {
  const candidates = [
    process.env.LYRA_START_PATH,
    path.join(os.homedir(), 'Documents', 'GITHUB', 'Project-Nova', 'Nova.bat'),
  ].filter((p): p is string => !!p && p.trim() !== '');
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // try the next place
    }
  }
  return null;
}

function fromThisComputer(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function fromOwnPage(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerLyraRoutes(app: Express) {
  app.get('/api/lyra/status', async (_req, res) => {
    await pingLyra(); // check right now, so the page sees LYRA as soon as she is up
    res.json({ connected: lyraConnected() });
  });

  // Opens Nova.bat in its own window on this computer, which starts LYRA.
  app.post('/api/lyra/start', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'LYRA can only be started from the hub on this computer.' });
    await pingLyra();
    if (lyraConnected()) return res.json({ ok: true, already: true });
    if (process.platform !== 'win32') return res.status(400).json({ error: 'Starting LYRA from here only works on the Windows computer.' });
    const bat = findNovaBat();
    if (!bat) return res.status(404).json({ error: "Couldn't find Nova.bat. Add a line LYRA_START_PATH=full path to Nova.bat in the hub's .env.local file, then restart the hub." });
    try {
      const child = spawn('cmd.exe', ['/c', 'start', 'LYRA', '/D', path.dirname(bat), 'cmd', '/k', bat], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => {});
      child.unref();
      logActivity('info', 'LYRA was started from the hub.');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: `Could not start LYRA: ${err?.message || 'unknown error'}` });
    }
  });

  app.post('/api/lyra/chat', async (req, res) => {
    if (!fromThisComputer(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'LYRA can only be talked to from the hub on this computer.' });
    const text = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!text) return res.status(400).json({ error: 'Type a message first.' });
    // Earlier turns of this conversation, kept by the page.
    const earlier = Array.isArray(req.body?.history) ? req.body.history : [];
    const messages = earlier
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    messages.push({ role: 'user', content: text.slice(0, 8000) });
    try {
      const result = await generate({ model: 'lyra', messages });
      res.json({ reply: result.text, model: result.model });
    } catch (err: any) {
      logActivity('error', `LYRA: ${String(err?.message || err).slice(0, 200)}`);
      res.status(502).json({ error: String(err?.message || err) });
    }
  });
}
