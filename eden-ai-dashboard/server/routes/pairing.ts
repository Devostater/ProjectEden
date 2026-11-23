// Pair a device with a code from the owner PC, then authenticate it with a revocable cookie.
import { hubPort } from '../../config.mjs';
import crypto from 'crypto';
import { jsonObject, jsonStore } from '../../jsonStore.ts';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isLocal, mayManage, mayUseTabletRoute } from '../../permissions.ts';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

const FILE = path.join(fileURLToPath(new URL('../../', import.meta.url)), '.eden-pairing.json');
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

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function newCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

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

const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('100.') ? 2 : 3);

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

function readPairing(file: string) {
  return jsonStore<{ code: string; devices?: RemoteDevice[] }>(file, (value) =>
    jsonObject(value) && typeof value.code === 'string' && value.code.length > 0 &&
    (value.devices === undefined || (Array.isArray(value.devices) && value.devices.every((device) =>
      jsonObject(device) && typeof device.pairedAt === 'string' &&
      (device.tokenHashes === undefined || (Array.isArray(device.tokenHashes) &&
        device.tokenHashes.every((token) => typeof token === 'string'))) &&
      (device.tokenHash === undefined || typeof device.tokenHash === 'string')))),
    // An older backup may contain a revoked session or a replaced code.
    2, () => ({ code: newCode(), devices: [] }));
}

const defaultPairing = () => pairing ??= createPairing(FILE, Date.now);
let pairing: ReturnType<typeof createPairing> | undefined;
export const pairingCode = () => defaultPairing().code();

function createPairing(file: string, now: () => number) {
  const store = readPairing(file);
  const saved = store.read();
  let code = saved?.code ?? newCode();
  let devices = (saved?.devices ?? []).map((device: RemoteDevice & { tokenHash?: string; trusted?: boolean }) => {
    const { tokenHash, trusted, ...current } = device;
    return { ...current, tokenHashes: current.tokenHashes ?? (tokenHash ? [tokenHash] : []) };
  });
  if (!saved) store.write({ code, devices });

  let dirty = false;
  let attempts = new Map<string, number>();
  let retryAt = 0;
  let totalWrong = 0;

  const expires = (device: RemoteDevice) => Date.parse(device.pairedAt) + SESSION_SECONDS * 1000;
  const deviceOf = (req: Request) => {
    const token = req.headers.cookie?.match(/(?:^|;\s*)eden_dev=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) return;
    const digest = hash(token);
    return devices.find((device) => expires(device) > now() && device.tokenHashes.includes(digest));
  };
  const save = (nextCode: string, nextDevices: RemoteDevice[]) => {
    try {
      store.write({ code: nextCode, devices: nextDevices });
      code = nextCode;
      devices = nextDevices;
      dirty = false;
      return true;
    } catch (error) {
      console.error('[EDEN pairing] Could not save paired devices:', error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  return {
    code: () => code,
    register(app: Express) {
      const timer = setInterval(() => { if (dirty) save(code, devices); }, 60000);
      timer.unref();

      app.use((req: Request, res: Response, next: NextFunction) => {
        if (isLocal(req)) return next();
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        const device = deviceOf(req);
        if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html') && req.query.pair !== undefined) {
          const time = now();
          if (time >= retryAt) {
            attempts = new Map();
            totalWrong = 0;
            retryAt = time + ATTEMPT_WINDOW_MS;
          }
          const ip = ipOf(req);
          if ((attempts.get(ip) ?? 0) >= MAX_ATTEMPTS || totalWrong >= 100) {
            res.set('Retry-After', String(Math.ceil((retryAt - time) / 1000)));
            return res.status(429).send('Too many pairing attempts. Try again in a few minutes.');
          }
          const candidate = typeof req.query.pair === 'string' ? req.query.pair.trim().toUpperCase() : '';
          if (!crypto.timingSafeEqual(Buffer.from(hash(candidate), 'hex'), Buffer.from(hash(code), 'hex'))) {
            attempts.set(ip, (attempts.get(ip) ?? 0) + 1);
            totalWrong++;
            return res.status(401).type('html').send(LOCKED_PAGE);
          }
          if (!device) {
            const token = crypto.randomBytes(32).toString('hex');
            const iso = new Date(time).toISOString();
            const entry = { id: crypto.randomBytes(6).toString('hex'), tokenHashes: [hash(token)],
              ...describe(req.get('user-agent')), ip, pairedAt: iso, lastSeen: iso };
            if (!save(code, [...devices.filter((other) => expires(other) > time), entry])) {
              return res.status(503).send('Could not save this pairing.');
            }
            res.cookie(DEVICE_COOKIE, token, { path: '/', maxAge: SESSION_SECONDS * 1000,
              httpOnly: true, sameSite: 'lax', secure: req.secure });
          }
          return res.redirect('/');
        }
        if (!device) {
          if (req.path.toLowerCase().startsWith('/api/')) return res.status(401).json({ error: 'This device is not paired with the hub.' });
          return res.status(401).type('html').send(LOCKED_PAGE);
        }
        if (!mayUseTabletRoute(req)) return res.status(403).json({ error: 'This feature is only available on the computer running the hub.' });
        if (now() - Date.parse(device.lastSeen) > 30000 || device.ip !== ipOf(req)) {
          device.lastSeen = new Date(now()).toISOString();
          device.ip = ipOf(req);
          dirty = true;
        }
        return next();
      });

      const ownerInfo = () => ({ code, addresses: lanAddresses(hubPort()) });
      app.get('/api/pairing', (_req, res) => res.set('Cache-Control', 'no-store').json(ownerInfo()));

      app.post('/api/pairing/reset', (req, res) => {
        if (!mayManage(req)) return res.status(403).json({ error: 'Use the hub page on this computer.' });
        if (!save(newCode(), [])) return res.status(503).json({ error: 'Could not reset pairing.' });
        res.set('Cache-Control', 'no-store').json(ownerInfo());
      });

      app.get('/api/me', (req, res) => {
        const local = isLocal(req);
        const device = local ? undefined : deviceOf(req);
        res.set('Cache-Control', 'no-store').json({ local,
          device: device && { id: device.id, name: device.name, kind: device.kind }, codeUpdates: local });
      });

      app.get('/api/remote-devices', (_req, res) => {
        const time = now();
        res.json({ devices: devices.filter((device) => expires(device) > time)
          .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
          .map(({ tokenHashes, ...device }) => ({ ...device, online: time - Date.parse(device.lastSeen) < 120000 })) });
      });

      app.post('/api/remote-devices/:id/:action', express.json(), (req, res) => {
        if (!mayManage(req)) return res.status(403).json({ error: 'Use the hub page on this computer.' });
        const device = devices.find((entry) => entry.id === req.params.id);
        if (!device) return res.status(404).json({ error: 'That device is no longer paired.' });

        let nextDevices: RemoteDevice[];
        if (req.params.action === 'rename') {
          const name = String(req.body?.name || '').trim().slice(0, 40);
          if (!name) return res.status(400).json({ error: 'Give it a name.' });
          nextDevices = devices.map((entry) => entry === device ? { ...entry, name } : entry);
        } else if (req.params.action === 'forget') {
          nextDevices = devices.filter((entry) => entry !== device);
        } else return res.status(400).json({ error: 'Unknown action.' });

        if (!save(code, nextDevices)) return res.status(503).json({ error: 'Could not save the device change.' });
        res.json({ ok: true });
      });
    },
  };
}

export function registerPairing(app: Express, options?: { file: string; now: () => number }) {
  const state = options ? createPairing(options.file, options.now) : defaultPairing();
  state.register(app);
}
