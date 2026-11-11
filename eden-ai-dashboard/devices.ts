// Devices: Android tablets and phones plugged into this computer by USB (with USB debugging allowed).
// For each one the hub can route its own address (and LYRA's) through the cable, so the device opens
// http://localhost:3000 and counts as this computer: no Wi-Fi and no pairing code needed.
// Devices connect by themselves when plugged in (unless you pressed Disconnect on them).
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { lanAddresses, pairingCode } from './pairing';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-devices.json');
const PORTS = [3000, 4777, 24678]; // the hub, LYRA, and the page's live-update connection

const ADB_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge', 'tools', 'platform-tools', 'adb.exe'),
  'adb',
];
const adbPath = () => ADB_CANDIDATES.find((p) => p === 'adb' || fs.existsSync(p)) || 'adb';

export const adb = (args: string[], timeout = 15000) => {
  const r = spawnSync(adbPath(), args, { encoding: 'utf-8', windowsHide: true, timeout });
  return { ok: r.status === 0, out: `${r.stdout || ''}`.trim(), err: `${r.stderr || ''}`.trim() };
};

let remembered: string[] = []; // serials that connect automatically whenever they are plugged in
let declined: string[] = []; // serials the owner pressed Disconnect on: these are left alone until Connect is pressed
let wifiReady: string[] = []; // serials already paired for Wi-Fi (so they keep working unplugged)
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (Array.isArray(saved)) remembered = saved; // older file: just the list of devices
  else {
    remembered = Array.isArray(saved?.auto) ? saved.auto : [];
    declined = Array.isArray(saved?.declined) ? saved.declined : [];
    wifiReady = Array.isArray(saved?.wifi) ? saved.wifi : [];
  }
} catch {}
const save = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ auto: remembered, declined, wifi: wifiReady }), 'utf-8');
  } catch {}
};

interface DeviceInfo {
  serial: string;
  state: string; // device, unauthorized, offline
  model?: string;
  name?: string;
  android?: string;
  cores?: number;
  ramGb?: number;
  battery?: number;
  connected: boolean; // the hub is routed through the cable
  auto: boolean;
  wifi: boolean; // paired for Wi-Fi too
  wifiIp?: string; // its address on Wi-Fi, to match it with the same device in the Wi-Fi list
}

const infoCache = new Map<string, Partial<DeviceInfo>>();
const batteryCache = new Map<string, { level?: number; at: number }>();
const wifiIpCache = new Map<string, { ip?: string; at: number }>();
function wifiIp(serial: string) {
  const c = wifiIpCache.get(serial);
  if (c && Date.now() - c.at < 60000) return c.ip;
  const ip = adb(['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']).out.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
  wifiIpCache.set(serial, { ip, at: Date.now() });
  return ip;
}
function battery(serial: string) {
  const c = batteryCache.get(serial);
  if (c && Date.now() - c.at < 60000) return c.level;
  const level = Number(adb(['-s', serial, 'shell', 'dumpsys', 'battery']).out.match(/level:\s*(\d+)/)?.[1]) || undefined;
  batteryCache.set(serial, { level, at: Date.now() });
  return level;
}

// This computer, shown at the top of Devices. CPU use is measured between two calls.
let lastCpu = os.cpus().map((c) => c.times);
export function thisPc() {
  const now = os.cpus();
  let busy = 0;
  let total = 0;
  now.forEach((c, i) => {
    const a = lastCpu[i] || c.times;
    const t = (k: keyof typeof c.times) => c.times[k] - a[k];
    const all = t('user') + t('nice') + t('sys') + t('idle') + t('irq');
    busy += all - t('idle');
    total += all;
  });
  lastCpu = now.map((c) => c.times);
  return {
    name: os.hostname(),
    cpu: now[0]?.model.replace(/\s+/g, ' ').trim(),
    cores: now.length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    cpuPercent: total ? Math.round((busy / total) * 100) : 0,
    os: `${os.type() === 'Windows_NT' ? 'Windows' : os.type()} ${os.release()}`,
  };
}

function details(serial: string): Partial<DeviceInfo> {
  if (infoCache.has(serial)) return infoCache.get(serial)!;
  const prop = (k: string) => adb(['-s', serial, 'shell', 'getprop', k]).out;
  const mem = adb(['-s', serial, 'shell', 'cat', '/proc/meminfo']).out.match(/MemTotal:\s+(\d+)/);
  const cores = adb(['-s', serial, 'shell', 'cat', '/sys/devices/system/cpu/present']).out.match(/(\d+)-(\d+)/);
  const info: Partial<DeviceInfo> = {
    model: prop('ro.product.model'),
    name: prop('ro.product.marketname') || prop('ro.product.vendor.marketname') || prop('ro.product.model'),
    android: prop('ro.build.version.release'),
    ramGb: mem ? Math.round((Number(mem[1]) / 1024 / 1024) * 10) / 10 : undefined,
    cores: cores ? Number(cores[2]) - Number(cores[1]) + 1 : undefined,
  };
  infoCache.set(serial, info);
  return info;
}

function routed(serial: string): boolean {
  const list = adb(['-s', serial, 'reverse', '--list']).out;
  return list.includes('tcp:3000 tcp:3000');
}

// Remote setup: open the hub's Wi-Fi link (with the pairing code) on the device once, so its browser is
// paired and the hub keeps working there over Wi-Fi after the cable comes out.
function setupWifi(serial: string): boolean {
  const address = lanAddresses(Number(process.env.PORT) || 3000)[0];
  if (!address) return false;
  const r = adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `${address}/?pair=${pairingCode()}`]);
  if (!r.ok) return false;
  if (!wifiReady.includes(serial)) wifiReady.push(serial);
  save();
  return true;
}

function connect(serial: string) {
  for (const p of PORTS) adb(['-s', serial, 'reverse', `tcp:${p}`, `tcp:${p}`]);
  return routed(serial);
}

export function listDevices(): DeviceInfo[] {
  const r = adb(['devices']);
  if (!r.ok) return [];
  return r.out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([serial, state]) => {
      const ready = state === 'device';
      const extra = ready ? details(serial) : {};
      return { serial, state, ...extra, battery: ready ? battery(serial) : undefined, wifiIp: ready ? wifiIp(serial) : undefined, connected: ready && routed(serial), auto: remembered.includes(serial), wifi: wifiReady.includes(serial) };
    });
}

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerDeviceRoutes(app: Express) {
  // Connect any phone or tablet as soon as it is plugged in (checked every 5 seconds). No button needed:
  // the only ones left alone are devices the owner disconnected on purpose, and ones still waiting on "Allow".
  let checking = false;
  const autoConnect = () => {
    if (checking) return;
    checking = true;
    try {
      const r = adb(['devices'], 8000);
      if (!r.ok) return;
      const serials = r.out
        .split('\n')
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p[0] && p[1] === 'device')
        .map((p) => p[0]);
      for (const serial of serials) {
        if (declined.includes(serial) || routed(serial)) continue;
        if (connect(serial)) {
          if (!remembered.includes(serial)) {
            remembered.push(serial);
            save();
          }
          const info = details(serial);
          const wifi = !wifiReady.includes(serial) && setupWifi(serial);
          logActivity('done', `${info.name || info.model || 'Device'} plugged in and connected over USB.${wifi ? ' It was also paired for Wi-Fi, so it keeps working unplugged.' : ''}`);
        }
      }
    } catch {
    } finally {
      checking = false;
    }
  };
  setTimeout(autoConnect, 2000).unref?.(); // a phone that was already plugged in when the hub started
  setInterval(autoConnect, 10000).unref?.();

  app.get('/api/this-pc', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    res.json(thisPc());
  });

  app.get('/api/devices', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const found = adb(['version']).ok;
    res.json({ adb: found, devices: found ? listDevices() : [] });
  });

  app.post('/api/devices/:serial/:action', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const { serial, action } = req.params;
    const device = listDevices().find((d) => d.serial === serial);
    if (!device) return res.status(404).json({ error: "That device isn't plugged in." });
    if (device.state !== 'device') return res.status(400).json({ error: 'Unlock the device and tap "Allow" on the USB debugging message first.' });
    if (action === 'connect') {
      if (!connect(serial)) return res.status(500).json({ error: 'Could not route the hub through the cable.' });
      if (!remembered.includes(serial)) remembered.push(serial);
      declined = declined.filter((s) => s !== serial);
      save();
      const wifi = !wifiReady.includes(serial) && setupWifi(serial);
      logActivity('done', `${device.name || device.model} connected over USB.${wifi ? ' Also paired for Wi-Fi.' : ''}`);
      return res.json({ ok: true });
    }
    if (action === 'disconnect') {
      for (const p of PORTS) adb(['-s', serial, 'reverse', '--remove', `tcp:${p}`]);
      remembered = remembered.filter((s) => s !== serial);
      if (!declined.includes(serial)) declined.push(serial);
      save();
      return res.json({ ok: true });
    }
    if (action === 'setup-wifi') {
      return setupWifi(serial) ? res.json({ ok: true }) : res.status(400).json({ error: "This computer isn't on Wi-Fi right now, or the device couldn't open the link." });
    }
    if (action === 'open' || action === 'open-lyra') {
      const url = action === 'open' ? 'http://localhost:3000/' : 'http://localhost:4777/';
      const r = adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
      return r.ok ? res.json({ ok: true }) : res.status(500).json({ error: r.err || 'Could not open it on the device.' });
    }
    res.status(400).json({ error: 'Unknown action.' });
  });
}
