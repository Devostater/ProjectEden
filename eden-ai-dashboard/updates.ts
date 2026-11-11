// Code updates: the AI changes code safely, in the hub itself or in another codebase (such as LYRA).
//
//   1. You describe the change. The hub makes a separate copy of that codebase (a git worktree outside
//      it, including your uncommitted work), so the running app is never touched while the AI works.
//   2. Claude Code edits that copy. It may only read and edit files: no commands, no internet.
//   3. The hub runs that codebase's checks on the copy and shows you every changed line.
//   4. Only when you press Apply is the change copied into the real folder. Undo reverses it.
//   One update runs at a time; any others asked for meanwhile wait in a queue and start by themselves.
// Every request here must come from this computer and from the hub's own page.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity, recentActivity } from './activity';
import { cliSignedIn } from './providers';
import { pcBusy, onBusyChange } from './busy';
import { isOffline, onOfflineChange } from './offline';
import { localAgentModel, localClaudeEnv } from './localClaude';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(APP_DIR, '.eden-updates.json');
const CODEBASES_FILE = path.join(APP_DIR, '.eden-codebases.json');
const WORK_ROOT = path.join(os.homedir(), '.eden-hub', 'updates');
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_COPY_BYTES = 5 * 1024 * 1024; // untracked files bigger than this aren't copied into the work copy

// ---- Codebases ----------------------------------------------------------------------------------

type CheckKind = 'tsc' | 'node'; // tsc: TypeScript check; node: syntax check of changed .js files + npm test

export interface Codebase {
  id: string;
  name: string;
  dir: string; // folder of the app inside its git repository
  check: CheckKind;
  liveDirs: string[]; // changes only here take effect without restarting the app
  restartHint: string;
  about: string; // what the AI is told about the codebase
  protect: string[]; // paths the AI must not touch
}

const HUB: Codebase = {
  id: 'hub',
  name: 'Eden AI Hub',
  dir: APP_DIR,
  check: 'tsc',
  liveDirs: ['src/', 'public/', 'index.html'],
  restartHint: 'close and reopen Start Eden',
  about: '"Eden AI Hub", a local web app (React + Vite front end in src/, Express server in the *.ts files at the top of this folder) that a small game studio uses to run its AI team.',
  protect: ['.env files', '.eden-* files', '.nexusflow-store.json', 'node_modules', 'the mobile/android build'],
};

// LYRA is added automatically when its folder is found; more codebases can be added from the page.
const LYRA_DIR = path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge');
const lyraPreset = (): Codebase => ({
  id: 'lyra',
  name: 'LYRA',
  dir: LYRA_DIR,
  check: 'node',
  liveDirs: ['public/'],
  restartHint: 'close the LYRA window and open Lyra again',
  about:
    '"LYRA", the owner\'s local AI co-pilot for their game studio: a Node.js (CommonJS) app. server.js is the main server with routes/ and lib/; the browser app is in public/; tests are in test/ (node --test).',
  protect: ['data/ (personal data and settings)', 'tools/', 'node_modules', 'tablet-pin.txt', 'tablet-session.txt', '*.nova-bak and *.forge-bak files'],
});

function loadCodebases(): Codebase[] {
  let extra: Codebase[] = [];
  try {
    extra = JSON.parse(fs.readFileSync(CODEBASES_FILE, 'utf-8'));
  } catch {}
  const list = [HUB, ...extra.filter((c) => c.id !== 'hub')];
  if (!list.some((c) => c.id === 'lyra') && fs.existsSync(path.join(LYRA_DIR, 'server.js'))) list.push(lyraPreset());
  return list;
}
let codebases = loadCodebases();
const saveCodebases = () => {
  try {
    fs.writeFileSync(CODEBASES_FILE, JSON.stringify(codebases.filter((c) => c.id !== 'hub'), null, 2), 'utf-8');
  } catch {}
};
export const findCodebase = (id?: string) => codebases.find((c) => c.id === (id || 'hub'));

// ---- Jobs ---------------------------------------------------------------------------------------

type Status = 'queued' | 'working' | 'checking' | 'ready' | 'applied' | 'undone' | 'discarded' | 'failed';

interface UpdateJob {
  id: string;
  codebaseId: string;
  request: string;
  cardId?: string; // when it was asked for from a project card
  local?: boolean; // run Claude Code on a model on this PC (Ollama) instead of your Claude plan
  localModel?: string; // the model it ran on
  status: Status;
  createdAt: string;
  finishedAt?: string;
  log: string[];
  summary?: string;
  diff?: string; // the change, as a patch against the codebase's git repository
  files?: { path: string; added: number; removed: number }[];
  check?: { ok: boolean; output: string };
  needsRestart?: boolean;
  error?: string;
  // Saved just before Apply, so Undo can put the files back exactly as they were.
  restore?: { ref: string; commit: string; files: string[]; backup?: string; at: string };
}

let jobs: UpdateJob[] = [];
try {
  jobs = JSON.parse(fs.readFileSync(STORE, 'utf-8'));
} catch {}
for (const j of jobs) {
  j.codebaseId = j.codebaseId || 'hub';
  if (j.status === 'working' || j.status === 'checking') Object.assign(j, { status: 'failed', error: 'The hub restarted while this was running.' });
}

const save = () => {
  try {
    fs.writeFileSync(STORE, JSON.stringify(jobs.slice(-50), null, 2), 'utf-8');
  } catch {}
};
const now = () => new Date().toISOString();

const git = (args: string[], cwd: string, input?: string, env?: NodeJS.ProcessEnv) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-3).join(' '));
  return r.stdout;
};

const repoRoot = (cb: Codebase) => git(['rev-parse', '--show-toplevel'], cb.dir).trim();
// The codebase's folder relative to its repository root ('' when the codebase is the whole repository).
const relOf = (cb: Codebase) => path.relative(repoRoot(cb), cb.dir).split(path.sep).join('/');
const pathspec = (rel: string) => (rel ? ['--', rel] : ['--', '.']);

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

function makeCopy(cb: Codebase, id: string): { dir: string; appDir: string; skippedLarge: number } {
  const root = repoRoot(cb);
  const rel = relOf(cb);
  const dir = path.join(WORK_ROOT, id);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  git(['worktree', 'add', '--detach', dir, 'HEAD'], root);
  // Bring over uncommitted work, so the AI starts from what you actually have.
  const pending = git(['diff', 'HEAD', '--binary', ...pathspec(rel)], root);
  if (pending.trim()) git(['apply', '--whitespace=nowarn', '-'], dir, pending);
  const untracked = git(['ls-files', '--others', '--exclude-standard', ...pathspec(rel)], root).split('\n').filter(Boolean);
  let skippedLarge = 0;
  for (const file of untracked) {
    const from = path.join(root, file);
    try {
      if (fs.statSync(from).size > MAX_COPY_BYTES) {
        skippedLarge++; // big media and data files aren't needed to change code
        continue;
      }
    } catch {
      continue;
    }
    const to = path.join(dir, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // Mark this as the starting point, so the AI's change can be read off exactly afterwards.
  git(['add', '-A', ...pathspec(rel)], dir);
  git(['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost', 'commit', '--no-verify', '-q', '--allow-empty', '-m', 'Starting point'], dir);
  // Share the installed packages so the checks can run in the copy.
  const appDir = rel ? path.join(dir, rel) : dir;
  const modules = path.join(cb.dir, 'node_modules');
  if (fs.existsSync(modules) && !fs.existsSync(path.join(appDir, 'node_modules'))) fs.symlinkSync(modules, path.join(appDir, 'node_modules'), 'junction');
  return { dir, appDir, skippedLarge };
}

function removeCopy(cb: Codebase, id: string) {
  const dir = path.join(WORK_ROOT, id);
  if (!fs.existsSync(dir)) return;
  try {
    // Remove the shared-packages link first, so nothing can follow it into the real folder.
    const rel = relOf(cb);
    const link = path.join(rel ? path.join(dir, rel) : dir, 'node_modules');
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link);
  } catch {}
  try {
    git(['worktree', 'remove', '--force', dir], repoRoot(cb));
  } catch {
    try {
      git(['worktree', 'prune'], repoRoot(cb));
    } catch {}
  }
}

// ---- Running the AI -----------------------------------------------------------------------------

const RULES = (cb: Codebase) => `You are improving ${cb.about}
Make the change the owner asks for below, carefully and completely.
Rules:
- Only edit files inside this folder. Never touch: ${cb.protect.join(', ')}.
- Follow the existing code style. Keep wording plain for a non-technical owner.
- Keep it working: if you change something shared, update every place that uses it.
- You cannot run commands; the hub runs the checks after you finish.
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

async function runAI(cb: Codebase, job: UpdateJob, appDir: string) {
  // On this PC when asked for, or when offline (Claude's servers can't be reached then).
  const local = (job.local || isOffline()) && localAgentModel();
  if (local) {
    job.localModel = local;
    job.log.push(`Running on this PC (${local})`);
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep', '--model', local || 'claude-sonnet-5-5'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('claude', args, { cwd: appDir, shell: true, windowsHide: true, env: local ? localClaudeEnv() : process.env });
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
            for (const part of ev.message?.content || []) if (part.type === 'tool_use') job.log.push(describeTool(part.name, part.input));
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
    child.stdin.end(`${RULES(cb)}\n\nThe owner's request:\n${job.request}`);
  });
}

function readChange(cb: Codebase, job: UpdateJob, dir: string) {
  const rel = relOf(cb);
  git(['add', '-A', ...pathspec(rel)], dir);
  job.diff = git(['diff', '--cached', '--binary', 'HEAD', ...pathspec(rel)], dir);
  const stat = git(['diff', '--cached', '--numstat', 'HEAD', ...pathspec(rel)], dir);
  job.files = stat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, r, p] = l.split('\t');
      return { path: rel && p.startsWith(`${rel}/`) ? p.slice(rel.length + 1) : p, added: Number(a) || 0, removed: Number(r) || 0 };
    });
  job.needsRestart = job.files.some((f) => !cb.liveDirs.some((d) => f.path === d || f.path.startsWith(d)));
}

function hasTests(appDir: string) {
  try {
    // Some editors save package.json with an invisible byte-order mark; strip it before reading.
    return !!JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8').replace(/^\uFEFF/, '')).scripts?.test;
  } catch {
    return false;
  }
}

// Runs the codebase's tests and returns the names of the ones that failed.
function runTests(appDir: string): { ok: boolean; failed: string[]; out: string } {
  const r = spawnSync('npm', ['test'], { cwd: appDir, shell: true, encoding: 'utf-8', windowsHide: true, timeout: 8 * 60 * 1000, env: { ...process.env, CI: '1' } });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // The test reporter marks a failed test with ✖ in front of its name.
  const failed = [...new Set([...out.matchAll(/^\s*✖\s+(.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/gm)].map((m) => m[1].trim()))].filter((n) => !/^failing tests:?$/i.test(n));
  return { ok: r.status === 0, failed, out };
}

function runCheck(cb: Codebase, appDir: string, files: string[], baselineFailed: string[] = []): { ok: boolean; output: string } {
  const clean = (s: string) => s.replace(new RegExp(appDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'g'), '').trim().slice(-6000);
  if (cb.check === 'tsc') {
    const r = spawnSync('npx', ['tsc', '--noEmit'], { cwd: appDir, shell: true, encoding: 'utf-8', windowsHide: true, timeout: 5 * 60 * 1000 });
    return { ok: r.status === 0, output: clean(`${r.stdout || ''}${r.stderr || ''}`) };
  }
  // Node: every changed .js file must parse, then the codebase's own tests must pass.
  const outputs: string[] = [];
  for (const f of files.filter((f) => /\.(c|m)?js$/.test(f) && fs.existsSync(path.join(appDir, f)))) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: appDir, encoding: 'utf-8', windowsHide: true, timeout: 60_000 });
    if (r.status !== 0) return { ok: false, output: clean(`Syntax error in ${f}:\n${r.stderr || r.stdout}`) };
  }
  outputs.push(`${files.length} file(s) parse cleanly.`);
  if (hasTests(appDir)) {
    const t = runTests(appDir);
    const newFailures = t.failed.filter((n) => !baselineFailed.includes(n));
    const stillFailing = t.failed.filter((n) => baselineFailed.includes(n));
    // Judge the change only on tests it broke; tests that were already failing are listed but don't count.
    if (!t.ok && (newFailures.length || !t.failed.length)) {
      return { ok: false, output: clean(`Tests that broke with this change:\n${newFailures.map((n) => `- ${n}`).join('\n') || '(could not tell which)'}\n\n${t.out.slice(-3500)}`) };
    }
    outputs.push(stillFailing.length ? `Tests: nothing new broke. Already failing before this change: ${stillFailing.join('; ')}` : 'All tests passed.');
  }
  return { ok: true, output: outputs.join('\n') };
}

let busy = false;
let onApplied: (job: UpdateJob, cb: Codebase) => void = () => {};

async function process_(job: UpdateJob) {
  busy = true;
  const cb = findCodebase(job.codebaseId);
  try {
    // A queued update whose codebase has since been removed fails by itself instead of blocking the queue.
    if (!cb) throw new Error('That codebase is not set up in the hub any more.');
    logActivity('work', `Code update started (${cb.name}): ${job.request.slice(0, 100)}`);
    job.log.push(`Making a separate copy of ${cb.name} to work on`);
    save();
    const copy = makeCopy(cb, job.id);
    if (copy.skippedLarge) job.log.push(`Left out ${copy.skippedLarge} large file${copy.skippedLarge === 1 ? '' : 's'} (over 5 MB) from the working copy`);
    try {
      let baselineFailed: string[] = [];
      if (cb.check === 'node' && hasTests(copy.appDir)) {
        job.log.push(`Running ${cb.name}'s tests once first, to see what already fails (about a minute or two)`);
        save();
        baselineFailed = runTests(copy.appDir).failed;
        if (baselineFailed.length) job.log.push(`Already failing before any change: ${baselineFailed.join('; ')}`);
      }
      job.log.push('Claude is working on the copy');
      save();
      await runAI(cb, job, copy.appDir);
      readChange(cb, job, copy.dir);
      if (!job.files?.length) throw new Error('The AI finished without changing anything.');
      job.status = 'checking';
      job.log.push(cb.check === 'tsc' ? 'Running the type check' : 'Checking the code and running the tests');
      save();
      job.check = runCheck(cb, copy.appDir, job.files.map((f) => f.path), baselineFailed);
      job.status = 'ready';
      logActivity(job.check.ok ? 'done' : 'error', `Code update ready for review (${cb.name}, ${job.files.length} file${job.files.length === 1 ? '' : 's'}${job.check.ok ? '' : ', checks failed'}).`);
    } finally {
      removeCopy(cb, job.id);
    }
  } catch (err: any) {
    job.status = 'failed';
    job.error = err?.message || 'Something went wrong.';
    logActivity('error', `Code update failed (${cb?.name || job.codebaseId}): ${job.error}`, { reason: job.error, retry: { kind: 'update', id: job.id } });
  } finally {
    job.finishedAt = now();
    save();
    busy = false;
    startNext();
  }
}

// Updates asked for while another is running wait here, in the order they were asked, and start by themselves.
let waitingForRoom = false;
function startNext() {
  if (busy) return;
  const next = jobs.find((j) => j.status === 'queued');
  if (!next) return;
  // PC busy mode: queued updates wait until the PC has room (they start by themselves then).
  const needsInternet = isOffline() && !localAgentModel();
  if (pcBusy() || needsInternet) {
    if (!waitingForRoom) logActivity('info', needsInternet ? 'Code updates are waiting for the internet (no AI on this PC can do them).' : 'Code updates are waiting: the PC is busy right now.');
    waitingForRoom = true;
    return;
  }
  waitingForRoom = false;
  next.status = 'working';
  save();
  process_(next);
}

function applyPatch(cb: Codebase, diff: string, reverse = false) {
  const root = repoRoot(cb);
  const args = ['apply', '--whitespace=nowarn', ...(reverse ? ['-R'] : [])];
  git([...args, '--check', '-'], root, diff); // a patch that no longer fits changes nothing at all
  git([...args, '-'], root, diff);
}

// ---- Restore points -----------------------------------------------------------------------------
// Just before an update is applied, the hub saves the current version of every file the update touches
// as a commit under a hidden git name (refs/eden-restore/<update id>), so Undo can put them back exactly.
// It uses a temporary index, so your branch, your files and your real staging area are never touched.
const GIT_LITERAL = { GIT_LITERAL_PATHSPECS: '1' }; // file names are taken exactly as written

// The files (relative to the repository folder) that a patch adds, changes, renames or deletes.
function patchPaths(cb: Codebase, diff: string): string[] {
  const out = git(['apply', '--numstat', '-z', '-'], repoRoot(cb), diff).split('\0');
  const paths: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i].match(/^\S+\t\S+\t(.*)$/);
    if (!m) continue;
    if (m[1]) paths.push(m[1]);
    else {
      paths.push(out[i + 1], out[i + 2]); // a renamed file lists its old and new name separately
      i += 2;
    }
  }
  return [...new Set(paths.filter(Boolean))];
}

// Saves what the files look like right now (files that don't exist yet are noted as missing). Returns the commit.
function saveRestorePoint(cb: Codebase, files: string[], refName: string, label: string): string {
  const root = repoRoot(cb);
  const index = path.join(os.tmpdir(), `eden-restore-${process.pid}-${Date.now()}.index`);
  const env = { GIT_INDEX_FILE: index, ...GIT_LITERAL };
  try {
    const existing = files.filter((f) => fs.existsSync(path.join(root, f)));
    if (existing.length) git(['add', '-f', '--', ...existing], root, undefined, env);
    const tree = git(['write-tree'], root, undefined, env).trim();
    const commit = git(['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost', 'commit-tree', tree, '-m', `${label} ${now()}`], root).trim();
    git(['update-ref', refName, commit], root);
    return commit;
  } finally {
    try {
      fs.rmSync(index, { force: true });
    } catch {}
  }
}

// Puts the files back as they were in a restore point; files that didn't exist then are removed.
function restoreFromPoint(cb: Codebase, files: string[], commit: string) {
  const root = repoRoot(cb);
  const had = new Set(git(['ls-tree', '-r', '--name-only', '-z', commit], root).split('\0').filter(Boolean));
  const back = files.filter((f) => had.has(f));
  if (back.length) git(['restore', `--source=${commit}`, '--worktree', '--', ...back], root, undefined, GIT_LITERAL);
  for (const f of files.filter((f) => !had.has(f))) {
    const full = path.join(root, f);
    try {
      fs.rmSync(full, { force: true });
      // Tidy up folders the update created that are now empty.
      for (let dir = path.dirname(full); dir.length > root.length && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
    } catch {}
  }
}

// ---- Backup -------------------------------------------------------------------------------------
// "Back up my work" saves a snapshot of the hub's files (everything git doesn't ignore) as a commit on a
// separate branch called eden-backups. It uses a temporary index, so your current branch, your files and
// your real staging area are never touched.
const BACKUP_FILE = path.join(APP_DIR, '.eden-backup.json');
const BACKUP_BRANCH = 'eden-backups';
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
// Never backed up, even if .gitignore were ever changed by mistake.
const NEVER_BACK_UP = ['**/.env*', '**/.eden-*', '**/.nexusflow-store.json', '**/node_modules', '**/node_modules/**'];

interface BackupInfo {
  at: string;
  files: number;
  changed: boolean; // false when nothing had changed since the previous backup
  auto: boolean;
}
let lastBackup: BackupInfo | null = null;
try {
  lastBackup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
} catch {}
let backingUp = false;

function makeBackup(): { files: number; changed: boolean } {
  const root = repoRoot(HUB);
  const rel = relOf(HUB);
  const index = path.join(os.tmpdir(), `eden-backup-${process.pid}-${Date.now()}.index`);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(['add', '-A', '--', rel || '.', ...NEVER_BACK_UP.map((p) => `:(exclude,glob)${p}`)], root, undefined, env);
    const files = git(['ls-files'], root, undefined, env).split('\n').filter(Boolean).length;
    const tree = git(['write-tree'], root, undefined, env).trim();
    let parent = '';
    try {
      parent = git(['rev-parse', '--verify', '-q', `refs/heads/${BACKUP_BRANCH}`], root).trim();
    } catch {}
    if (parent && git(['rev-parse', `${parent}^{tree}`], root).trim() === tree) return { files, changed: false };
    const commit = git(
      ['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost', 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Eden backup ${now()}`],
      root,
    ).trim();
    // Only moves the backup branch, and only if nobody else moved it meanwhile.
    git(['update-ref', `refs/heads/${BACKUP_BRANCH}`, commit, parent || '0'.repeat(40)], root);
    return { files, changed: true };
  } finally {
    try {
      fs.rmSync(index, { force: true });
    } catch {}
  }
}

function runBackup(auto: boolean): BackupInfo {
  if (backingUp) throw new Error('A backup is already running.');
  backingUp = true;
  try {
    const { files, changed } = makeBackup();
    lastBackup = { at: now(), files, changed, auto };
    try {
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(lastBackup, null, 2), 'utf-8');
    } catch {}
    logActivity('done', `${auto ? 'Daily backup' : 'Backup'} saved: ${files} file${files === 1 ? '' : 's'}${changed ? '' : ' (nothing had changed since the last one)'}.`);
    return lastBackup;
  } catch (err: any) {
    logActivity('error', `${auto ? 'Daily backup' : 'Backup'} failed: ${err.message}`);
    throw err;
  } finally {
    backingUp = false;
  }
}

// Once a day while the hub is running (checked every hour). A failed try waits a few hours before the next.
let lastAutoTry = 0;
function autoBackup() {
  if (backingUp) return;
  if (lastBackup && Date.now() - new Date(lastBackup.at).getTime() < BACKUP_EVERY_MS) return;
  if (Date.now() - lastAutoTry < 6 * 60 * 60 * 1000) return;
  lastAutoTry = Date.now();
  try {
    runBackup(true);
  } catch {}
}

// Starts a code update from elsewhere in the hub (a project card). Returns the job id.
export function requestCodeUpdate(codebaseId: string, request: string, cardId?: string, local = false): string {
  const cb = findCodebase(codebaseId);
  if (!cb) throw new Error('That codebase is not set up in the hub.');
  // Uses the saved sign-in check (it refreshes itself every so often) so adding to the queue is quick and never freezes the hub.
  if (local && !localAgentModel()) throw new Error('No AI on this PC can do code updates yet. Start Ollama (gpt-oss-20b or a coder model).');
  if (!local && !isOffline() && !cliSignedIn('anthropic')) throw new Error('Code updates use Claude Code. Sign in to Claude in Account → Connections first.');
  // If another update is running, this one waits in the queue.
  const job: UpdateJob = { id: `upd-${Date.now().toString(36)}`, codebaseId: cb.id, request, cardId, local: local || undefined, status: 'queued', createdAt: now(), log: [] };
  jobs.push(job);
  if (busy) logActivity('work', `Code update queued (${cb.name}): ${request.slice(0, 100)}`);
  save();
  startNext();
  return job.id;
}

export function registerUpdateRoutes(app: Express, hooks: { onApplied?: (info: { cardId?: string; request: string; codebase: string; files: number; needsRestart: boolean; restartHint: string }) => void } = {}) {
  onApplied = (job, cb) =>
    hooks.onApplied?.({ cardId: job.cardId, request: job.request, codebase: cb.name, files: job.files?.length || 0, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  const guard = (req: Request) => (isLocal(req) && fromOwnPage(req) ? '' : 'Code updates can only be managed from the hub on this computer.');
  startNext(); // updates still waiting when the hub was last closed carry on
  registerIdeaRoutes(app, guard);
  onBusyChange((isBusy) => !isBusy && startNext());
  onOfflineChange((off) => !off && startNext());

  app.get('/api/backup', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    res.json({ last: lastBackup, running: backingUp });
  });

  app.post('/api/backup', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied.replace('Code updates', 'Backups') });
    try {
      const b = runBackup(false);
      res.json({ ok: true, files: b.files, at: b.at, changed: b.changed });
    } catch (err: any) {
      res.status(500).json({ error: `The backup did not work. (${err.message})` });
    }
  });

  setTimeout(autoBackup, 60 * 1000).unref(); // a minute after the hub starts, then hourly: backs up if the last one is over a day old
  setInterval(autoBackup, 60 * 60 * 1000).unref();

  app.get('/api/updates', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    res.json({
      jobs: [...jobs].reverse().map(({ diff, restore, ...rest }) => ({ ...rest, hasDiff: !!diff, hasRestorePoint: !!restore, codebaseName: findCodebase(rest.codebaseId)?.name || rest.codebaseId })),
      codebases: codebases.map((c) => ({ id: c.id, name: c.name, dir: c.dir, check: c.check, restartHint: c.restartHint, ok: fs.existsSync(c.dir) })),
      busy,
      claudeReady: cliSignedIn('anthropic'),
    });
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
    try {
      const id = requestCodeUpdate(String(req.body?.codebaseId || 'hub'), request, typeof req.body?.cardId === 'string' ? req.body.cardId : undefined, req.body?.local === true);
      res.json({ job: { id } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Add a codebase: any folder inside a git repository.
  app.post('/api/codebases', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
    const dir = typeof req.body?.dir === 'string' ? path.resolve(req.body.dir.trim()) : '';
    if (!name || !dir) return res.status(400).json({ error: 'Give it a name and a folder.' });
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(400).json({ error: "That folder doesn't exist." });
    try {
      git(['rev-parse', '--show-toplevel'], dir);
    } catch {
      return res.status(400).json({ error: 'That folder is not in a git repository. Code updates need git so every change can be reviewed and undone.' });
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `code-${Date.now().toString(36)}`;
    if (codebases.some((c) => c.id === id)) return res.status(400).json({ error: 'A codebase with that name already exists.' });
    const isTs = fs.existsSync(path.join(dir, 'tsconfig.json'));
    codebases.push({
      id,
      name,
      dir,
      check: isTs ? 'tsc' : 'node',
      liveDirs: ['public/', 'src/'],
      restartHint: `restart ${name}`,
      about: `"${name}", a codebase in ${dir}.`,
      protect: ['.env files', 'node_modules', 'data and settings files'],
    });
    saveCodebases();
    res.json({ ok: true, id });
  });

  app.post('/api/updates/:id/apply', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    const cb = job && findCodebase(job.codebaseId);
    if (!job || !job.diff || !cb) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'ready' && job.status !== 'undone') return res.status(400).json({ error: 'This update has already been dealt with.' });
    const doesNotFit = (err: any) => res.status(409).json({ error: `${cb.name} has changed since this update was made, so it no longer fits. Discard it and ask again. (${err.message})` });
    // Make sure it fits before saving anything.
    try {
      git(['apply', '--whitespace=nowarn', '--check', '-'], repoRoot(cb), job.diff);
    } catch (err: any) {
      return doesNotFit(err);
    }
    // A restore point comes first: nothing is applied unless it was saved. For the hub that is also a full backup.
    const ref = `refs/eden-restore/${job.id}`;
    let restore: NonNullable<UpdateJob['restore']>;
    try {
      let backup: string | undefined;
      if (cb.id === 'hub') {
        runBackup(false);
        try {
          backup = git(['rev-parse', '--verify', '-q', `refs/heads/${BACKUP_BRANCH}`], repoRoot(cb)).trim();
        } catch {}
      }
      const files = patchPaths(cb, job.diff);
      restore = { ref, commit: saveRestorePoint(cb, files, ref, `Eden restore point before update ${job.id}`), files, backup, at: now() };
    } catch (err: any) {
      return res.status(500).json({ error: `Nothing was changed, because a restore point could not be saved first. (${err.message})` });
    }
    try {
      applyPatch(cb, job.diff);
    } catch (err: any) {
      try {
        git(['update-ref', '-d', ref], repoRoot(cb));
      } catch {}
      return doesNotFit(err);
    }
    job.restore = restore;
    job.status = 'applied';
    save();
    logActivity('done', `Code update applied (${cb.name}): ${job.request.slice(0, 80)}${job.needsRestart ? ` (${cb.restartHint} to finish)` : ''}`);
    onApplied(job, cb);
    res.json({ ok: true, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  });

  app.post('/api/updates/:id/undo', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    const cb = job && findCodebase(job.codebaseId);
    if (!job || !job.diff || !cb || job.status !== 'applied') return res.status(400).json({ error: 'Only an applied update can be undone.' });
    if (job.restore) {
      // Put every file back as it was before Apply. What the files look like right now is saved first,
      // so even changes made on top of this update afterwards can be found again.
      try {
        saveRestorePoint(cb, job.restore.files, `refs/eden-restore/${job.id}-before-undo`, `Eden: files as they were just before undoing update ${job.id}`);
        restoreFromPoint(cb, job.restore.files, job.restore.commit);
      } catch (err: any) {
        return res.status(500).json({ error: `The undo did not work, so nothing was changed. (${err.message})` });
      }
    } else {
      // Updates applied before restore points existed are undone by reversing their change.
      try {
        applyPatch(cb, job.diff, true);
      } catch (err: any) {
        return res.status(409).json({ error: `Other changes have been made on top of this one, so it can't be undone automatically. (${err.message})` });
      }
    }
    job.status = 'undone';
    save();
    logActivity('done', `Code update undone (${cb.name}): ${job.request.slice(0, 80)}`);
    res.json({ ok: true, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  });

  // Try a failed update again: starts a fresh update with the same request, and clears the failed one away.
  app.post('/api/updates/:id/retry', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'failed') return res.status(400).json({ error: 'Only a failed update can be tried again.' });
    try {
      const id = requestCodeUpdate(job.codebaseId, job.request, job.cardId);
      job.status = 'discarded'; // only after the new one has started, so a refused retry keeps the failed one
      save();
      res.json({ job: { id } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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


// ---- Suggested updates ---------------------------------------------------------------------------
// Claude reads the codebase (read-only: it can't change anything here) together with what is happening
// in the hub right now (recent errors and activity, updates already made or turned down) and suggests a
// few specific changes. Each one can be started with one click. Refreshed on request, and by itself at
// most once a day when the page is opened, so it doesn't eat into your Claude plan.
const IDEAS_FILE = path.join(APP_DIR, '.eden-ideas.json');
interface Idea {
  title: string;
  why: string;
  request: string;
  size: 'small' | 'medium' | 'large';
}
interface IdeaSet {
  ideas: Idea[];
  at?: string;
  running?: boolean;
  error?: string;
  dismissed: string[];
}
let ideaSets: Record<string, IdeaSet> = {};
try {
  ideaSets = JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf-8'));
  for (const s of Object.values(ideaSets)) s.running = false;
} catch {}
const saveIdeas = () => {
  try {
    fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideaSets, null, 2), 'utf-8');
  } catch {}
};
const ideaSet = (id: string) => (ideaSets[id] ||= { ideas: [], dismissed: [] });
const IDEAS_MAX_AGE = 24 * 60 * 60 * 1000;

function ideasPrompt(cb: Codebase) {
  const set = ideaSet(cb.id);
  const done = jobs.filter((j) => j.codebaseId === cb.id).slice(-15).map((j) => `- [${j.status}] ${j.request.slice(0, 160)}`);
  const recent = recentActivity(60);
  return `You are reviewing ${cb.about}
You may only read files. Do not change anything.

Suggest 5 specific, useful changes to this codebase that the owner (who runs a small studio making games and digital products, and is not a programmer) would notice and value. Base them on what you actually find in the code and on what is happening right now:

Recent activity in the hub (newest last; [error] lines show what went wrong):
${recent.length ? recent.join('\n') : '(nothing yet)'}

Updates already made or tried (don't suggest these again):
${done.length ? done.join('\n') : '(none)'}

Ideas the owner turned down (don't suggest these or close variants):
${set.dismissed.length ? set.dismissed.map((d) => `- ${d}`).join('\n') : '(none)'}

Prefer: fixing things that break or confuse, removing friction, and small features that save the owner time. Each must be doable as one change. Never suggest touching: ${cb.protect.join(', ')}.

Reply with ONLY a JSON array, no other text:
[{"title": "short name, max 8 words", "why": "one plain sentence on what the owner gains", "request": "clear instructions for a developer: what to change and where (file names)", "size": "small|medium|large"}]`;
}

async function generateIdeas(cb: Codebase) {
  const set = ideaSet(cb.id);
  if (set.running) return;
  set.running = true;
  set.error = undefined;
  saveIdeas();
  logActivity('work', `Looking for update ideas for ${cb.name}…`);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--permission-mode', 'default', '--tools', 'Read,Glob,Grep', '--model', 'claude-sonnet-5-5'];
      const child = spawn('claude', args, { cwd: cb.dir, shell: true, windowsHide: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Took longer than 10 minutes.'));
      }, 10 * 60 * 1000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const r = JSON.parse(out);
          if (r.is_error) return reject(new Error(String(r.result || 'Claude stopped with an error.')));
          resolve(String(r.result || ''));
        } catch {
          reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `Claude Code exited with ${code}`));
        }
      });
      child.stdin.end(ideasPrompt(cb));
    });
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const ideas = (JSON.parse(json) as any[])
      .filter((i) => i && i.title && i.request)
      .slice(0, 6)
      .map((i) => ({
        title: String(i.title).slice(0, 80),
        why: String(i.why || '').slice(0, 300),
        request: String(i.request).slice(0, 2000),
        size: (['small', 'medium', 'large'].includes(i.size) ? i.size : 'medium') as Idea['size'],
      }));
    if (!ideas.length) throw new Error('No ideas came back. Try again.');
    set.ideas = ideas;
    set.at = new Date().toISOString();
    logActivity('done', `${ideas.length} update ideas ready for ${cb.name} (Code updates).`);
  } catch (err: any) {
    set.error = err.message;
    logActivity('error', `Couldn't get update ideas for ${cb.name}: ${err.message}`);
  } finally {
    set.running = false;
    saveIdeas();
  }
}

function registerIdeaRoutes(app: Express, guard: (req: Request) => string) {
  app.get('/api/updates/ideas', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only available on this computer.' });
    const cb = findCodebase(String(req.query.codebaseId || 'hub'));
    if (!cb) return res.status(404).json({ error: 'Unknown codebase.' });
    const set = ideaSet(cb.id);
    // Refresh by itself when the ideas are a day old (only while someone is looking at the page).
    const stale = !set.at || Date.now() - new Date(set.at).getTime() > IDEAS_MAX_AGE;
    if (req.query.auto && stale && !set.running && !set.error && !isOffline() && cliSignedIn('anthropic')) generateIdeas(cb);
    const { dismissed, ...rest } = set;
    res.json({ ...rest, running: ideaSet(cb.id).running });
  });
  app.post('/api/updates/ideas', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const cb = findCodebase(String(req.body?.codebaseId || 'hub'));
    if (!cb) return res.status(404).json({ error: 'Unknown codebase.' });
    if (!cliSignedIn('anthropic')) return res.status(400).json({ error: 'Sign in to Claude in Account → Connections first.' });
    generateIdeas(cb);
    res.json({ ok: true });
  });
  app.post('/api/updates/ideas/dismiss', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const set = ideaSet(String(req.body?.codebaseId || 'hub'));
    const title = String(req.body?.title || '');
    set.ideas = set.ideas.filter((i) => i.title !== title);
    if (title && !set.dismissed.includes(title)) set.dismissed = [...set.dismissed, title].slice(-40);
    saveIdeas();
    res.json({ ok: true });
  });
  // Starting an idea removes it from the list (it's in the queue now).
  app.post('/api/updates/ideas/start', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const codebaseId = String(req.body?.codebaseId || 'hub');
    const set = ideaSet(codebaseId);
    const idea = set.ideas.find((i) => i.title === req.body?.title);
    if (!idea) return res.status(404).json({ error: 'That idea is gone. Refresh the ideas.' });
    try {
      const id = requestCodeUpdate(codebaseId, idea.request);
      set.ideas = set.ideas.filter((i) => i !== idea);
      saveIdeas();
      res.json({ job: { id } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}

export const __codeUpdatesTest = { makeCopy, removeCopy, readChange, runCheck, runTests, findCodebase, repoRoot };
