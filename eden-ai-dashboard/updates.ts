import { jsonObject, jsonStore } from './jsonStore';
// Code updates: the AI changes code safely, in the hub itself or in another codebase (such as LYRA).
//
//   1. You describe the change. The hub makes a separate copy of that codebase (a git worktree outside
//      it, including your uncommitted work), so the running app is never touched while the AI works.
//   2. Claude Code edits that copy. It may only read and edit files: no commands, no internet.
//   3. The hub runs that codebase's checks on the copy and shows you every changed line.
//   4. Only when you press Apply is the change copied into the real folder. Undo reverses it.
//   One update runs at a time; any others asked for meanwhile wait in a queue and start by themselves.
// Every request here must come from the hub's own page, on this computer or on a paired device the owner
// switched "Code updates" on for (see pairing.ts).
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity, recentActivity, fileProblem } from './activity';
import { holdForApply } from './control';
import { recheckWaiting } from './updateOverlap';
import { cliSignedIn, providerUnavailable, recordFailure } from './providers';
import { pcBusy, onBusyChange } from './busy';
import { isOffline, onOfflineChange } from './offline';
import { localAgentModel, localClaudeEnv, planClaudeEnv } from './localClaude';
import { mayView, mayManage } from './pairing';

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
// LYRA moved to C:\AZI\Forge; the old OneDrive folder is still checked for older setups.
const LYRA_DIR =
  [path.join('C:', path.sep, 'AZI', 'Forge'), path.join(os.homedir(), 'OneDrive', 'Documents', 'Forge')].find((d) => fs.existsSync(path.join(d, 'server.js'))) ||
  path.join('C:', path.sep, 'AZI', 'Forge');
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

const codebaseFile = jsonStore<Codebase[]>(CODEBASES_FILE, (value) =>
  Array.isArray(value) && value.every((c) => jsonObject(c) && typeof c.id === 'string' && typeof c.dir === 'string'), 2);
function loadCodebases(): Codebase[] {
  const extra = codebaseFile.read() ?? [];
  const list = [HUB, ...extra.filter((c) => c.id !== 'hub')];
  if (!list.some((c) => c.id === 'lyra') && fs.existsSync(path.join(LYRA_DIR, 'server.js'))) list.push(lyraPreset());
  return list;
}
let codebases = loadCodebases();
const saveCodebases = () => {
  try {
    codebaseFile.write(codebases.filter((c) => c.id !== 'hub'));
  } catch (err: any) {
    fileProblem('save your codebases', err);
  }
};
export const findCodebase = (id?: string) => codebases.find((c) => c.id === (id || 'hub'));

// Adds a codebase (a folder inside a git repository) and returns its id. Throws a message a person can act on.
export function addCodebase(rawName: string, rawDir: string): string {
  const name = rawName.trim().slice(0, 40);
  const dir = rawDir ? path.resolve(rawDir.trim()) : '';
  if (!name || !dir) throw new Error('Give it a name and a folder.');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("That folder doesn't exist.");
  try {
    git(['rev-parse', '--show-toplevel'], dir);
  } catch {
    throw new Error('That folder is not in a git repository. Code updates need git so every change can be reviewed and undone.');
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `code-${Date.now().toString(36)}`;
  const same = codebases.find((c) => c.id === id);
  if (same) {
    if (path.resolve(same.dir) === dir) return id; // already registered
    throw new Error('A codebase with that name already exists.');
  }
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
  return id;
}

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
  startedAt?: string; // when the AI began working on it (not when it was asked for), to show elapsed time
  finishedAt?: string;
  log: string[];
  summary?: string;
  lastAiMessage?: string; // the last thing the AI said in words (about 400 characters), to explain a run that changed nothing
  diff?: string; // the change, as a patch against the codebase's git repository
  files?: { path: string; added: number; removed: number }[];
  check?: { ok: boolean; output: string };
  needsRestart?: boolean;
  error?: string;
  interruptions?: number; // how many times the hub closed while this was running
  olderBase?: string; // id of an update applied/undone after this one was checked: it still fits, but its checks ran on older code
  baseApplied?: string[]; // this codebase's applied updates when the copy was made (see updateOverlap.ts)
  olderBaseSameFiles?: boolean; // that update changed a file this one changes too
  interrupted?: boolean; // stopped for that reason (after starting again once by itself)
  uncommitted?: number; // files in the codebase not yet saved to git (GitHub) when the update was asked for / started
  stale?: boolean; // Apply found the code had changed since this update was made, so it no longer fits
  retryOf?: string; // set on an update that was started by "Try again": the id of the earlier one
  retriedAs?: string; // set on the earlier one: the id of the fresh update started from it
  autoRetry?: boolean; // the hub started this one by itself (Apply found the earlier one no longer fits). It is never retried by itself again.
  // Saved just before Apply, so Undo can put the files back exactly as they were.
  restore?: { ref: string; commit: string; files: string[]; backup?: string; at: string };
}

const jobFile = jsonStore<UpdateJob[]>(STORE, (value) =>
  Array.isArray(value) && value.every((job) => jsonObject(job) && typeof job.id === 'string'), 2);
let jobs = jobFile.read() ?? [];

const save = () => {
  try {
    jobFile.write(jobs.slice(-50));
  } catch (err: any) {
    fileProblem('save your code updates', err);
  }
};
const now = () => new Date().toISOString();

// Updates that were running when the hub closed. Nothing is running yet at this point, so they can't still be
// alive. The first time, an update goes back into the queue and starts again by itself (it keeps its place, so
// it runs before anything asked for later). Cut short a second time, it is marked failed with "Try again", so
// an update that keeps stopping the hub can't go round in circles.
const interrupted: UpdateJob[] = [];
for (const j of jobs) {
  j.codebaseId = j.codebaseId || 'hub';
  if (j.status !== 'working' && j.status !== 'checking') continue;
  interrupted.push(j);
  j.interruptions = (j.interruptions || 0) + 1;
  j.log = [...(j.log || []), 'The hub restarted while this was running'];
  if (j.interruptions === 1) {
    j.status = 'queued';
    delete j.error;
    j.log.push('Back in the queue: it starts again from the beginning by itself');
    logActivity('info', `A code update was cut short when the hub restarted. It is back in the queue and starts again by itself: ${j.request.slice(0, 80)}`);
  } else {
    Object.assign(j, { status: 'failed', interrupted: true, finishedAt: now(), error: 'The hub restarted while this was running (twice now). Press "Try again" once the hub is staying up.' });
    logActivity('error', `Code update stopped: the hub restarted twice while it was running. ${j.request.slice(0, 80)}`, { retry: { kind: 'update', id: j.id } });
  }
}
if (interrupted.length) save();

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

// How many files in this codebase have changes that are not saved (committed) to git yet: changed, new or deleted.
// Only a note for the owner, so a failure here gives undefined and never stops an update.
function countUncommitted(cb: Codebase): number | undefined {
  try {
    const out = git(['status', '--porcelain', '--untracked-files=all', ...pathspec(relOf(cb))], repoRoot(cb));
    return out.split('\n').filter((l) => l.trim()).length;
  } catch {
    return undefined;
  }
}

// The page refreshes every few seconds, so its banner uses a count that is at most 20 seconds old.
const uncommittedCache = new Map<string, { at: number; n: number | undefined }>();
function uncommittedNow(cb: Codebase): number | undefined {
  const hit = uncommittedCache.get(cb.id);
  if (hit && Date.now() - hit.at < 20_000) return hit.n;
  const n = countUncommitted(cb);
  uncommittedCache.set(cb.id, { at: Date.now(), n });
  return n;
}

function makeCopy(cb: Codebase, id: string): { dir: string; appDir: string; skippedLarge: number; uncommitted?: number } {
  const root = repoRoot(cb);
  const rel = relOf(cb);
  const uncommitted = countUncommitted(cb);
  const dir = path.join(WORK_ROOT, id);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  // A copy left half-made by a restart (the update is retried under the same id, and the startup sweep skips copies
  // of updates still marked as working) would stop git with "already exists". Clear it first, the safe way
  // (removeCopy never deletes while the shared-packages link is inside), and forget git's stale entry.
  if (fs.existsSync(dir)) removeCopy(cb, id);
  try {
    git(['worktree', 'prune'], root);
  } catch {}
  if (fs.existsSync(dir)) throw new Error(`An old working copy of this update is still at ${dir} and could not be removed. Close anything using that folder (an editor, a terminal), then press Try again.`);
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
  return { dir, appDir, skippedLarge, uncommitted };
}

function removeCopy(cb: Codebase, id: string) {
  const dir = path.join(WORK_ROOT, id);
  const prune = () => {
    try {
      git(['worktree', 'prune'], repoRoot(cb));
    } catch {}
  };
  // The folder is already gone (for example after a crash): just forget git's leftover entry for it.
  if (!fs.existsSync(dir)) return prune();
  // Remove the shared-packages link first, so nothing can follow it into the real folder. It sits in the copy's
  // top folder or one folder down, depending on where the codebase is inside its repository.
  const isLink = (p: string) => {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  };
  let places = [dir];
  try {
    places = [dir, ...fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules').map((e) => path.join(dir, e.name))];
  } catch {}
  const links = places.map((p) => path.join(p, 'node_modules'));
  for (const link of links) {
    try {
      if (isLink(link)) fs.rmdirSync(link);
    } catch {}
  }
  try {
    git(['worktree', 'remove', '--force', dir], repoRoot(cb));
  } catch {
    // Git no longer knows this copy (the hub stopped half-way through making it): delete the folder itself,
    // but never while a shared-packages link is still inside it.
    try {
      if (!links.some(isLink)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    prune();
  }
}

// Working copies left behind by updates that were cut short in the past are cleared away when the hub starts.
function sweepCopies() {
  let names: string[] = [];
  try {
    names = fs.readdirSync(WORK_ROOT);
  } catch {
    return;
  }
  for (const name of names) {
    const job = jobs.find((j) => j.id === name);
    if (job && (job.status === 'working' || job.status === 'checking')) continue; // in use right now
    removeCopy(findCodebase(job?.codebaseId) || HUB, name);
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

// The codebase's own house rules (HOUSE_RULES.md in its folder), given to the AI before every update so changes reuse
// what exists, keep saved data safe and flag risky parts. Read fresh each time, so editing the file takes effect at once.
function houseRules(appDir: string): string {
  try {
    const text = fs.readFileSync(path.join(appDir, 'HOUSE_RULES.md'), 'utf8').trim();
    return text ? `\n\nHouse rules for this codebase (follow them; your summary must use their format):\n${text.slice(0, 8000)}` : '';
  } catch {
    return '';
  }
}

function describeTool(name: string, input: any): string {
  const file = input?.file_path || input?.path || input?.pattern || '';
  const short = String(file).replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (name === 'Read') return `Reading ${short}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${short}`;
  if (name === 'Write') return `Writing ${short}`;
  if (name === 'Glob' || name === 'Grep') return `Searching for ${String(file).slice(0, 60)}`;
  return name;
}

// The AI said its plan's usage limit is used up (for example Claude's 5-hour limit).
const USAGE_LIMIT_ERROR = /hit your .*limit|usage limit|rate.?limit|too many requests|\b429\b|quota|credit balance/i;

// The line added to the request when the AI answered with a plan or an "Understood" instead of editing files.
const MAKE_CHANGE_NOW = 'Make the change now by editing files. Do not reply with a plan or acknowledgement.';
const NO_CHANGE_MESSAGE = 'The AI did not make any change. Try rewording the request with the name of the screen you mean.';

// True when what the AI said last is just an acknowledgement ("Understood, I will…") and not a real explanation of
// why nothing needed changing: it starts like one, or it names no file and gives no reason.
function looksLikeAcknowledgement(said?: string): boolean {
  const text = (said || '').trim();
  if (!text) return true;
  if (/^[\s"'*_>#-]*(understood|i will|i'll|i shall|i am going to|i'm going to|sure|okay|ok|got it|will do|certainly|of course|absolutely|alright|noted)\b/i.test(text)) return true;
  const namesFile = /[\w.-]+\.(tsx?|jsx?|css|json|html|md|mjs|cjs)\b|[\w-]+[\\/][\w.-]+/i.test(text);
  const givesReason = /\b(because|already|since|so that|not needed|no need|nothing to|doesn'?t need|does not need|there is no|there's no|cannot|can't|unable)\b/i.test(text);
  return !namesFile && !givesReason;
}

async function runAI(cb: Codebase, job: UpdateJob, appDir: string, extra = '') {
  // On this PC when asked for, or when offline (Claude's servers can't be reached then).
  let local = (job.local || isOffline()) && localAgentModel();
  // Claude already reported its limit is used up: don't wait for it to fail again, go straight to the AI on this PC.
  if (!local && providerUnavailable('anthropic') && localAgentModel()) {
    local = localAgentModel();
    job.log.push('Claude has hit its usage limit, so a different AI (on this PC) does this update');
  }
  try {
    await runAIOnce(cb, job, appDir, local || null, extra);
  } catch (err: any) {
    // Claude's limit ran out part-way: carry on with the AI on this PC instead of failing the update.
    if (!local && USAGE_LIMIT_ERROR.test(String(err?.message || ''))) recordFailure('anthropic', String(err.message)); // remember it, so nothing else asks Claude until it resets
    const other = !local && USAGE_LIMIT_ERROR.test(String(err?.message || '')) && localAgentModel();
    if (!other) throw err;
    job.log.push('Claude hit its usage limit, so a different AI (on this PC) is taking over');
    logActivity('info', `Claude hit its usage limit during a code update, so an AI on this PC (${other}) is finishing it.`);
    save();
    await runAIOnce(cb, job, appDir, other, extra);
  }
}

async function runAIOnce(cb: Codebase, job: UpdateJob, appDir: string, local: string | null, extra = '') {
  if (local) {
    job.localModel = local;
    job.log.push(`Running on this PC (${local})`);
  }
  job.summary = undefined;
  job.lastAiMessage = undefined; // a fresh run (for example "Try again") starts without the old message
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep', '--model', local ? 'sonnet' : 'claude-sonnet-5-5'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(['claude', ...args].join(' '), { cwd: appDir, shell: true, windowsHide: true, env: local ? localClaudeEnv(local) : planClaudeEnv() });
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
            const said = (ev.message?.content || [])
              .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
              .map((part: any) => part.text)
              .join('\n')
              .trim();
            if (said) job.lastAiMessage = said.length > 400 ? `${said.slice(0, 400).trim()}…` : said;
            if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
            save();
          } else if (ev.type === 'result') {
            if (ev.is_error) errText = ev.result || 'The AI stopped with an error.';
            else job.summary = String(ev.result || '').trim();
          }
        } catch {}
      }
    });
    // Warnings (the model-name note, the connectors note) are not failures: only keep real error lines.
    child.stderr.on('data', (d) => (errText += d.toString().split(/\r?\n/).filter((l: string) => l.trim() && !/^\s*⚠|unrecognized_model|doesn't recognize the model|connectors are disabled/i.test(l)).map((l: string) => l + '\n').join('')));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !errText) resolve();
      else reject(new Error(errText.trim().split('\n').slice(-2).join(' ') || `Claude Code exited with ${code}`));
    });
    child.stdin.end(`${RULES(cb)}${houseRules(appDir)}\n\nThe owner's request:\n${job.request}${extra ? `\n\n${extra}` : ''}`);
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

// Runs a command in the background and gives back its exit code and output. The hub keeps answering while it
// runs: tests and type checks take a minute or more, and waiting for them the old way froze the whole hub (pages
// stopped loading, and the watchdog restarted the hub, which killed the update that was running).
function runCommand(cmd: string, args: string[], opts: { cwd: string; timeout: number; shell?: boolean; env?: NodeJS.ProcessEnv }): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    // Through a shell the command goes as one line (the words here are fixed, never typed in by anyone).
    const child = opts.shell
      ? spawn([cmd, ...args].join(' '), { cwd: opts.cwd, shell: true, windowsHide: true, env: opts.env })
      : spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, env: opts.env });
    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, out });
    };
    const timer = setTimeout(() => {
      out += `\n(Stopped: it was still running after ${Math.round(opts.timeout / 60000)} minutes.)`;
      // Through a shell the real work is a child of the shell, so stop the whole family.
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      else child.kill();
      finish(null);
    }, opts.timeout);
    const add = (d: Buffer) => {
      out += d.toString();
      if (out.length > 4_000_000) out = out.slice(-2_000_000);
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    child.on('error', (err) => {
      out += String(err?.message || err);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

// Runs the codebase's tests and returns the names of the ones that failed.
async function runTests(appDir: string): Promise<{ ok: boolean; failed: string[]; out: string }> {
  const r = await runCommand('npm', ['test'], { cwd: appDir, shell: true, timeout: 8 * 60 * 1000, env: { ...process.env, CI: '1' } });
  const out = r.out;
  // The test reporter marks a failed test with ✖ in front of its name.
  const failed = [...new Set([...out.matchAll(/^\s*✖\s+(.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/gm)].map((m) => m[1].trim()))].filter((n) => !/^failing tests:?$/i.test(n));
  return { ok: r.status === 0, failed, out };
}

// The type problems tsc reports, without line numbers (so a problem that only moved down a few lines still counts as the same one).
function typeProblems(out: string): string[] {
  const found = [...out.matchAll(/^(.+?)\(\d+,\d+\):\s*error\s+(TS\d+):\s*(.+)$/gm)].map((m) => `${m[1].trim().replace(/\\/g, '/')}: ${m[2]}: ${m[3].trim()}`);
  return [...new Set(found)];
}

// Runs the type check and gives back the problems it found (used before the AI starts, to know what was already wrong).
async function runTypeCheck(appDir: string) {
  const r = await runCommand('npx', ['tsc', '--noEmit', '--pretty', 'false'], { cwd: appDir, shell: true, timeout: 5 * 60 * 1000 });
  return { ok: r.status === 0, out: r.out, problems: typeProblems(r.out) };
}

async function runCheck(cb: Codebase, appDir: string, files: string[], baselineFailed: string[] = [], baselineTypeProblems: string[] = []): Promise<{ ok: boolean; output: string }> {
  const clean = (s: string) => s.replace(new RegExp(appDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'g'), '').trim().slice(-6000);
  if (cb.check === 'tsc') {
    const t = await runTypeCheck(appDir);
    if (t.ok) return { ok: true, output: 'The type check found no problems.' };
    const newProblems = t.problems.filter((p) => !baselineTypeProblems.includes(p));
    const old = t.problems.length - newProblems.length;
    // Judge the change only on problems it caused; ones that were already there before the AI started are listed but don't count.
    if (newProblems.length || !t.problems.length) {
      return { ok: false, output: clean(`Type problems that this change caused:\n${newProblems.map((p) => `- ${p}`).join('\n') || '(could not tell which)'}\n\n${t.out.slice(-3500)}`) };
    }
    return { ok: true, output: `Type check: nothing new broke. ${old} problem${old === 1 ? ' was' : 's were'} already there before this change.` };
  }
  // Node: every changed .js file must parse, then the codebase's own tests must pass.
  const outputs: string[] = [];
  for (const f of files.filter((f) => /\.(c|m)?js$/.test(f) && fs.existsSync(path.join(appDir, f)))) {
    const r = await runCommand(process.execPath, ['--check', f], { cwd: appDir, timeout: 60_000 });
    if (r.status !== 0) return { ok: false, output: clean(`Syntax error in ${f}:\n${r.out}`) };
  }
  outputs.push(`${files.length} file(s) parse cleanly.`);
  if (hasTests(appDir)) {
    const t = await runTests(appDir);
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
// A hub update that changes the server part was applied or undone since this copy of the hub started:
// it only takes effect after a restart (which also clears this).
let restartPending = false;
const LOCKED = 'Code updates are kept to this computer. To use them on this device too, switch on "Code updates" for it on the PC (Devices, under Connected over Wi-Fi), or plug it in with USB.';
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
    job.baseApplied = jobs.filter((x) => x.codebaseId === cb.id && x.status === 'applied').map((x) => x.id);
    if (copy.uncommitted !== undefined) job.uncommitted = copy.uncommitted; // the count at the moment the copy was made
    if (copy.skippedLarge) job.log.push(`Left out ${copy.skippedLarge} large file${copy.skippedLarge === 1 ? '' : 's'} (over 5 MB) from the working copy`);
    try {
      let baselineFailed: string[] = [];
      if (cb.check === 'node' && hasTests(copy.appDir)) {
        job.log.push(`Running ${cb.name}'s tests once first, to see what already fails (about a minute or two)`);
        save();
        baselineFailed = (await runTests(copy.appDir)).failed;
        if (baselineFailed.length) job.log.push(`Already failing before any change: ${baselineFailed.join('; ')}`);
      }
      let baselineTypeProblems: string[] = [];
      if (cb.check === 'tsc') {
        job.log.push(`Running ${cb.name}'s type check once first, to see what is already wrong (about a minute)`);
        save();
        baselineTypeProblems = (await runTypeCheck(copy.appDir)).problems;
        if (baselineTypeProblems.length) job.log.push(`Already wrong before any change: ${baselineTypeProblems.length} type problem${baselineTypeProblems.length === 1 ? '' : 's'}`);
      }
      job.log.push('Claude is working on the copy');
      save();
      await runAI(cb, job, copy.appDir);
      readChange(cb, job, copy.dir);
      if (!job.files?.length && looksLikeAcknowledgement(job.lastAiMessage)) {
        // The AI only said "Understood" or made a plan: run it once more, telling it to edit the files this time.
        job.log.push('The AI replied without changing anything, so it is being asked once more to make the change');
        save();
        await runAI(cb, job, copy.appDir, MAKE_CHANGE_NOW);
        readChange(cb, job, copy.dir);
        if (!job.files?.length) throw new Error(NO_CHANGE_MESSAGE); // the raw AI text is left out on purpose
      }
      if (!job.files?.length) throw new Error(`The AI finished without changing anything.${job.lastAiMessage ? ` It said: "${job.lastAiMessage}"` : ''}`);
      job.status = 'checking';
      job.log.push(cb.check === 'tsc' ? 'Running the type check' : 'Checking the code and running the tests');
      save();
      job.check = await runCheck(cb, copy.appDir, job.files.map((f) => f.path), baselineFailed, baselineTypeProblems);
      job.status = 'ready';
      const fileCount = `${job.files.length} file${job.files.length === 1 ? '' : 's'}`;
      if (job.check.ok) {
        logActivity('done', `Code update ready for review (${cb.name}, ${fileCount}).`);
      } else {
        // Say what the check found and what to do, not only that it failed.
        const firstProblem = job.check.output.split('\n').map((l) => l.trim()).find((l) => /error|fail|broke|syntax/i.test(l)) || '';
        logActivity('error', `Code update ready for review (${cb.name}, ${fileCount}) but its checks failed${firstProblem ? ` (${firstProblem.slice(0, 160)})` : ''}. Open it and press "Ask the AI to fix it", or discard it.`, { reason: job.check.output.slice(-500), retry: { kind: 'update', id: job.id } });
      }
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
  next.startedAt = now();
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
const backupFile = jsonStore<BackupInfo>(BACKUP_FILE, (value) =>
  jsonObject(value) && typeof value.at === 'string' && typeof value.files === 'number' &&
  typeof value.changed === 'boolean' && typeof value.auto === 'boolean', 2);
let lastBackup = backupFile.read() ?? null;
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
      backupFile.write(lastBackup);
    } catch (err: any) {
      fileProblem('save the last backup details', err);
    }
    logActivity('done', `Code history saved (${files} file${files === 1 ? '' : 's'}${changed ? '' : ', nothing had changed since the last one'}${auto ? ', daily' : ''}).`);
    return lastBackup;
  } catch (err: any) {
    logActivity('error', `Code history didn't save: ${err.message}`);
    throw err;
  } finally {
    backingUp = false;
  }
}

// Once a day while the hub is running (checked every hour). A failed try waits a few hours before the next.
let lastAutoTry = 0;
function autoBackup() {
  if (backingUp) return;
  // Wait while the PC is busy, like the zip backup does. Not counted as a try, so the next hourly check tries again.
  if (pcBusy()) return;
  if (lastBackup && Date.now() - new Date(lastBackup.at).getTime() < BACKUP_EVERY_MS) return;
  if (Date.now() - lastAutoTry < 6 * 60 * 60 * 1000) return;
  lastAutoTry = Date.now();
  try {
    runBackup(true);
  } catch {}
}

// Starts a code update from elsewhere in the hub (a project card). Returns the job id.
// Code updates that are running or waiting their turn, named for the owner (used to warn before a restart).
export function activeUpdateNames(): { working: string[]; queued: string[] } {
  const name = (j: UpdateJob) => `"${j.request.replace(/\s+/g, ' ').slice(0, 80)}" (${findCodebase(j.codebaseId)?.name || 'a codebase'})`;
  return {
    working: jobs.filter((j) => j.status === 'working').map(name),
    queued: jobs.filter((j) => j.status === 'queued').map(name),
  };
}

export function requestCodeUpdate(codebaseId: string, request: string, cardId?: string, local = false): string {
  const cb = findCodebase(codebaseId);
  if (!cb) throw new Error('That codebase is not set up in the hub.');
  // Uses the saved sign-in check (it refreshes itself every so often) so adding to the queue is quick and never freezes the hub.
  if (local && !localAgentModel()) throw new Error('No AI on this PC can do code updates yet. Start Ollama (gpt-oss-20b or a coder model).');
  if (!local && !isOffline() && !cliSignedIn('anthropic')) throw new Error('Code updates use Claude Code. Sign in to Claude in Account → Connections first.');
  // If another update is running, this one waits in the queue.
  const job: UpdateJob = { id: `upd-${Date.now().toString(36)}`, codebaseId: cb.id, request, cardId, local: local || undefined, status: 'queued', createdAt: now(), log: [] };
  job.uncommitted = countUncommitted(cb); // shown right away; refreshed when the copy is actually made
  jobs.push(job);
  if (busy) logActivity('work', `Code update queued (${cb.name}): ${request.slice(0, 100)}`);
  save();
  startNext();
  return job.id;
}

// Starts a fresh update with the same request and codebase, linked to the old one (retryOf / retriedAs), then clears the
// old one away. Used by the "Try again" route and by Apply's one automatic retry (`auto`). Throws if it can't start,
// and then the old one is left as it was.
function startRetry(job: UpdateJob, opts: { note?: string; useClaude?: boolean; auto?: boolean } = {}): string {
  const note = (opts.note || '').trim().slice(0, 3000);
  // The note always fits: the request is shortened to make room for it, never the other way round.
  const header = '\n\nLast time this failed:\n';
  const base = job.request.split(header.trimEnd())[0].trimEnd();
  const request = note ? `${base.slice(0, Math.max(500, 4000 - header.length - note.length))}${header}${note}`.slice(0, 4000 + 3000) : job.request;
  const local = opts.useClaude === true ? false : job.local === true;
  const id = requestCodeUpdate(job.codebaseId, request, job.cardId, local);
  const fresh = jobs.find((j) => j.id === id);
  if (fresh) {
    fresh.retryOf = job.id;
    if (opts.auto) fresh.autoRetry = true;
  }
  job.retriedAs = id;
  job.status = 'discarded'; // only after the new one has started, so a refused retry keeps the old one
  delete job.stale;
  delete job.olderBase;
  delete job.olderBaseSameFiles;
  save();
  return id;
}

// Right after an update is applied or undone: every other finished update waiting to be applied was checked on
// code that has now changed. Ones that no longer fit are marked stale ("Try again" re-makes them now instead of
// failing later at Apply). Ones that fit (including stale ones an Undo made fit again) get olderBase: their checks
// need running again, since a change in any file (a shared type, an export) can break them. See updateOverlap.ts.
function recheckAfter(changed: UpdateJob, cb: Codebase) {
  const fits = (diff: string) => {
    try {
      git(['apply', '--whitespace=nowarn', '--check', '-'], repoRoot(cb), diff);
      return true;
    } catch {
      return false;
    }
  };
  const appliedNow = jobs.filter((x) => x.codebaseId === cb.id && x.status === 'applied').map((x) => x.id);
  const r = recheckWaiting(jobs, changed, fits, appliedNow);
  for (const id of r.current) {
    const j = jobs.find((x) => x.id === id);
    if (!j || !j.olderBase) continue;
    delete j.olderBase;
    delete j.olderBaseSameFiles;
    j.log.push(`The code is back to what this was checked on, so its checks count again`);
  }
  for (const id of r.stale) {
    const j = jobs.find((x) => x.id === id);
    if (!j) continue;
    j.stale = true;
    delete j.olderBase;
    j.log.push(`No longer fits: "${changed.request.slice(0, 60)}" changed the same code first`);
  }
  for (const id of r.refit) {
    const j = jobs.find((x) => x.id === id);
    if (!j) continue;
    delete j.stale;
    j.log.push(`Fits the code again after "${changed.request.slice(0, 60)}" was ${changed.status === 'undone' ? 'undone' : 'applied'}`);
  }
  for (const { id, sameFiles } of r.recheck) {
    const j = jobs.find((x) => x.id === id);
    if (!j) continue;
    j.olderBase = changed.id;
    j.olderBaseSameFiles = sameFiles;
    j.log.push(`Its checks ran before "${changed.request.slice(0, 60)}" was ${changed.status === 'undone' ? 'undone' : 'applied'}${sameFiles ? ', which changed the same files' : ''}`);
  }
  if (r.stale.length || r.recheck.length) {
    const parts = [r.stale.length && `${r.stale.length} no longer ${r.stale.length === 1 ? 'fits' : 'fit'}`, r.recheck.length && `${r.recheck.length} should be checked again`].filter(Boolean);
    logActivity('info', `The code changed under other finished updates for ${cb.name}: ${parts.join(', ')}. Press "Try again" on them to re-make them on the current code.`);
  }
}

export function registerUpdateRoutes(app: Express, hooks: { onApplied?: (info: { cardId?: string; request: string; codebase: string; files: number; needsRestart: boolean; restartHint: string }) => void } = {}) {
  onApplied = (job, cb) =>
    hooks.onApplied?.({ cardId: job.cardId, request: job.request, codebase: cb.name, files: job.files?.length || 0, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  const guard = (req: Request) => (mayManage(req) ? '' : LOCKED);
  // Tidy up the working copies of updates that were cut short (now or in the past), before the next one starts.
  for (const j of interrupted) {
    const cb = findCodebase(j.codebaseId);
    if (cb) removeCopy(cb, j.id);
  }
  // Sweep right now rather than a few seconds later, so no update can start (and no half-made copy can be left
  // under the same id) before the old copies are gone. Nothing is marked as working yet, so every old copy is fair game.
  sweepCopies();
  // Updates still waiting when the hub was last closed carry on, once the hub itself is up and answering.
  setTimeout(startNext, 8000).unref?.();
  registerIdeaRoutes(app, guard);
  onBusyChange((isBusy) => !isBusy && startNext());
  onOfflineChange((off) => !off && startNext());

  app.get('/api/backup', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
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
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    // How long an update usually takes: the middle of the last 5 that ran to the end (8 minutes until there are any).
    const took = jobs
      .filter((j) => j.startedAt && j.finishedAt && !j.interrupted && !j.error)
      .slice(-5)
      .map((j) => new Date(j.finishedAt!).getTime() - new Date(j.startedAt!).getTime())
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);
    const estimateMs = took.length ? took[Math.floor(took.length / 2)] : 8 * 60 * 1000;
    res.json({
      estimateMs,
      jobs: [...jobs].reverse().map(({ diff, restore, ...rest }) => ({ ...rest, hasDiff: !!diff, hasRestorePoint: !!restore, codebaseName: findCodebase(rest.codebaseId)?.name || rest.codebaseId })),
      codebases: codebases.map((c) => {
        const ok = fs.existsSync(c.dir);
        return { id: c.id, name: c.name, dir: c.dir, check: c.check, restartHint: c.restartHint, ok, uncommitted: ok ? uncommittedNow(c) : undefined };
      }),
      busy,
      claudeReady: cliSignedIn('anthropic'),
      restartPending,
      remote: !isLocal(req), // a paired device: the page asks before applying, so a stray tap can't change code
    });
  });

  app.get('/api/updates/:id/diff', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
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
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Add a codebase: any folder inside a git repository.
  app.post('/api/codebases', (req, res) => {
    // Choosing a folder on this PC for the AI to change: only from the PC itself.
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'A codebase can only be added from the hub on this computer.' });
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const dir = typeof req.body?.dir === 'string' ? req.body.dir : '';
    if (name && codebases.some((c) => c.id === name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))) {
      return res.status(400).json({ error: 'A codebase with that name already exists.' });
    }
    try {
      res.json({ ok: true, id: addCodebase(name, dir) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/updates/:id/apply', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    const cb = job && findCodebase(job.codebaseId);
    if (!job || !job.diff || !cb) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'ready' && job.status !== 'undone') return res.status(400).json({ error: 'This update has already been dealt with.' });
    const doesNotFit = (err: any) => {
      job.stale = true; // lets "Try again" start a fresh update on the current code
      save();
      // One automatic retry on the current code. Only once per update: one the hub made by itself is never retried
      // by itself again, and neither is one that was already tried again. If it can't start (e.g. not signed in to
      // Claude), the update stays as it is and the "Try again" button is still there.
      if (!job.autoRetry && !job.retriedAs) {
        try {
          const id = startRetry(job, { auto: true });
          logActivity('work', 'Re-made your update on the latest code');
          return res.status(409).json({ retriedAs: id, error: `${cb.name} has changed since this update was made, so it no longer fits. Eden has started re-making it on the latest code. Look for the newer update in the list.` });
        } catch {}
      }
      return res.status(409).json({ error: `${cb.name} has changed since this update was made, so it no longer fits. Press "Try again" to redo it on the current code, or discard it. (${err.message})` });
    };
    // Make sure it fits before saving anything.
    try {
      git(['apply', '--whitespace=nowarn', '--check', '-'], repoRoot(cb), job.diff);
    } catch (err: any) {
      return doesNotFit(err);
    }
    holdForApply(); // Eden projects pause while the real code changes, and resume by themselves shortly after
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
    delete job.stale;
    delete job.olderBase;
    delete job.olderBaseSameFiles;
    recheckAfter(job, cb);
    if (cb.id === 'hub' && job.needsRestart) restartPending = true;
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
    recheckAfter(job, cb);
    if (cb.id === 'hub' && job.needsRestart) restartPending = true;
    save();
    logActivity('done', `Code update undone (${cb.name}): ${job.request.slice(0, 80)}`);
    res.json({ ok: true, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  });

  // Try an update again: starts a fresh update with the same request and codebase, linked to the old one.
  // Allowed for failed and discarded updates, and for ones that no longer fit the code (Apply said the code
  // has changed). The fresh update works on a new copy of the code as it is now (see makeCopy), and the old
  // one is cleared away.
  // The fix buttons in Code updates can also send:
  //   useClaude: true  -> run it on your Claude plan instead of an AI on this PC (when the local model failed)
  //   note: "..."     -> added under the request, e.g. the checks that failed last time, so the AI can fix them
  app.post('/api/updates/:id/retry', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    // Stale (no longer fits) or made on older code (fits, but another update changed the same files after its checks).
    const noLongerFits = (!!job.stale || !!job.olderBase) && (job.status === 'ready' || job.status === 'undone');
    // A finished update whose checks failed can be redone in one step ("Ask the AI to fix it"): like every retry,
    // the old one is only cleared once the new one has started, so a refused retry never loses the finished change.
    const checksFailed = job.status === 'ready' && !!job.check && !job.check.ok;
    if (job.status !== 'failed' && job.status !== 'discarded' && !noLongerFits && !checksFailed) {
      return res.status(400).json({ error: 'Only a failed or discarded update, one whose checks failed, or one that no longer fits the code, can be tried again.' });
    }
    // A second press (or a second device) must not start the same update twice.
    const already = job.retriedAs && jobs.find((j) => j.id === job.retriedAs);
    if (already && already.status !== 'failed' && already.status !== 'discarded') {
      return res.status(409).json({ error: 'This update was already tried again. Look for the newer one in the list.' });
    }
    try {
      const id = startRetry(job, { note: typeof req.body?.note === 'string' ? req.body.note : '', useClaude: req.body?.useClaude === true });
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Change the queue order. Waiting updates run in the order they sit in `jobs` (oldest first), so moving one
  // swaps its place with the waiting update next to it. `to`: 'up' (runs sooner), 'down', 'first' or 'last'.
  // Only waiting updates move; the one running now and finished ones keep their place.
  app.post('/api/updates/:id/move', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'queued') return res.status(400).json({ error: 'Only updates waiting in the queue can be moved.' });
    const to = String(req.body?.to || '');
    if (!['up', 'down', 'first', 'last'].includes(to)) return res.status(400).json({ error: 'Say where to move it: up, down, first or last.' });
    const slots = jobs.map((j, i) => (j.status === 'queued' ? i : -1)).filter((i) => i >= 0); // queue places, in run order
    const order = slots.map((i) => jobs[i]);
    const from = order.indexOf(job);
    const target = to === 'first' ? 0 : to === 'last' ? order.length - 1 : to === 'up' ? Math.max(0, from - 1) : Math.min(order.length - 1, from + 1);
    if (target !== from) {
      order.splice(from, 1);
      order.splice(target, 0, job);
      slots.forEach((slot, k) => (jobs[slot] = order[k]));
      save();
    }
    res.json({ ok: true, queue: order.map((j) => j.id) });
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
const ideaFile = jsonStore<Record<string, IdeaSet>>(IDEAS_FILE, (value) =>
  jsonObject(value) && Object.values(value).every((set) =>
    jsonObject(set) && Array.isArray(set.ideas) && Array.isArray(set.dismissed)), 2);
const ideaSets = ideaFile.read() ?? {};
for (const s of Object.values(ideaSets)) s.running = false;
const saveIdeas = () => {
  try {
    ideaFile.write(ideaSets);
  } catch (err: any) {
    fileProblem('save your update ideas', err);
  }
};
const ideaSet = (id: string) => (ideaSets[id] ||= { ideas: [], dismissed: [] });
const IDEAS_MAX_AGE = 24 * 60 * 60 * 1000;

// Two requests count as the same idea when their first 80 letters and numbers match (ignoring capitals,
// punctuation and spacing).
const ideaKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80).trim();
const SAME_IDEA_BUSY: Status[] = ['queued', 'working', 'checking', 'ready'];
// An existing update (any status) for this codebase that asks for the same thing, if there is one.
const findSameUpdate = (codebaseId: string, request: string, onlyStatuses?: Status[]) => {
  const key = ideaKey(request);
  if (!key) return undefined;
  return jobs.find((j) => j.codebaseId === codebaseId && (!onlyStatuses || onlyStatuses.includes(j.status)) && ideaKey(j.request) === key);
};

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

Ideas already being suggested to the owner right now (don't suggest these again, only suggest different ones):
${set.ideas.length ? set.ideas.map((i) => `- ${i.title}: ${i.request.slice(0, 160)}`).join('\n') : '(none)'}

Ideas the owner turned down (don't suggest these or close variants):
${set.dismissed.length ? set.dismissed.map((d) => `- ${d}`).join('\n') : '(none)'}

Prefer: fixing things that break or confuse, removing friction, and small features that save the owner time. Each must be doable as one change. Never suggest touching: ${cb.protect.join(', ')}.

Reply with ONLY a JSON array, no other text:
[{"title": "short name, max 8 words", "why": "one plain sentence on what the owner gains", "request": "clear instructions for a developer: what to change and where (file names)", "size": "small|medium|large"}]`;
}

// Don't look for new ideas while the owner still has this many updates waiting (ready to apply or queued),
// and not in the first minutes after the hub starts. "Find ideas anyway" skips both.
const IDEAS_MAX_WAITING = 5;
const IDEAS_QUIET_AFTER_START_MS = 10 * 60 * 1000;
const HUB_STARTED_AT = Date.now();
const lastSkipLogged: Record<string, number> = {};

// Why idea-finding should be skipped right now, or undefined when it's fine to go ahead.
function ideasSkipReason(cb: Codebase) {
  const waiting = jobs.filter((j) => j.codebaseId === cb.id && (j.status === 'ready' || j.status === 'queued')).length;
  if (waiting >= IDEAS_MAX_WAITING) {
    return `${waiting} updates for ${cb.name} are still waiting for you (ready or queued). Apply or discard some first.`;
  }
  // Claude already said its limit is used up: asking again would only fail again and add another error to the log.
  if (providerUnavailable('anthropic')) {
    return 'Claude has used up its limit for now, so idea finding waits. It starts again by itself once the limit resets.';
  }
  const sinceStart = Date.now() - HUB_STARTED_AT;
  if (sinceStart < IDEAS_QUIET_AFTER_START_MS) {
    const mins = Math.max(1, Math.ceil((IDEAS_QUIET_AFTER_START_MS - sinceStart) / 60_000));
    return `The hub just started. Idea finding waits about ${mins} more ${mins === 1 ? 'minute' : 'minutes'}.`;
  }
  return undefined;
}

// Starts looking for ideas in the background. Returns why it was skipped (nothing started), or undefined
// when it started or is already running.
function generateIdeas(cb: Codebase, force = false): string | undefined {
  if (ideaSet(cb.id).running) return undefined;
  if (!force) {
    const skip = ideasSkipReason(cb);
    if (skip) {
      // The page asks again every time it opens, so keep the log from repeating the same line.
      if (Date.now() - (lastSkipLogged[cb.id] || 0) > 10 * 60 * 1000) {
        lastSkipLogged[cb.id] = Date.now();
        logActivity('info', `Skipped looking for update ideas for ${cb.name}: ${skip}`);
      }
      return skip;
    }
  }
  runIdeas(cb);
  return undefined;
}

async function runIdeas(cb: Codebase) {
  const set = ideaSet(cb.id);
  if (set.running) return;
  set.running = true;
  set.error = undefined;
  saveIdeas();
  logActivity('work', `Looking for update ideas for ${cb.name}…`);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--permission-mode', 'default', '--tools', 'Read,Glob,Grep', '--model', 'claude-sonnet-5-5'];
      const child = spawn(['claude', ...args].join(' '), { cwd: cb.dir, shell: true, windowsHide: true, env: planClaudeEnv() });
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
    const fresh = (JSON.parse(json) as any[])
      .filter((i) => i && i.title && i.request)
      .slice(0, 6)
      .map((i) => ({
        title: String(i.title).slice(0, 80),
        why: String(i.why || '').slice(0, 300),
        request: String(i.request).slice(0, 2000),
        size: (['small', 'medium', 'large'].includes(i.size) ? i.size : 'medium') as Idea['size'],
      }));
    if (!fresh.length) throw new Error('No ideas came back. Try again.');
    // Drop ideas that repeat an update we already have (ready, applied, discarded, failed...), that are
    // already being suggested right now, or that repeat another idea in this batch.
    const current = set.ideas.filter((i) => !!ideaKey(i.request));
    const seen = new Set<string>(current.map((i) => ideaKey(i.request)));
    const seenTitles = new Set<string>(current.map((i) => ideaKey(i.title)));
    const ideas: Idea[] = [];
    for (const idea of fresh) {
      const key = ideaKey(idea.request);
      const titleKey = ideaKey(idea.title);
      const existing = findSameUpdate(cb.id, idea.request);
      if (existing || seen.has(key) || seenTitles.has(titleKey)) {
        logActivity('work', `Skipped a repeat update idea for ${cb.name}: "${idea.title}" (${existing ? `already ${existing.status}` : 'already suggested'}).`);
        continue;
      }
      seen.add(key);
      seenTitles.add(titleKey);
      ideas.push(idea);
    }
    // Ideas already on show stay as they are; only genuinely new ones are added.
    if (!ideas.length && !current.length) throw new Error('Every idea that came back was already done or tried. Try again later.');
    set.ideas = [...current, ...ideas].slice(0, 8);
    set.at = new Date().toISOString();
    logActivity('done', ideas.length ? `${ideas.length} new update ${ideas.length === 1 ? 'idea' : 'ideas'} ready for ${cb.name} (Code updates).` : `No new update ideas for ${cb.name}: everything that came back was already suggested.`);
  } catch (err: any) {
    const raw = String(err?.message || 'Something went wrong.');
    // A used-up plan limit isn't a fault in the hub: say what to do instead of showing Claude's raw message.
    const limitHit = USAGE_LIMIT_ERROR.test(raw);
    // Remember it, so the hub stops asking Claude (and stops adding the same line to the log) until the limit resets.
    if (limitHit) recordFailure('anthropic', raw);
    const message = limitHit
      ? `Claude's usage limit is used up (${raw.replace(/\s+/g, ' ').slice(0, 120)}). Nothing is broken and there is nothing to fix: wait until it resets, then press "Find ideas" again, or connect another AI in Account → Connections.`
      : raw;
    set.error = message;
    // Not an error in the log when it's only a limit: it clears by itself.
    logActivity(limitHit ? 'info' : 'error', `Couldn't get update ideas for ${cb.name}: ${message}`);
  } finally {
    set.running = false;
    saveIdeas();
  }
}

function registerIdeaRoutes(app: Express, guard: (req: Request) => string) {
  app.get('/api/updates/ideas', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
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
    // "Find ideas anyway" sends force: true to skip the waiting-updates and just-started checks.
    const skipped = generateIdeas(cb, req.body?.force === true);
    res.json(skipped ? { ok: true, skipped } : { ok: true });
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
    // Don't queue the same idea twice while a copy is still waiting, running or ready to apply.
    const same = findSameUpdate(codebaseId, idea.request, SAME_IDEA_BUSY);
    if (same) {
      set.ideas = set.ideas.filter((i) => i !== idea);
      saveIdeas();
      logActivity('work', `Skipped a repeat update idea: "${idea.title}" (an update for it is already ${same.status}).`);
      return res.status(409).json({ error: `That idea is already in your updates (${same.status}), so it was not added again.` });
    }
    try {
      const id = requestCodeUpdate(codebaseId, idea.request);
      set.ideas = set.ideas.filter((i) => i !== idea);
      saveIdeas();
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}

export const __codeUpdatesTest = { makeCopy, removeCopy, readChange, runCheck, runTests, findCodebase, repoRoot };
