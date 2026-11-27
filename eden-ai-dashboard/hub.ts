// "All projects": one page for every project in C:\AZI. Each project keeps its own folder and git repo; the hub only
// reads them, starts their launchers hidden (with a log), and for Reel runs director steps and plays finished videos.
// Nothing here commits, pushes or syncs. Launchers and Reel steps are only available from the hub on this computer.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { Express } from 'express';
import { fromOwnPage, isLocal } from './server/localRequest';
import { readProgress } from './runners';

export interface Launcher {
  id: string;
  label: string;
  command: string; // program to run (no shell)
  args: string[];
  port?: number; // a server launcher: the hub checks the port first and opens this address
  url?: string;
}

export interface HubProject {
  id: string;
  name: string;
  folder: string; // relative to the hub root (C:\AZI)
  about: string;
  startHere: string;
  localOnly?: boolean; // AGENTS.md says it never goes to GitHub
  runner?: string; // id in .eden-runners.json
  launchers?: Launcher[];
  reel?: boolean;
}

// The projects table from C:\AZI\AGENTS.md.
export const HUB_PROJECTS: HubProject[] = [
  { id: 'eden', name: 'Eden AI hub', folder: 'ProjectEden\\eden-ai-dashboard', about: 'This hub (React + Express).', startHere: 'README.md' },
  { id: 'nova', name: 'Project Nova', folder: 'NOVA', about: 'WebXR space-flight game.', startHere: 'STATUS.md' },
  { id: 'lyra', name: 'LYRA (Forge)', folder: 'Forge', about: 'LYRA AI app (Node). Branch Forge-app, never main.', startHere: 'ROADMAP.md' },
  { id: 'levelgen', name: 'LevelGen', folder: 'LevelGen', about: 'Procedural level generator plugin for UE 5.8 (Fab).', startHere: 'autopilot\\TASKS.md', localOnly: true, runner: 'levelgen' },
  { id: 'levelgen-docs', name: 'LevelGen docs', folder: 'LevelGen-docs', about: 'Public guide, support page and demo. No plugin source.', startHere: 'README.md' },
  {
    id: 'reel', name: 'Reel', folder: 'Reel', about: 'Local AI video and music maker with Reel Studio.', startHere: 'autopilot\\TASKS.md', localOnly: true, runner: 'reel', reel: true,
    launchers: [
      { id: 'studio', label: 'Open Reel Studio', command: 'python', args: ['ui\\server.py'], port: 7870, url: 'http://127.0.0.1:7870/' },
      { id: 'music', label: 'Music Maker', command: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', 'tools\\music-maker.ps1'] },
    ],
  },
  { id: 'deadz', name: 'Dead-Z Outbreak', folder: 'Dead-Z-Outbreak', about: 'Mobile zombie game (Capacitor).', startHere: 'README.md' },
  {
    id: 'passguard', name: 'PassGuard', folder: 'PassGuard', about: 'Local leaked-password checker.', startHere: 'README.md', localOnly: true,
    launchers: [{ id: 'start', label: 'Open PassGuard', command: 'node', args: ['server.mjs'], port: 4790, url: 'http://127.0.0.1:4790/' }],
  },
  {
    id: 'syspulse', name: 'SysPulse', folder: 'SysPulse', about: 'Local system health and cleanup GUI.', startHere: 'README.md', localOnly: true,
    launchers: [{ id: 'start', label: 'Open SysPulse', command: 'node', args: ['server.mjs'], port: 4791, url: 'http://127.0.0.1:4791/' }],
  },
  { id: 'notes', name: 'Notes 2026', folder: 'NOTES_26', about: 'Notes, plans and writing.', startHere: 'Master_DOC_Notebooks_2026.md' },
  { id: 'devlog', name: 'Devlog', folder: 'devlog', about: 'Automatic nightly dev diary.', startHere: 'README.md', localOnly: true, runner: 'devlog' },
];

export const REEL_STEPS = ['status', 'plan', 'keyframes', 'animate', 'music', 'voice', 'cut', 'finish', 'all'] as const;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const VIDEO = /\.(mp4|webm|mov)$/i;

export const hubRoot = () => process.env.EDEN_HUB_ROOT || process.env.AZI_ROOT || 'C:\\AZI';

export function portOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function git(dir: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : String(out)));
  });
}

// The finished videos of every Reel project: projects\<name>\out\*.mp4, newest first.
export function reelVideos(reelDir: string) {
  const rows: { project: string; file: string; size: number; modified: string }[] = [];
  const projects = path.join(reelDir, 'projects');
  let names: string[] = [];
  try { names = fs.readdirSync(projects).filter((n) => NAME.test(n)); } catch { return rows; }
  for (const project of names) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(projects, project, 'out')); } catch { continue; }
    for (const file of files.filter((f) => VIDEO.test(f) && NAME.test(f))) {
      try {
        const st = fs.statSync(path.join(projects, project, 'out', file));
        if (st.isFile()) rows.push({ project, file, size: st.size, modified: st.mtime.toISOString() });
      } catch {}
    }
  }
  return rows.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function reelProjects(reelDir: string) {
  try {
    return fs.readdirSync(path.join(reelDir, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory() && NAME.test(d.name)).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

// Resolves a video only inside projects\<name>\out\ (no ../, no other folders).
export function reelVideoPath(reelDir: string, project: unknown, file: unknown) {
  if (typeof project !== 'string' || typeof file !== 'string' || !NAME.test(project) || !NAME.test(file) || !VIDEO.test(file)) return null;
  const out = path.resolve(reelDir, 'projects', project, 'out');
  const full = path.resolve(out, file);
  return path.dirname(full) === out ? full : null;
}

interface StepState { project: string; step: string; state: 'Running' | 'Done' | 'Failed'; startedAt: string; exitCode?: number | null; error?: string }

export function createHub(appDir: string, deps: {
  runnerStatus?: () => { runners: { id: string; state: string; progress?: ReturnType<typeof readProgress> }[] };
  workingIn?: (dir: string) => string[];
  spawn?: typeof spawn;
  root?: () => string;
} = {}) {
  const run = deps.spawn ?? spawn;
  const root = deps.root ?? hubRoot;
  const logDir = path.join(appDir, '.eden-logs', 'hub');
  let step: StepState | undefined;
  let stepChild: ChildProcess | undefined;
  const dirOf = (p: HubProject) => path.join(root(), p.folder);
  const find = (id: unknown) => HUB_PROJECTS.find((p) => p.id === id);

  function startHidden(id: string, cwd: string, command: string, args: string[], keep: boolean) {
    fs.mkdirSync(logDir, { recursive: true });
    const log = path.join(logDir, id + '.log');
    const fd = fs.openSync(log, 'a');
    try {
      fs.writeSync(fd, `\n--- ${new Date().toISOString()} ${command} ${args.join(' ')} ---\n`);
      const child = run(command, args, { cwd, windowsHide: true, detached: keep, stdio: ['ignore', fd, fd] });
      if (keep) child.unref(); // a launched app keeps running when the hub restarts
      return { child, log };
    } finally {
      fs.closeSync(fd);
    }
  }

  async function status() {
    let runners: { id: string; state: string; progress?: ReturnType<typeof readProgress> }[] = [];
    try { runners = deps.runnerStatus?.().runners ?? []; } catch {}
    const projects = await Promise.all(HUB_PROJECTS.map(async (p) => {
      const dir = dirOf(p);
      const exists = fs.existsSync(dir);
      let progress: ReturnType<typeof readProgress> | undefined;
      try { progress = readProgress(fs.readFileSync(path.join(dir, 'autopilot', 'TASKS.md'), 'utf8')); } catch {}
      const isRepo = exists && fs.existsSync(path.join(dir, '.git'));
      const [remote, porcelain, branch] = isRepo
        ? await Promise.all([git(dir, ['remote', 'get-url', 'origin']), git(dir, ['status', '--porcelain']), git(dir, ['branch', '--show-current'])])
        : [null, null, null];
      const runner = p.runner ? runners.find((r) => r.id === p.runner) : undefined;
      const launchers = await Promise.all((p.launchers ?? []).map(async (l) => ({
        id: l.id, label: l.label, url: l.url, port: l.port, running: l.port ? await portOpen(l.port) : undefined,
      })));
      return {
        id: p.id, name: p.name, about: p.about, folder: dir, exists, startHere: p.startHere, localOnly: !!p.localOnly,
        git: isRepo ? { github: !!remote?.trim() && /github\.com/i.test(remote), branch: branch?.trim() || undefined, changed: porcelain === null ? undefined : porcelain.split('\n').filter(Boolean).length } : undefined,
        progress: progress ?? runner?.progress,
        runner: runner ? { id: runner.id, state: runner.state } : undefined,
        launchers, reel: !!p.reel,
      };
    }));
    return { root: root(), projects };
  }

  async function launch(id: unknown, launcherId: unknown) {
    const p = find(id);
    const l = p?.launchers?.find((x) => x.id === launcherId);
    if (!p || !l) throw new Error('Unknown project or launcher.');
    const dir = dirOf(p);
    if (!fs.existsSync(dir)) throw new Error(`${p.name} is not in ${dir}.`);
    if (l.port && await portOpen(l.port)) return { already: true, url: l.url };
    const { log } = startHidden(`${p.id}-${l.id}`, dir, l.command === 'node' ? process.execPath : l.command, l.args, true);
    if (l.port) {
      for (let i = 0; i < 20; i++) { // wait up to 10 s for the server to answer
        await new Promise((r) => setTimeout(r, 500));
        if (await portOpen(l.port)) return { started: true, url: l.url, log };
      }
      return { started: true, waiting: true, url: l.url, log };
    }
    return { started: true, log };
  }

  function openFolder(id: unknown) {
    const p = find(id);
    if (!p) throw new Error('Unknown project.');
    const dir = dirOf(p);
    if (!fs.existsSync(dir)) throw new Error(`${p.name} is not in ${dir}.`);
    run('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  }

  const reelDir = () => dirOf(find('reel')!);

  function reelStep(project: unknown, stepName: unknown) {
    if (typeof stepName !== 'string' || !(REEL_STEPS as readonly string[]).includes(stepName)) throw new Error('Choose a Reel step.');
    if (typeof project !== 'string' || !reelProjects(reelDir()).includes(project)) throw new Error('Choose a Reel project.');
    if (step?.state === 'Running') throw new Error(`Reel is already running "${step.step}" on ${step.project}. Wait for it to finish.`);
    const working = stepName === 'status' ? [] : deps.workingIn?.(reelDir()) ?? [];
    if (working.length) throw new Error(`Wait for ${working.join(', ')} to finish working in Reel.`);
    const startedAt = new Date().toISOString();
    const { child } = startHidden('reel-step', reelDir(), 'python', ['-m', 'director', stepName, `projects\\${project}`], false);
    step = { project, step: stepName, state: 'Running', startedAt };
    stepChild = child;
    child.once('error', (err) => { if (stepChild === child) step = { ...step!, state: 'Failed', error: err.message }; });
    child.once('exit', (code) => { if (stepChild === child && step?.state === 'Running') step = { ...step, state: code === 0 ? 'Done' : 'Failed', exitCode: code }; });
  }

  function logTail(file: string, lines = 30) {
    try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n'); } catch { return ''; }
  }

  function reelStatus() {
    return { projects: reelProjects(reelDir()), steps: REEL_STEPS, videos: reelVideos(reelDir()), step, log: step ? logTail(path.join(logDir, 'reel-step.log')) : '' };
  }

  return { status, launch, openFolder, reelStep, reelStatus, reelDir };
}

export function registerHubRoutes(app: Express, hub: ReturnType<typeof createHub>) {
  app.post('/api/hub/:action', async (req, res) => {
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'All projects is only available from the hub on this computer.' });
    try {
      const { action } = req.params;
      const b = req.body || {};
      if (action === 'status') return res.json(await hub.status());
      if (action === 'launch') return res.json(await hub.launch(b.id, b.launcher));
      if (action === 'open-folder') { hub.openFolder(b.id); return res.json({ ok: true }); }
      if (action === 'reel') return res.json(hub.reelStatus());
      if (action === 'reel-step') { hub.reelStep(b.project, b.step); return res.json({ ok: true }); }
      res.status(404).json({ error: 'Unknown action.' });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  // A <video> tag sends no Origin header, so this read-only route only checks that the request comes from this PC.
  app.get('/api/hub/reel/video/:project/:file', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Videos only play on this computer.' });
    const file = reelVideoPath(hub.reelDir(), req.params.project, req.params.file);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Video not found.' });
    res.sendFile(file);
  });
}
