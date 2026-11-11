// "PC busy" mode: when this computer is short on memory or its CPU is maxed out (for example while LYRA
// makes a video or Unreal is open), heavy jobs wait so the PC stays usable:
//   - code updates in the queue don't start (they run Claude Code plus a full type check)
//   - LYRA and AI models that run on this PC (Ollama, LM Studio) aren't used; cloud AIs answer instead
// Everything carries on by itself once the PC has room again. Can be switched off.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-busy.json');
const GB = 1024 ** 3;
const BUSY_FREE_GB = 2.5; // busy below this much free memory…
const CLEAR_FREE_GB = 3.5; // …and not busy again until there is this much
const BUSY_CPU = 85;
const CLEAR_CPU = 70;

let enabled = true;
try {
  enabled = JSON.parse(fs.readFileSync(FILE, 'utf-8')).enabled !== false;
} catch {}

let busy = false;
let reason = '';
let since = 0;
let lastCpu = os.cpus().map((c) => c.times);
let cpuPercent = 0;
let streak = 0; // samples in a row pointing the other way (so a short spike doesn't flip it)
const listeners: Array<(busy: boolean) => void> = [];

function sampleCpu() {
  const now = os.cpus();
  let used = 0;
  let total = 0;
  now.forEach((c, i) => {
    const a = lastCpu[i] || c.times;
    const idle = c.times.idle - a.idle;
    const all = c.times.user - a.user + (c.times.nice - a.nice) + (c.times.sys - a.sys) + idle + (c.times.irq - a.irq);
    used += all - idle;
    total += all;
  });
  lastCpu = now.map((c) => c.times);
  return total ? Math.round((used / total) * 100) : 0;
}

function check() {
  cpuPercent = sampleCpu();
  const freeGb = os.freemem() / GB;
  const wantBusy = busy ? !(freeGb > CLEAR_FREE_GB && cpuPercent < CLEAR_CPU) : freeGb < BUSY_FREE_GB || cpuPercent >= BUSY_CPU;
  if (wantBusy === busy) {
    streak = 0;
    if (busy) reason = describe(freeGb);
    return;
  }
  if (++streak < 3) return; // about 30 seconds
  streak = 0;
  busy = wantBusy;
  since = Date.now();
  reason = busy ? describe(freeGb) : '';
  if (enabled) {
    logActivity(busy ? 'error' : 'done', busy ? `PC busy (${reason}): heavy jobs wait until it has room again.` : 'PC has room again: heavy jobs carry on.');
    for (const fn of listeners) fn(busy);
  }
}
const describe = (freeGb: number) =>
  freeGb < BUSY_FREE_GB || freeGb < CLEAR_FREE_GB ? `only ${freeGb.toFixed(1)} GB memory free` : `CPU ${cpuPercent}% busy`;

setInterval(check, 10000).unref?.();

export const pcBusy = () => enabled && busy;
export const onBusyChange = (fn: (busy: boolean) => void) => listeners.push(fn);
export const busyStatus = () => ({ enabled, busy, active: enabled && busy, reason, since: since ? new Date(since).toISOString() : undefined, freeGb: Math.round((os.freemem() / GB) * 10) / 10, cpuPercent });

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerBusyRoutes(app: Express) {
  app.get('/api/pc-busy', (_req, res) => res.json(busyStatus()));
  app.post('/api/pc-busy', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const next = req.body?.enabled !== false;
    if (next !== enabled) {
      const wasActive = pcBusy();
      enabled = next;
      try {
        fs.writeFileSync(FILE, JSON.stringify({ enabled }), 'utf-8');
      } catch {}
      logActivity('info', `PC busy mode turned ${enabled ? 'on' : 'off'}.`);
      if (wasActive !== pcBusy()) for (const fn of listeners) fn(pcBusy());
    }
    res.json(busyStatus());
  });
}
