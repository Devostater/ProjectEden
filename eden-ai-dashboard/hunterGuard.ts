// 🐺 Front-door checks from HUNTER (C:\AZI\HUNTER\lib\guard.js), the AZI-wide defence app, so EDEN stops the same
// attacks LYRA does and HUNTER hears about each one. Found in a cat-and-mouse test on 2026-11-20, where both worked:
//  1. DNS rebinding: a web page points its own name at 127.0.0.1 and then reads EDEN as if it were "its own site"
//     (projects, chats, settings). Stopped by only answering to names that are really this PC.
//  2. Cross-site changes: any website you have open could POST to EDEN's API in the background (edit projects,
//     agendas, cards), because requests from this PC need no pairing. Stopped by the browser's Sec-Fetch-Site label
//     and the Origin header. Tools on this PC that call EDEN directly (LYRA, scripts) send neither, so they still work.
// Runs before pairing. Works without HUNTER too (same checks, just nobody is told).
import type { Express, NextFunction, Request, Response } from 'express';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

type Guard = { hostOk: (h?: string) => boolean; clientIp: (req: Request) => string; report: (ev: Record<string, unknown>) => void };

function loadGuard(appDir: string): Guard | null {
  const dirs = [process.env.HUNTER_DIR, path.resolve(appDir, '..', '..', 'HUNTER'), 'C:/AZI/HUNTER'].filter(Boolean) as string[];
  for (const d of dirs) {
    const f = path.join(d, 'lib', 'guard.js');
    if (!fs.existsSync(f)) continue;
    try { return createRequire(import.meta.url)(f).create({ name: 'EDEN' }); } catch { /* try the next place */ }
  }
  return null;
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/i.test(h);
// Same rule as HUNTER's, for a PC without HUNTER.
const hostOkLocal = (hostHeader?: string) => {
  if (!hostHeader) return true;
  const h = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || isIp(h) || h === os.hostname().toLowerCase() || /\.(ts\.net|local|lan|home)$/.test(h);
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerHunterGuard(app: Express, appDir: string) {
  const guard = loadGuard(appDir);
  const told = new Map<string, number>();
  const tell = (req: Request, kind: string, text: string) => {
    if (!guard) return;
    const ip = guard.clientIp(req) || '';
    const k = ip + kind, now = Date.now();
    if (now - (told.get(k) || 0) < 600000) return; // once per sender and kind every 10 minutes
    told.set(k, now);
    guard.report({ app: 'EDEN', level: 'medium', kind, text, ip });
  };
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host;
    if (!(guard ? guard.hostOk(host) : hostOkLocal(host))) {
      tell(req, 'bad-host', `Request for a strange name (${String(host).slice(0, 60)}): possible DNS rebinding.`);
      return res.status(403).json({ error: 'EDEN only answers to its own address.' });
    }
    if (req.path.startsWith('/api/')) {
      const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
      const origin = req.headers.origin;
      let foreign = site === 'cross-site' || (site === 'same-site' && WRITES.has(req.method));
      if (!foreign && origin && WRITES.has(req.method)) {
        try { foreign = new URL(origin).host !== host; } catch { foreign = true; }
      }
      if (foreign) {
        tell(req, 'cross-site', `Another website (${String(origin || site).slice(0, 60)}) tried to use ${req.path}.`);
        return res.status(403).json({ error: 'Not allowed from another site.' });
      }
    }
    next();
  });
}
