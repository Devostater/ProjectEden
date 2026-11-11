// Phone access. The hub listens on your Wi-Fi so your phone can reach it, which means anyone on the
// same network could too. So every request that does not come from this computer must carry the
// pairing code, either once in the address (?pair=CODE, which then sets a cookie) or as that cookie.
// The code is random, stored in .eden-pairing.json, and can be replaced from Account → Connections,
// which signs out every paired phone.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request, Response, NextFunction } from 'express';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-pairing.json');
const COOKIE = 'eden_pair';

function newCode() {
  // 8 characters, no look-alikes (0/O, 1/I/L), easy to type on a phone.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

let code = '';
try {
  code = JSON.parse(fs.readFileSync(FILE, 'utf-8')).code || '';
} catch {}
if (!code) {
  code = newCode();
  fs.writeFileSync(FILE, JSON.stringify({ code }), 'utf-8');
}

const isLocal = (req: Request) => {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

const cookieOf = (req: Request) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === COOKIE)?.[1];

const same = (a = '', b = '') => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Addresses on this computer that a phone on the same Wi-Fi can use.
export function lanAddresses(port: number): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${port}`);
}

const LOCKED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eden AI Hub</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{max-width:340px;width:100%;text-align:center}input{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:12px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#fff;margin:16px 0}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-size:16px}p{color:#94a3b8;font-size:14px}</style></head>
<body><form method="get"><h1>Eden AI Hub</h1><p>Enter the pairing code shown on your computer in Account → Connections.</p>
<input name="pair" autocomplete="off" autocapitalize="characters" required><button>Connect</button></form></body></html>`;

export function registerPairing(app: Express) {
  // Runs before every route.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isLocal(req)) return next();
    const fromQuery = typeof req.query.pair === 'string' ? req.query.pair.trim().toUpperCase() : '';
    if (fromQuery && same(fromQuery, code)) {
      res.setHeader('Set-Cookie', `${COOKIE}=${code}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
      // Drop the code from the address so it doesn't sit in history.
      return res.redirect(req.path);
    }
    if (same(cookieOf(req), code)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'This device is not paired with the hub.' });
    res.status(401).type('html').send(LOCKED_PAGE);
  });

  // Only shown on this computer.
  app.get('/api/pairing', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    res.json({ code, addresses: lanAddresses(Number(process.env.PORT) || 3000) });
  });

  app.post('/api/pairing/reset', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    code = newCode();
    fs.writeFileSync(FILE, JSON.stringify({ code }), 'utf-8');
    res.json({ code, addresses: lanAddresses(Number(process.env.PORT) || 3000) });
  });
}
