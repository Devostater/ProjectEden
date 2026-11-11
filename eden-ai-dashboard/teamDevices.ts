// Connected phones and tablets as part of the AI team's toolkit.
//   Alerts  - "needs you" moments (work waiting in Review, code updates ready, failures) pop up as a
//             notification on the device, batched so a busy hour doesn't buzz it every minute.
//   Screen  - teammates can put something on the device's screen: a line "SHOW: <link>" in their finished
//             work opens that link there (a store page, a build, a doc), and you can send pages from the hub.
// Works over the USB cable, or over Wi-Fi debugging when the device is paired that way. Settings are kept
// per device in .eden-team-devices.json. Only the hub on this PC does this.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { adb, listDevices } from './devices';
import { onActivity } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-team-devices.json');

interface Roles {
  alerts: boolean;
  screen: boolean;
  name?: string;
}
let roles: Record<string, Roles> = {};
try {
  roles = JSON.parse(fs.readFileSync(FILE, 'utf-8')) || {};
} catch {}
const save = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(roles, null, 2), 'utf-8');
  } catch {}
};
// New devices get alerts on and screen off (the first one with a big screen gets the screen role).
const rolesFor = (serial: string, name?: string): Roles => {
  if (!roles[serial]) {
    const big = /tab|pad|tablet|^SM-[XTP]\d/i.test(name || ''); // Samsung tablets are SM-X/T/P…
    roles[serial] = { alerts: true, screen: big && !Object.values(roles).some((r) => r.screen), name };
    save();
  } else if (name && roles[serial].name !== name) {
    roles[serial].name = name;
    save();
  }
  return roles[serial];
};

// Plugged-in devices, cached briefly (each check is several adb calls).
let cache: { at: number; list: ReturnType<typeof listDevices> } = { at: 0, list: [] };
const ready = () => {
  if (process.env.EDEN_DEVICE_HUB === '1') return [];
  if (Date.now() - cache.at > 20000) {
    try {
      cache = { at: Date.now(), list: listDevices().filter((d) => d.state === 'device') };
    } catch {
      cache = { at: Date.now(), list: [] };
    }
  }
  return cache.list;
};
const label = (d: { name?: string; model?: string }) => d.name || d.model || 'Device';

// Android's shell joins arguments into one command line, so text is single-quoted for it.
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function notify(serial: string, title: string, text: string): boolean {
  const tag = `eden${Date.now().toString(36)}`;
  return adb(['-s', serial, 'shell', `cmd notification post -S bigtext -t ${q(title.slice(0, 80))} ${tag} ${q(text.slice(0, 600))}`]).ok;
}
function open(serial: string, url: string): boolean {
  return adb(['-s', serial, 'shell', `am start -a android.intent.action.VIEW -d ${q(url)}`]).ok;
}

export function alertDevices(title: string, text: string): string[] {
  const sent: string[] = [];
  for (const d of ready()) if (rolesFor(d.serial, label(d)).alerts && notify(d.serial, title, text)) sent.push(label(d));
  return sent;
}

const safeUrl = (u: string) => /^https?:\/\/[^\s'"<>]+$/i.test(u);
export function showOnDevices(url: string): string[] {
  if (!safeUrl(url)) return [];
  const shown: string[] = [];
  for (const d of ready()) if (rolesFor(d.serial, label(d)).screen && open(d.serial, url)) shown.push(label(d));
  return shown;
}

// "SHOW: <link>" lines in a teammate's finished work.
export function showFromResult(text: string): string[] {
  const links = [...text.matchAll(/^\s*SHOW:\s*(https?:\/\/\S+)\s*$/gim)].map((m) => m[1]).slice(0, 2);
  return links.flatMap((l) => showOnDevices(l));
}

// One line for teammates' briefs: which devices they can use right now.
export function devicesNote(): string {
  const screens = ready().filter((d) => roles[d.serial]?.screen);
  if (!screens.length) return '';
  return `\nThe owner has ${screens.map(label).join(' and ')} connected as a screen: if they should look at a web page or link (a store page, a build, a reference), add a line "SHOW: <link>" on its own and it opens there.`;
}

// ---- alerts from the activity log, batched ---------------------------------------------------------
// Errors always count; these "done" lines too.
const NEEDS_YOU = [/waiting in Review/i, /Code update ready for review/i, /update ideas ready/i, /discussion ended/i];
let pending: string[] = [];
let timer: NodeJS.Timeout | null = null;
let lastSent = 0;
const flush = () => {
  timer = null;
  if (!pending.length) return;
  const lines = pending.splice(0);
  lastSent = Date.now();
  const title = lines.length === 1 ? 'Eden: needs you' : `Eden: ${lines.length} things need you`;
  alertDevices(title, lines.slice(-6).join('\n') + (lines.length > 6 ? `\n…and ${lines.length - 6} more` : ''));
};

export function registerTeamDeviceRoutes(app: Express) {
  onActivity((kind, text) => {
    if (kind !== 'error' && !NEEDS_YOU.some((r) => r.test(text))) return;
    pending.push(text);
    // Gather for 20 seconds, and at most one alert every 2 minutes.
    if (!timer) timer = setTimeout(flush, Math.max(20000, 120000 - (Date.now() - lastSent))).unref?.() as any;
  });

  const isLocal = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');

  app.get('/api/team-devices', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    if (req.query.refresh) cache.at = 0;
    res.json({ devices: ready().map((d) => ({ serial: d.serial, name: label(d), ...rolesFor(d.serial, label(d)) })) });
  });
  app.post('/api/team-devices/show', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const url = String(req.body?.url || '');
    if (!safeUrl(url)) return res.status(400).json({ error: 'Give a web link (http or https).' });
    const shown = showOnDevices(url);
    res.status(shown.length ? 200 : 400).json(shown.length ? { shown } : { error: 'No device is set as a screen right now. Turn on "Screen" for a plugged-in device.' });
  });
  app.post('/api/team-devices/:serial', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const d = ready().find((x) => x.serial === req.params.serial);
    if (!d) return res.status(404).json({ error: "That device isn't plugged in." });
    const r = rolesFor(d.serial, label(d));
    if (req.body?.test) {
      return notify(d.serial, 'Eden: test alert', 'Alerts from your AI team will show up here.')
        ? res.json({ ok: true })
        : res.status(500).json({ error: "The device didn't accept the alert. Check that it's unlocked and USB debugging is allowed." });
    }
    if (typeof req.body?.alerts === 'boolean') r.alerts = req.body.alerts;
    if (typeof req.body?.screen === 'boolean') r.screen = req.body.screen;
    save();
    res.json({ ok: true, ...r });
  });
}
