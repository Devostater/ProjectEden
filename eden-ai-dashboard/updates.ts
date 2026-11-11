// App updates: the AI changes the hub's own code, safely.
//
//   1. You describe the change. The hub makes a separate copy of its code (a git worktree outside this
//      folder, including your uncommitted work), so the running app is never touched while the AI works.
//   2. Claude Code edits that copy. It may only read and edit files: no commands, no internet.
//   3. The hub runs the type check on the copy and shows you every changed line.
//   4. Only when you press Apply is the change copied into the real app. Undo reverses it.
// Changes to the page appear straight away; changes to the server need the hub restarted.
// Every request here must come from this computer and from the hub's own page.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { cliSignedIn } from './providers';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(APP_DIR, '.eden-updates.json');
const WORK_ROOT = path.join(os.homedir(), '.eden-hub', 'updates');
const TIMEOUT_MS = 20 * 60 * 1000;

type Status = 'working' | 'checking' | 'ready' | 'applied' | 'undone' | 'discarded' | 'failed';

interface UpdateJob {
  id: string;
  request: string;
  status: Status;
  createdAt: string;
  finishedAt?: string;
  log: string[]; // what the AI is doing, one line per step
  summary?: string; // the AI's own account of what it changed
  diff?: string; // the change, as a patch against the app folder's parent repository
  files?: { path: string; added: number; removed: number }[];
  check?: { ok: boolean; output: string };
  needsRestart?: boolean;
  error?: string;
}

let jobs: UpdateJob[] = [];
try {
  jobs = JSON.parse(fs.readFileSync(STORE, 'utf-8'));
} catch {}
// Anything that was mid-way when the hub stopped can't continue.
for (const j of jobs) if (j.status === 'working' || j.status === 'checking') Object.assign(j, { status: 'failed', error: 'The hub restarted while this was running.' });

const save = () => {
  try {
    fs.writeFileSync(STORE, JSON.stringify(jobs.slice(-50), null, 2), 'utf-8');
  } catch {}
};
const now = () => new Date().toISOString();

const git = (args: string[], cwd: string, input?: string) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-3).join(' '));
  return r.stdout;
};

const repoRoot = () => git(['rev-parse', '--show-toplevel'], APP_DIR).trim();
const appRel = () => path.relative(repoRoot(), APP_DIR).split(path.sep).join('/'); // e.g. "eden-ai-dashboard"

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function fromOwnPage(req: Request) {
  try {
    return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---- The copy of the code -----------------------------------------------------------------------

function makeCopy(id: string): { dir: string; appDir: string } {
  const root = repoRoot();
  const rel = appRel();
  const dir = path.join(WORK_ROOT, id);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  git(['worktree', 'add', '--detach', dir, 'HEAD'], root);
  // Bring over uncommitted work in the app folder, so the AI starts from what you actually have.
  const pending = git(['diff', 'HEAD', '--binary', '--', rel], root);
  if (pending.trim()) git(['apply', '--whitespace=nowarn', '-'], dir, pending);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', rel], root).split('\n').filter(Boolean);
  for (const file of untracked) {
    const from = path.join(root, file);
    const to = path.join(dir, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // Mark this as the starting point, so the AI's change can be read off exactly afterwards.
  git(['add', '-A', '--', rel], dir);
  git(['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost', 'commit', '--no-verify', '-q', '--allow-empty', '-m', 'Starting point'], dir);
  // Share the installed packages so the type check can run in the copy.
  const appDir = path.join(dir, rel);
  fs.symlinkSync(path.join(APP_DIR, 'node_modules'), path.join(appDir, 'node_modules'), 'junction');
  return { dir, appDir };
}

function removeCopy(id: string) {
  const dir = path.join(WORK_ROOT, id);
  if (!fs.existsSync(dir)) return;
  try {
    // Remove the shared-packages link first, so nothing can follow it into the real app.
    const link = path.join(dir, appRel(), 'node_modules');
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link);
  } catch {}
  try {
    git(['worktree', 'remove', '--force', dir], repoRoot());
  } catch {
    try {
      git(['worktree', 'prune'], repoRoot());
    } catch {}
  }
}

// ---- Running the AI -----------------------------------------------------------------------------

const RULES = (rel: string) => `You are improving "Eden AI Hub", a local web app (React + Vite front end in src/, Express server in the *.ts files at the top of this folder) that a small game studio uses to run its AI team.
Make the change the owner asks for below, carefully and completely.
Rules:
- Only edit files inside this folder (${rel}). Never touch .env files, .eden-* files, .nexusflow-store.json, node_modules, or the mobile/android build.
- Follow the existing code style. Keep wording plain for a non-technical owner.
- Keep the app working: if you change a shared type, update every place that uses it.
- You cannot run commands; the hub runs the type check after you finish.
- Finish with a short summary in plain language: what you changed, which files, and anything the owner should check.`;

function describeTool(name: string, input: any): string {
  const file = input?.file_path || input?.path || input?.pattern || '';
  const short = String(file).replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (name === 'Read') return `Reading ${short}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${short}`;
  if (name === 'Write') return `Writing ${short}`;
  if (name === 'Glob' || name === 'Grep') return `Searching for ${String(file).slice(0, 60)}`;
  return name;
}

async function runAI(job: UpdateJob, appDir: string) {
  const rel = appRel();
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep', '--model', 'claude-sonnet-5-5'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('claude', args, { cwd: appDir, shell: true, windowsHide: true });
    let buffer = '';
    let errText = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The AI took longer than 20 minutes and was stopped.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      buffer += d.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'assistant') {
            for (const part of ev.message?.content || []) {
              if (part.type === 'tool_use') job.log.push(describeTool(part.name, part.input));
            }
            if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
            save();
          } else if (ev.type === 'result') {
            if (ev.is_error) errText = ev.result || 'The AI stopped with an error.';
            else job.summary = String(ev.result || '').trim();
          }
        } catch {}
      }
    });
    child.stderr.on('data', (d) => (errText += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !errText) resolve();
      else reject(new Error(errText.trim().split('\n').slice(-2).join(' ') || `Claude Code exited with ${code}`));
    });
    child.stdin.end(`${RULES(rel)}\n\nThe owner's request:\n${job.request}`);
  });
}

function readChange(job: UpdateJob, dir: string) {
  const rel = appRel();
  git(['add', '-A', '--', rel], dir);
  const diff = git(['diff', '--cached', '--binary', 'HEAD', '--', rel], dir);
  const stat = git(['diff', '--cached', '--numstat', 'HEAD', '--', rel], dir);
  job.diff = diff;
  job.files = stat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, r, p] = l.split('\t');
      return { path: p.startsWith(`${rel}/`) ? p.slice(rel.length + 1) : p, added: Number(a) || 0, removed: Number(r) || 0 };
    });
  // Front-end changes show at once; anything else runs in the server and needs a restart.
  job.needsRestart = job.files.some((f) => !f.path.startsWith('src/') && !f.path.startsWith('public/') && f.path !== 'index.html');
}

function typeCheck(appDir: string): { ok: boolean; output: string } {
  const r = spawnSync('npx', ['tsc', '--noEmit'], { cwd: appDir, shell: true, encoding: 'utf-8', windowsHide: true, timeout: 5 * 60 * 1000 });
  const output = `${r.stdout || ''}${r.stderr || ''}`.replace(new RegExp(appDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'g'), '').trim();
  return { ok: r.status === 0, output: output.slice(0, 6000) };
}

let busy = false;

async function process_(job: UpdateJob) {
  busy = true;
  logActivity('work', `App update started: ${job.request.slice(0, 100)}`);
  let copy: { dir: string; appDir: string } | null = null;
  try {
    job.log.push('Making a separate copy of the app to work on');
    save();
    copy = makeCopy(job.id);
    job.log.push('Claude is working on the copy');
    save();
    await runAI(job, copy.appDir);
    readChange(job, copy.dir);
    if (!job.files?.length) throw new Error('The AI finished without changing anything.');
    job.status = 'checking';
    job.log.push('Running the type check');
    save();
    job.check = typeCheck(copy.appDir);
    job.status = 'ready';
    logActivity(job.check.ok ? 'done' : 'error', `App update ready for review (${job.files.length} file${job.files.length === 1 ? '' : 's'}${job.check.ok ? '' : ', type check failed'}).`);
  } catch (err: any) {
    job.status = 'failed';
    job.error = err?.message || 'Something went wrong.';
    logActivity('error', `App update failed: ${job.error}`);
  } finally {
    job.finishedAt = now();
    save();
    removeCopy(job.id);
    busy = false;
  }
}

// ---- Applying ------------------------------------------------------------------------------------

function applyPatch(diff: string, reverse = false) {
  const root = repoRoot();
  const args = ['apply', '--whitespace=nowarn', ...(reverse ? ['-R'] : [])];
  // Check first, so a patch that no longer fits changes nothing at all.
  git([...args, '--check', '-'], root, diff);
  git([...args, '-'], root, diff);
}

export function registerUpdateRoutes(app: Express) {
  const guard = (req: Request) => (isLocal(req) && fromOwnPage(req) ? '' : 'App updates can only be managed from the hub on this computer.');

  app.get('/api/updates', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    res.json({ jobs: [...jobs].reverse().map(({ diff, ...rest }) => ({ ...rest, hasDiff: !!diff })), busy, claudeReady: cliSignedIn('anthropic') });
  });

  app.get('/api/updates/:id/diff', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    res.json({ diff: job.diff || '' });
  });

  app.post('/api/updates', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const request = typeof req.body?.request === 'string' ? req.body.request.trim().slice(0, 4000) : '';
    if (!request) return res.status(400).json({ error: 'Describe what you want changed.' });
    if (busy) return res.status(409).json({ error: 'An update is already being made. Wait for it to finish.' });
    if (!cliSignedIn('anthropic', true)) return res.status(400).json({ error: 'App updates use Claude Code. Sign in to Claude in Account → Connections first.' });
    const job: UpdateJob = { id: `upd-${Date.now().toString(36)}`, request, status: 'working', createdAt: now(), log: [] };
    jobs.push(job);
    save();
    process_(job);
    res.json({ job: { ...job, diff: undefined } });
  });

  app.post('/api/updates/:id/apply', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job || !job.diff) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'ready' && job.status !== 'undone') return res.status(400).json({ error: 'This update has already been dealt with.' });
    try {
      applyPatch(job.diff);
    } catch (err: any) {
      return res.status(409).json({ error: `The app has changed since this update was made, so it no longer fits. Discard it and ask again. (${err.message})` });
    }
    job.status = 'applied';
    save();
    logActivity('done', `App update applied: ${job.request.slice(0, 80)}${job.needsRestart ? ' (restart the hub to finish)' : ''}`);
    res.json({ ok: true, needsRestart: !!job.needsRestart });
  });

  app.post('/api/updates/:id/undo', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job || !job.diff || job.status !== 'applied') return res.status(400).json({ error: 'Only an applied update can be undone.' });
    try {
      applyPatch(job.diff, true);
    } catch (err: any) {
      return res.status(409).json({ error: `Other changes have been made on top of this one, so it can't be undone automatically. (${err.message})` });
    }
    job.status = 'undone';
    save();
    logActivity('done', `App update undone: ${job.request.slice(0, 80)}`);
    res.json({ ok: true, needsRestart: !!job.needsRestart });
  });

  app.post('/api/updates/:id/discard', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    if (job.status === 'applied') return res.status(400).json({ error: 'Undo it first.' });
    if (job.status === 'working' || job.status === 'checking') return res.status(409).json({ error: 'Wait for it to finish first.' });
    job.status = 'discarded';
    save();
    res.json({ ok: true });
  });
}
