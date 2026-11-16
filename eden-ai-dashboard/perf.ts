// Performance, like Task Manager: live CPU, memory, GPU and disks for this PC, the busiest programs,
// and how much of it Eden and the AI it runs (LYRA, Claude runs, Ollama) are using.
// Only answers on this computer. Nothing is sampled until the Devices page asks, and sampling stops
// a couple of minutes after the page is closed, so it costs nothing while you're not looking.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import type { Express, Request } from 'express';

const GB = 1024 ** 3;
const SAMPLE_MS = 2000;
const HISTORY = 90; // 3 minutes of points
const IDLE_STOP_MS = 2 * 60 * 1000;

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ---- CPU and memory history -------------------------------------------------------------
interface Point { at: number; cpu: number; memGb: number; gpu?: number }
const history: Point[] = [];
let cores: number[] = [];
let lastCpu = os.cpus().map((c) => c.times);
let timer: NodeJS.Timeout | null = null;
let lastAsked = 0;

function sample() {
  const now = os.cpus();
  let used = 0;
  let total = 0;
  cores = now.map((c, i) => {
    const a = lastCpu[i] || c.times;
    const idle = c.times.idle - a.idle;
    const all = c.times.user - a.user + (c.times.nice - a.nice) + (c.times.sys - a.sys) + idle + (c.times.irq - a.irq);
    used += all - idle;
    total += all;
    return all ? Math.round(((all - idle) / all) * 100) : 0;
  });
  lastCpu = now.map((c) => c.times);
  history.push({ at: Date.now(), cpu: total ? Math.round((used / total) * 100) : 0, memGb: round1((os.totalmem() - os.freemem()) / GB), gpu: gpu?.percent });
  if (history.length > HISTORY) history.shift();
  if (Date.now() - lastAsked > IDLE_STOP_MS && timer) {
    clearInterval(timer);
    timer = null;
  }
  readGpu();
}

function wake() {
  lastAsked = Date.now();
  if (timer) return;
  lastCpu = os.cpus().map((c) => c.times);
  timer = setInterval(sample, SAMPLE_MS);
  setTimeout(sample, 500); // a first point quickly
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- GPU (NVIDIA only, through nvidia-smi; other cards just don't show a GPU line) --------
let gpu: { name: string; percent: number; memUsedGb: number; memTotalGb: number; tempC?: number } | null = null;
let gpuMissingUntil = 0;
let gpuReading = false;
function readGpu() {
  if (gpuReading || Date.now() < gpuMissingUntil) return;
  gpuReading = true;
  execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, out) => {
    gpuReading = false;
    const f = String(out || '').split('\n')[0]?.split(',').map((s) => s.trim());
    if (err || !f || f.length < 4) {
      gpu = null;
      gpuMissingUntil = Date.now() + 5 * 60 * 1000;
      return;
    }
    gpu = { name: f[0], percent: Number(f[1]) || 0, memUsedGb: round1(Number(f[2]) / 1024), memTotalGb: round1(Number(f[3]) / 1024), tempC: Number(f[4]) || undefined };
  });
}

// ---- Disks ----------------------------------------------------------------------------
let disks: { name: string; usedGb: number; totalGb: number }[] = [];
let disksAt = 0;
function readDisks() {
  if (Date.now() - disksAt < 30000) return disks;
  disksAt = Date.now();
  const roots = process.platform === 'win32' ? 'CDEFGHIJ'.split('').map((l) => `${l}:\\`) : ['/'];
  disks = [];
  for (const r of roots) {
    try {
      if (!fs.existsSync(r)) continue;
      const s = fs.statfsSync(r);
      const total = s.blocks * s.bsize;
      if (!total) continue;
      disks.push({ name: r.replace(/\\$/, ''), usedGb: Math.round((total - s.bavail * s.bsize) / GB), totalGb: Math.round(total / GB) });
    } catch {}
  }
  return disks;
}

// ---- Programs (Windows) ----------------------------------------------------------------
// One PowerShell query lists every process with its parent, memory and CPU time. CPU % is the
// change in CPU time since the last look. Command lines are only used here to recognise LYRA and
// Claude; they never leave this file (they can hold paths or keys).
interface Proc { pid: number; ppid: number; name: string; memMb: number; cpu: number; cmd: string }
interface RawProc { ProcessId: number; ParentProcessId: number; Name: string; WorkingSetSize: number; KernelModeTime: number; UserModeTime: number; CommandLine?: string | null }
let procs: Proc[] = [];
let procsAt = 0;
let procsReading: Promise<void> | null = null;
let lastTimes = new Map<number, { t: number; at: number }>();

function readProcs(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  if (procsReading) return procsReading;
  if (Date.now() - procsAt < 4000) return Promise.resolve();
  const cmd = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress';
  procsReading = new Promise<void>((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 15000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, out) => {
      procsReading = null;
      if (!err) {
        try {
          const raw: RawProc[] = JSON.parse(String(out));
          const now = Date.now();
          const n = os.cpus().length || 1;
          const next = new Map<number, { t: number; at: number }>();
          procs = raw
            .filter((p) => p.ProcessId > 4) // skip Idle and System
            .map((p) => {
              const t = (Number(p.KernelModeTime) || 0) + (Number(p.UserModeTime) || 0); // 100 ns units
              const prev = lastTimes.get(p.ProcessId);
              next.set(p.ProcessId, { t, at: now });
              const cpu = prev && now > prev.at ? Math.max(0, Math.min(100, ((t - prev.t) / 1e4 / (now - prev.at) / n) * 100)) : 0;
              return { pid: p.ProcessId, ppid: p.ParentProcessId, name: String(p.Name || '').replace(/\.exe$/i, ''), memMb: Math.round((Number(p.WorkingSetSize) || 0) / 1024 / 1024), cpu: round1(cpu), cmd: String(p.CommandLine || '') };
            });
          lastTimes = next;
          procsAt = now;
        } catch {}
      }
      resolve();
    });
  });
  return procsReading;
}

type Group = 'eden' | 'lyra' | 'claude' | 'ollama';
const GROUP_NAMES: Record<Group, string> = { eden: 'Eden hub', lyra: 'LYRA', claude: 'Claude runs (Code updates, chats)', ollama: 'Ollama (local AI models)' };

function groupOf(p: Proc): Group | null {
  if (/^ollama/i.test(p.name)) return 'ollama';
  if (/^claude$/i.test(p.name) || /claude-code|@anthropic-ai[\\/]claude/i.test(p.cmd)) return 'claude';
  if (/[\\/]Forge[\\/]/i.test(p.cmd) && /node/i.test(p.name)) return 'lyra';
  return null;
}

// Each process takes the group of its own name, or else the group of the nearest parent that has one.
// Everything else started by this hub counts as Eden.
function grouped() {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const memo = new Map<number, Group | null>();
  const find = (p: Proc, depth = 0): Group | null => {
    if (memo.has(p.pid)) return memo.get(p.pid)!;
    let g = groupOf(p);
    if (!g && p.pid === process.pid) g = 'eden';
    if (!g && depth < 30) {
      const parent = byPid.get(p.ppid);
      if (parent && parent.pid !== p.pid) g = find(parent, depth + 1);
    }
    memo.set(p.pid, g);
    return g;
  };
  const totals: Record<Group, { cpu: number; memMb: number; count: number }> = { eden: { cpu: 0, memMb: 0, count: 0 }, lyra: { cpu: 0, memMb: 0, count: 0 }, claude: { cpu: 0, memMb: 0, count: 0 }, ollama: { cpu: 0, memMb: 0, count: 0 } };
  const tagged = procs.map((p) => {
    const g = find(p);
    if (g) {
      totals[g].cpu += p.cpu;
      totals[g].memMb += p.memMb;
      totals[g].count++;
    }
    return { ...p, group: g };
  });
  return { tagged, totals };
}

export function registerPerfRoutes(app: Express) {
  app.get('/api/perf', async (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    wake();
    if (req.query.programs === '1') await readProcs();
    const memTotalGb = round1(os.totalmem() / GB);
    const self = process.memoryUsage();
    const base = {
      cores: cores.length ? cores : os.cpus().map(() => 0),
      cpuName: os.cpus()[0]?.model.replace(/\s+/g, ' ').trim(),
      memTotalGb,
      memUsedGb: round1((os.totalmem() - os.freemem()) / GB),
      uptimeHours: Math.round(os.uptime() / 360) / 10,
      gpu,
      disks: readDisks(),
      history,
      hubMemMb: Math.round(self.rss / 1024 / 1024),
    };
    if (req.query.programs !== '1' || process.platform !== 'win32' || !procsAt) return res.json({ ...base, programs: null, eden: null });
    const { tagged, totals } = grouped();
    // Like Task Manager's Processes tab: one row per program name, busiest first.
    const byName = new Map<string, { name: string; cpu: number; memMb: number; count: number; group: Group | null }>();
    for (const p of tagged) {
      const key = p.group ? `${p.group}:${p.name}` : p.name.toLowerCase();
      const row = byName.get(key) || { name: p.name, cpu: 0, memMb: 0, count: 0, group: p.group };
      row.cpu += p.cpu;
      row.memMb += p.memMb;
      row.count++;
      byName.set(key, row);
    }
    const programs = [...byName.values()]
      .map((r) => ({ ...r, cpu: round1(r.cpu), group: r.group ? GROUP_NAMES[r.group] : null }))
      .sort((a, b) => b.cpu - a.cpu || b.memMb - a.memMb)
      .slice(0, 15);
    const eden = (Object.keys(totals) as Group[]).map((g) => ({ id: g, name: GROUP_NAMES[g], cpu: round1(totals[g].cpu), memMb: totals[g].memMb, count: totals[g].count }));
    res.json({ ...base, programs, eden });
  });
}
