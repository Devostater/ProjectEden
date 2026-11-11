// Phone access. The hub listens on your Wi-Fi so your phone can reach it, which means anyone on the
// same network could too. So every request that does not come from this computer must carry the
// pairing code, either once in the address (?pair=CODE, which then sets a cookie) or as that cookie.
// The code is random, stored in .eden-pairing.json, and can be replaced from the Remote tab, which signs
// out every paired device. Each paired device gets its own sign-in (a random token in a cookie; only its
// hash is stored), so Devices can list them by name and sign one out without touching the others.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-pairing.json');
const COOKIE = 'eden_pair'; // older shared sign-in (the code itself): still accepted, swapped for a device token
const DEVICE_COOKIE = 'eden_dev';

export interface RemoteDevice {
  id: string;
  tokenHashes: string[]; // one device can hold more than one sign-in (e.g. its browser and the Eden app)
  name: string;
  kind: 'phone' | 'tablet' | 'computer';
  agent: string; // short description of the browser/app
  ip: string;
  pairedAt: string;
  lastSeen: string;
}

function newCode() {
  // 8 characters, no look-alikes (0/O, 1/I/L), easy to type on a phone.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

let code = '';
let devices: RemoteDevice[] = [];
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  code = saved.code || '';
  devices = Array.isArray(saved.devices) ? saved.devices : [];
} catch {}
// Older entries had a single tokenHash.
for (const d of devices as any[]) if (!d.tokenHashes) d.tokenHashes = d.tokenHash ? [d.tokenHash] : [], delete d.tokenHash;
// Merge entries made by the same device at the same moment (a page sending many requests at once used to
// make one entry per request). Every sign-in is kept, so nothing gets signed out.
{
  const merged: RemoteDevice[] = [];
  for (const d of [...devices].sort((a, b) => a.pairedAt.localeCompare(b.pairedAt))) {
    const twin = merged.find((m) => m.ip === d.ip && m.agent === d.agent && m.kind === d.kind && Math.abs(new Date(m.pairedAt).getTime() - new Date(d.pairedAt).getTime()) < 5 * 60 * 1000);
    if (twin) {
      twin.tokenHashes = [...new Set([...twin.tokenHashes, ...d.tokenHashes])];
      if (d.lastSeen > twin.lastSeen) twin.lastSeen = d.lastSeen;
    } else merged.push(d);
  }
  devices = merged;
}
const savePairing = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ code, devices }, null, 2), 'utf-8');
  } catch {}
};
if (!code) {
  code = newCode();
  savePairing();
}

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// A readable guess at what the device is, from its browser's description of itself.
function describe(ua = ''): { name: string; kind: RemoteDevice['kind']; agent: string } {
  const browser = /; wv\)/.test(ua) ? 'Eden app' : /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  if (/iPad/.test(ua)) return { name: 'iPad', kind: 'tablet', agent: browser };
  if (/iPhone/.test(ua)) return { name: 'iPhone', kind: 'phone', agent: browser };
  if (/Android/.test(ua)) {
    const model = ua.match(/Android [\d.]+; ([^;)]+)[;)]/)?.[1]?.trim();
    const kind: RemoteDevice['kind'] = !/Mobile/.test(ua) || /^SM-[XTP]/i.test(model || '') ? 'tablet' : 'phone';
    const label = model && model !== 'K' ? model : '';
    return { name: `Android ${kind}${label ? ` (${label})` : ''}`, kind, agent: browser };
  }
  if (/Windows/.test(ua)) return { name: 'Windows computer', kind: 'computer', agent: browser };
  if (/Macintosh/.test(ua)) return { name: 'Mac', kind: 'computer', agent: browser };
  return { name: 'Device', kind: 'computer', agent: browser };
}

const ipOf = (req: Request) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// A page loads many files at once, so one device can arrive with several requests before its new sign-in
// is stored. Requests from the same address and browser within two minutes share one sign-in.
const recentlyAdded = new Map<string, { token: string; at: number }>();

function addDevice(req: Request, res: Response) {
  const ua = String(req.headers['user-agent'] || '');
  const key = `${ipOf(req)}|${ua}`;
  const recent = recentlyAdded.get(key);
  let token: string;
  if (recent && Date.now() - recent.at < 2 * 60 * 1000) token = recent.token;
  else {
    token = crypto.randomBytes(32).toString('hex');
    recentlyAdded.set(key, { token, at: Date.now() });
    const d = describe(ua);
    const now = new Date().toISOString();
    devices.push({ id: crypto.randomBytes(6).toString('hex'), tokenHashes: [hash(token)], ...d, ip: ipOf(req), pairedAt: now, lastSeen: now });
    savePairing();
  }
  res.setHeader('Set-Cookie', [`${DEVICE_COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, `${COOKIE}=; Path=/; Max-Age=0`]);
}

// "Last seen" is kept in memory and written at most once a minute.
let dirty = false;
setInterval(() => {
  if (dirty) {
    dirty = false;
    savePairing();
  }
}, 60000).unref?.();

const isLocal = (req: Request) => {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

const cookieOf = (req: Request, name = COOKIE) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

const same = (a = '', b = '') => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Addresses on this computer that a phone on the same Wi-Fi can use.
const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('100.') ? 2 : 3);

export const pairingCode = () => code;

// True when the request comes from this same computer, even if the hub was opened through its Wi-Fi
// address (for example http://192.168.1.20:3000) instead of "localhost". Only this computer can send
// a request that appears to come from its own address, so this is safe for showing the pairing code.
const fromThisComputer = (req: Request) => {
  if (isLocal(req)) return true;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!ip) return false;
  return Object.values(os.networkInterfaces())
    .flat()
    .some((n) => !!n && n.address === ip);
};

export function lanAddresses(port: number): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal)
    // Home Wi-Fi first, then Tailscale (100.x), then virtual adapters (172.x, used by WSL/Hyper-V).
    .map((n) => n.address)
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => `http://${a}:${port}`);
}

const LOCKED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eden AI Hub</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{max-width:340px;width:100%;text-align:center}input{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:12px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#fff;margin:16px 0}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-size:16px}p{color:#94a3b8;font-size:14px}</style></head>
<body><form method="get"><h1>Eden AI Hub</h1><p>Scan the QR code, or enter the pairing code shown on your computer in the hub's Remote tab.</p>
<input name="pair" autocomplete="off" autocapitalize="characters" required><button>Connect</button></form></body></html>`;

export function registerPairing(app: Express) {
  // Runs before every route.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isLocal(req)) return next();
    const fromQuery = typeof req.query.pair === 'string' ? req.query.pair.trim().toUpperCase() : '';
    if (fromQuery && same(fromQuery, code)) {
      // Already paired (scanning the code again): keep its sign-in instead of adding a duplicate.
      const existing = devices.find((d) => d.tokenHashes.includes(hash(cookieOf(req, DEVICE_COOKIE) || '')));
      if (!existing) addDevice(req, res);
      // Drop the code from the address so it doesn't sit in history.
      return res.redirect(req.path);
    }
    const token = cookieOf(req, DEVICE_COOKIE);
    const device = token ? devices.find((d) => d.tokenHashes.includes(hash(token))) : undefined;
    if (device) {
      const now = Date.now();
      if (now - new Date(device.lastSeen).getTime() > 30000 || device.ip !== ipOf(req)) {
        device.lastSeen = new Date(now).toISOString();
        device.ip = ipOf(req);
        dirty = true;
      }
      return next();
    }
    // Paired before devices had their own sign-in: give it one now, without asking again.
    if (same(cookieOf(req), code)) {
      addDevice(req, res);
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'This device is not paired with the hub.' });
    res.status(401).type('html').send(LOCKED_PAGE);
  });

  // Only shown on this computer.
  app.get('/api/pairing', (req, res) => {
    if (!fromThisComputer(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    res.json({ code, addresses: lanAddresses(Number(process.env.PORT) || 3000) });
  });

  app.post('/api/pairing/reset', (req, res) => {
    if (!fromThisComputer(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    code = newCode();
    devices = []; // a new code signs out every paired device
    savePairing();
    res.json({ code, addresses: lanAddresses(Number(process.env.PORT) || 3000) });
  });

  // Devices paired over Wi-Fi (or Tailscale). Managed only from this computer.
  app.get('/api/remote-devices', (req, res) => {
    if (!fromThisComputer(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    const now = Date.now();
    res.json({
      devices: [...devices]
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .map(({ tokenHashes, ...d }) => ({ ...d, online: now - new Date(d.lastSeen).getTime() < 2 * 60 * 1000 })),
    });
  });
  app.post('/api/remote-devices/:id/:action', express.json(), (req, res) => {
    if (!fromThisComputer(req)) return res.status(403).json({ error: 'Only available on the computer running the hub.' });
    const d = devices.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'That device is no longer paired.' });
    if (req.params.action === 'rename') {
      const name = String(req.body?.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Give it a name.' });
      d.name = name;
    } else if (req.params.action === 'forget') {
      devices = devices.filter((x) => x !== d);
    } else return res.status(400).json({ error: 'Unknown action.' });
    savePairing();
    res.json({ ok: true });
  });
}
