// Code updates: the AI changes code safely, in the hub itself or in another codebase (such as LYRA).
//
//   1. You describe the change. The hub makes a separate copy of that codebase (a git worktree outside
//      it, including your uncommitted work), so the running app is never touched while the AI works.
//   2. An AI edits that copy: Claude Code first; if it can't (out of usage, stopped, changed nothing), Codex,
//      then Gemini (see codeAgents.ts). They may only change files in the copy.
//   3. The hub runs that codebase's checks on the copy and shows you every changed line.
//   4. Only when you press Apply is the change copied into the real folder. Undo reverses it.
//   One update runs at a time; any others asked for meanwhile wait in a queue and start by themselves.
//   If the AI finds the code already does it, the update is closed as "Already done"; if it can't tell what is
//   meant, it asks, and the owner's answer starts it again. "Fix all failed" redoes every failed request as ONE
//   combined update, reviewed by a second AI (see processBundle).
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
import { AGENT_NAMES, USAGE_LIMIT_ERROR, agentChain, agentStatus, cliPath, noteAgentFailure, runAgent, type AgentId } from './codeAgents';
import { pcBusy, onBusyChange } from './busy';
import { isOffline, onOfflineChange } from './offline';
import { localAgentModel, planClaudeEnv } from './localClaude';
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

function loadCodebases(): Codebase[] {
  let extra: Codebase[] = [];
  try {
    extra = JSON.parse(fs.readFileSync(CODEBASES_FILE, 'utf-8'));
  } catch (err: any) {
    fileProblem('load your saved codebases', err);
  }
  const list = [HUB, ...extra.filter((c) => c.id !== 'hub')];
  if (!list.some((c) => c.id === 'lyra') && fs.existsSync(path.join(LYRA_DIR, 'server.js'))) list.push(lyraPreset());
  return list;
}
let codebases = loadCodebases();
const saveCodebases = () => {
  try {
    fs.writeFileSync(CODEBASES_FILE, JSON.stringify(codebases.filter((c) => c.id !== 'hub'), null, 2), 'utf-8');
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

// unneeded: the AI found the code already does this (closed, nothing to apply).
// question: the AI couldn't tell what is wanted; the owner's answer starts it again (see /answer).
type Status = 'queued' | 'working' | 'checking' | 'ready' | 'applied' | 'undone' | 'discarded' | 'failed' | 'unneeded' | 'question';

// One request inside a "Fix all failed" combined update.
export interface BundleItem {
  key: string; // the request, tidied, so retries of the same request count as one
  request: string;
  sourceIds: string[]; // the earlier updates this request comes from
  state: 'waiting' | 'working' | 'done' | 'dropped' | 'unneeded' | 'question';
  agent?: AgentId; // which AI made it
  files?: string[];
  reason?: string; // why it was left out, or what the AI asked
}

interface UpdateJob {
  id: string;
  codebaseId: string;
  request: string;
  cardId?: string; // when it was asked for from a project card
  local?: boolean; // run Claude Code on a model on this PC (Ollama) instead of your Claude plan
  localModel?: string; // the model it ran on
  agent?: AgentId; // which AI made the change (Claude, Codex, Gemini or the AI on this PC)
  question?: string; // status 'question': what the AI asked the owner
  bundle?: { items: BundleItem[]; review?: { agent: AgentId; state: 'working' | 'done' | 'skipped'; note?: string } };
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
  // Saved just before Apply, so Undo can put the files back exactly as they were.
  restore?: { ref: string; commit: string; files: string[]; backup?: string; at: string };
}

let jobs: UpdateJob[] = [];
try {
  jobs = JSON.parse(fs.readFileSync(STORE, 'utf-8'));
} catch (err: any) {
  fileProblem('load your saved code updates', err);
}

const save = () => {
  try {
    fs.writeFileSync(STORE, JSON.stringify(jobs.slice(-50), null, 2), 'utf-8');
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
  if (j.bundle) for (const it of j.bundle.items) if (it.state === 'working' || it.state === 'done' || it.state === 'dropped') Object.assign(it, { state: 'waiting', agent: undefined, files: undefined, reason: undefined });
  if (j.bundle) delete j.bundle.review;
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

// The real folder's path is never given to the AI: it works in the copy, and a path to the original tempts it
// to edit there (Codex did exactly that in testing).
const RULES = (cb: Codebase, agent: AgentId = 'claude') => `You are improving ${cb.about.split(cb.dir).join('the code in this folder')}
Make the change the owner asks for below, carefully and completely.
Rules:
- Only edit files inside this folder. Never touch: ${cb.protect.join(', ')}.
- Follow the existing code style. Keep wording plain for a non-technical owner.
- Keep it working: if you change something shared, update every place that uses it.
- ${agent === 'codex' ? 'Only run commands that read files (to look around). Do not install anything, build, or use the network;' : 'You cannot run commands;'} the hub runs the checks after you finish.
- If the code already does what is asked, change nothing and say so, starting with "Already done:".
- If you cannot tell what the owner wants, change nothing and ask one short question, starting with "Question:".
- Finish with a short summary in plain language: what you changed, which files, and anything the owner should check.`;

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

// When the AI changed nothing, what it said decides what happens next:
//   question - it couldn't tell what is wanted: the owner is asked (the AI's words are the question)
//   already  - it found the code already does this: the update is closed as "Already done", not as a failure
export function readNoChange(said?: string): 'question' | 'already' | null {
  const t = (said || '').trim();
  if (!t) return null;
  // The AIs are told to start with these words (see RULES).
  if (/^[\s*_#>"']*question\s*:/i.test(t)) return 'question';
  if (/^[\s*_#>"']*already done\s*:/i.test(t)) return 'already';
  if (/(can'?t|couldn'?t|could not|cannot|unable to|wasn'?t able to)\s+(tell|work out|figure out|understand|find what|see what|determine)|not sure what|unclear|doesn'?t say (which|what)|does not say (which|what)|which (screen|errors?|one|page|part|button|section)s? (you|it|this)|what (do|did) you mean|please (clarify|tell me|say|describe)|could you (clarify|tell me|say)/i.test(t)) return 'question';
  if (/\balready\b|no changes? (is |are |were )?(needed|required)|nothing (needed|needs|to change)|(is|are) (already )?in place|does(n'?t| not) need (any )?chang/i.test(t)) return 'already';
  return null;
}

// Runs one AI on the copy. Its progress goes into the update's log, its last words into lastAiMessage.
async function runOne(agent: AgentId, cb: Codebase, job: UpdateJob, appDir: string, request: string): Promise<string> {
  job.agent = agent;
  if (agent === 'local') job.localModel = localAgentModel() || undefined;
  job.lastAiMessage = undefined; // a fresh run starts without the old message
  save();
  const before = realFolderPrint(cb);
  try {
    return await runAgent(agent, {
    cwd: appDir,
    prompt: `${RULES(cb, agent)}\n- Your working folder is ${appDir}. Make every edit there, using paths inside it. Never edit files anywhere else.\n\nThe owner's request:\n${request}`,
    timeoutMs: TIMEOUT_MS,
    log: (line) => {
      job.log.push(line);
      if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
      save();
    },
    said: (text) => {
      job.lastAiMessage = text.length > 400 ? `${text.slice(0, 400).trim()}…` : text;
      save();
    },
  });
  } finally {
    // Safety net: the AI may only change the copy. If the real folder changed while it worked, say so loudly.
    const after = realFolderPrint(cb);
    if (before !== null && after !== null && before !== after) {
      const files = changedRealFiles(cb);
      job.log.push(`Warning: files in the real ${cb.name} folder changed while ${AGENT_NAMES[agent]} was working: ${files || 'see git status'}`);
      logActivity('error', `While ${AGENT_NAMES[agent]} worked on a code update, files in the real ${cb.name} folder changed (${files || 'see git status'}). If you didn't edit them yourself, check them in git before going on.`);
      save();
    }
  }
}

// A fingerprint of the real codebase folder's uncommitted state (which files differ, and the whole difference),
// to notice edits made outside the copy. null when git can't tell.
function realFolderPrint(cb: Codebase): string | null {
  try {
    const root = repoRoot(cb);
    const spec = pathspec(relOf(cb));
    return git(['status', '--porcelain', '--untracked-files=all', ...spec], root) + git(['diff', 'HEAD', ...spec], root);
  } catch {
    return null;
  }
}
function changedRealFiles(cb: Codebase): string {
  try {
    return git(['status', '--porcelain', ...pathspec(relOf(cb))], repoRoot(cb))
      .split('\n')
      .filter(Boolean)
      .slice(0, 8)
      .map((l) => l.slice(3))
      .join(', ');
  } catch {
    return '';
  }
}

type Attempt = { result: 'changed'; agent: AgentId } | { result: 'question' | 'already'; agent: AgentId; said: string } | { result: 'failed'; reason: string };

// Tries the AIs in turn (Claude, then Codex, then Gemini) until one makes the change. An AI that errors (out of
// usage, not reachable) or edits nothing without saying why hands over to the next one. One that says the code
// already does it, or asks what is meant, ends the run: another AI would only say the same.
// `changed()` reads what is different in the copy now; `skip` leaves an AI out (for a second opinion).
async function attemptChange(cb: Codebase, job: UpdateJob, appDir: string, request: string, changed: () => boolean, opts: { skip?: AgentId[]; reset?: () => void } = {}): Promise<Attempt> {
  const chain = agentChain(job.local).filter((a) => !opts.skip?.includes(a));
  if (!chain.length) return { result: 'failed', reason: noAgentMessage() };
  const reasons: string[] = [];
  for (const [i, agent] of chain.entries()) {
    const next = chain[i + 1];
    job.log.push(`${AGENT_NAMES[agent]} is working on the copy`);
    try {
      job.summary = await runOne(agent, cb, job, appDir, request);
      if (!changed() && looksLikeAcknowledgement(job.lastAiMessage)) {
        // The AI only said "Understood" or made a plan: ask once more, telling it to edit the files this time.
        job.log.push(`${AGENT_NAMES[agent]} replied without changing anything, so it is asked once more to make the change`);
        job.summary = await runOne(agent, cb, job, appDir, `${request}\n\n${MAKE_CHANGE_NOW}`);
      }
      if (changed()) return { result: 'changed', agent };
      const kind = readNoChange(job.lastAiMessage);
      if (kind) return { result: kind, agent, said: job.lastAiMessage || '' };
      reasons.push(`${AGENT_NAMES[agent]} changed nothing`);
      if (next) job.log.push(`${AGENT_NAMES[agent]} changed nothing, so ${AGENT_NAMES[next]} tries`);
    } catch (err: any) {
      const message = String(err?.message || err);
      noteAgentFailure(agent, message);
      // Anything it half-wrote before stopping is put back, so the next AI starts clean.
      try {
        opts.reset?.();
      } catch {}
      const why = USAGE_LIMIT_ERROR.test(message) ? 'is out of usage for now' : `stopped (${message.slice(0, 160)})`;
      reasons.push(`${AGENT_NAMES[agent]} ${why}`);
      if (next) {
        job.log.push(`${AGENT_NAMES[agent]} ${why}, so ${AGENT_NAMES[next]} takes over`);
        logActivity('info', `${AGENT_NAMES[agent]} ${why} during a code update, so ${AGENT_NAMES[next]} is taking over.`);
      }
    }
    save();
  }
  return { result: 'failed', reason: reasons.length === 1 && reasons[0].endsWith('changed nothing') ? `${NO_CHANGE_MESSAGE}${job.lastAiMessage ? ` It said: "${job.lastAiMessage}"` : ''}` : `No AI could make this change: ${reasons.join('; ')}.` };
}

function noAgentMessage(): string {
  const why = agentStatus()
    .map((a) => `${a.name}: ${a.ok ? 'ready' : a.why}`)
    .join('; ');
  return `No AI can do code updates right now (${why}). Sign in to Claude in Account → Connections, or run "codex login" once on the PC.`;
}

function readChange(cb: Codebase, job: UpdateJob, dir: string, base = 'HEAD') {
  const rel = relOf(cb);
  git(['add', '-A', ...pathspec(rel)], dir);
  job.diff = git(['diff', '--cached', '--binary', base, ...pathspec(rel)], dir);
  const stat = git(['diff', '--cached', '--numstat', base, ...pathspec(rel)], dir);
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
      const baseline = { failed: baselineFailed, types: baselineTypeProblems };
      if (job.bundle) await processBundle(cb, job, copy, baseline);
      else await processSingle(cb, job, copy, baseline);
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

type Copy = { dir: string; appDir: string };
type Baseline = { failed: string[]; types: string[] };

// What is different in the copy from `base` right now (staged, so new files count too).
function changedFiles(cb: Codebase, dir: string, base = 'HEAD'): string[] {
  const rel = relOf(cb);
  git(['add', '-A', ...pathspec(rel)], dir);
  return git(['diff', '--cached', '--name-only', base, ...pathspec(rel)], dir).split('\n').filter(Boolean);
}

// The AI said the code already does it, or asked what is meant: neither is a failure.
function closeWithoutChange(cb: Codebase, job: UpdateJob, a: { result: 'question' | 'already'; agent: AgentId; said: string }) {
  const said = a.said.replace(/^\s*(already done|question)\s*:\s*/i, '').trim();
  if (a.result === 'already') {
    job.status = 'unneeded';
    job.summary = said;
    logActivity('info', `Code update not needed (${cb.name}): ${AGENT_NAMES[a.agent]} found the code already does this. ${job.request.slice(0, 80)}`);
  } else {
    job.status = 'question';
    job.question = said;
    logActivity('info', `Code update needs your answer (${cb.name}): ${said.slice(0, 160)}`);
  }
}

async function processSingle(cb: Codebase, job: UpdateJob, copy: Copy, baseline: Baseline) {
  const a = await attemptChange(cb, job, copy.appDir, job.request, () => changedFiles(cb, copy.dir).length > 0, { reset: () => resetTo(cb, copy.dir, 'HEAD') });
  if (a.result === 'failed') throw new Error(a.reason);
  if (a.result !== 'changed') return closeWithoutChange(cb, job, a);
  readChange(cb, job, copy.dir);
  job.status = 'checking';
  job.log.push(cb.check === 'tsc' ? 'Running the type check' : 'Checking the code and running the tests');
  save();
  job.check = await runCheck(cb, copy.appDir, job.files!.map((f) => f.path), baseline.failed, baseline.types);
  job.status = 'ready';
  const fileCount = `${job.files!.length} file${job.files!.length === 1 ? '' : 's'}`;
  if (job.check.ok) {
    logActivity('done', `Code update ready for review (${cb.name}, ${fileCount}, by ${AGENT_NAMES[a.agent]}).`);
  } else {
    // Say what the check found and what to do, not only that it failed.
    const firstProblem = job.check.output.split('\n').map((l) => l.trim()).find((l) => /error|fail|broke|syntax/i.test(l)) || '';
    logActivity('error', `Code update ready for review (${cb.name}, ${fileCount}) but its checks failed${firstProblem ? ` (${firstProblem.slice(0, 160)})` : ''}. Open it and press "Ask the AI to fix it", or discard it.`, { reason: job.check.output.slice(-500), retry: { kind: 'update', id: job.id } });
  }
}

// ---- Fix all failed: one combined update -----------------------------------------------------------
// Every request that never got applied is redone, one after another, in ONE copy of the code, so each part
// builds on the ones before it. Each part goes through the AIs in turn and must pass the checks to stay in;
// a part that can't be made to pass is taken out again (its files put back) and listed with the reason.
// Then a different AI reviews the whole combined change and fixes what it finds. The owner gets one update
// to look at and Apply (and Undo, which reverses all of it).

const commitStep = (cb: Codebase, dir: string, message: string) => {
  git(['add', '-A', ...pathspec(relOf(cb))], dir);
  git(['-c', 'user.name=Eden Hub', '-c', 'user.email=eden-hub@localhost', 'commit', '--no-verify', '-q', '--allow-empty', '-m', message], dir);
};
// Puts the copy back exactly as it was at `commit` (the shared-packages link is left alone).
const resetTo = (cb: Codebase, dir: string, commit: string) => {
  git(['reset', '-q', '--hard', commit], dir);
  git(['clean', '-fdq', '-e', 'node_modules', ...pathspec(relOf(cb))], dir);
};
const headOf = (dir: string) => git(['rev-parse', 'HEAD'], dir).trim();
const firstProblem = (output: string) => output.split('\n').map((l) => l.trim()).find((l) => /^- |error|fail|broke|syntax/i.test(l))?.replace(/^- /, '') || 'its checks failed';

async function processBundle(cb: Codebase, job: UpdateJob, copy: Copy, baseline: Baseline) {
  const bundle = job.bundle!;
  const start = headOf(copy.dir);
  const total = bundle.items.length;
  for (const [i, item] of bundle.items.entries()) {
    if (item.state !== 'waiting') continue;
    item.state = 'working';
    job.log.push(`Part ${i + 1} of ${total}: ${item.request.slice(0, 90)}`);
    save();
    const before = headOf(copy.dir);
    const context = `${item.request}\n\n(This is part ${i + 1} of ${total} of one combined update. Earlier parts are already in the code: keep them working.)`;
    const tried: AgentId[] = [];
    let reason = '';
    // Each AI gets one go plus one fix-up round for failed checks; a part that still fails goes to the next AI.
    while (item.state === 'working') {
      const a = await attemptChange(cb, job, copy.appDir, context, () => changedFiles(cb, copy.dir).length > 0, { skip: tried, reset: () => resetTo(cb, copy.dir, before) });
      if (a.result === 'failed') {
        resetTo(cb, copy.dir, before);
        item.state = 'dropped';
        item.reason = reason || a.reason;
        break;
      }
      if (a.result !== 'changed') {
        resetTo(cb, copy.dir, before);
        item.state = a.result === 'already' ? 'unneeded' : 'question';
        item.agent = a.agent;
        item.reason = a.said.replace(/^\s*(already done|question)\s*:\s*/i, '').trim();
        break;
      }
      tried.push(a.agent);
      let files = changedFiles(cb, copy.dir, before);
      job.log.push(`Checking part ${i + 1}`);
      save();
      let check = await runCheck(cb, copy.appDir, files, baseline.failed, baseline.types);
      if (!check.ok) {
        job.log.push(`Part ${i + 1} failed its checks, so ${AGENT_NAMES[a.agent]} is asked to fix it`);
        save();
        try {
          await runOne(a.agent, cb, job, copy.appDir, `${context}\n\nYour change for this failed the checks. Fix the problems below, keeping the change:\n${check.output.slice(-3000)}`);
        } catch (err: any) {
          noteAgentFailure(a.agent, String(err?.message || err));
        }
        files = changedFiles(cb, copy.dir, before);
        check = await runCheck(cb, copy.appDir, files, baseline.failed, baseline.types);
      }
      if (check.ok) {
        commitStep(cb, copy.dir, `Part ${i + 1}: ${item.request.slice(0, 60)}`);
        item.state = 'done';
        item.agent = a.agent;
        item.files = files;
        job.log.push(`Part ${i + 1} done by ${AGENT_NAMES[a.agent]} (${files.length} file${files.length === 1 ? '' : 's'})`);
      } else {
        reason = `${AGENT_NAMES[a.agent]}'s change failed the checks: ${firstProblem(check.output)}`;
        job.log.push(`Part ${i + 1}: ${reason}. Taking it out again`);
        resetTo(cb, copy.dir, before);
      }
      save();
    }
  }

  const done = bundle.items.filter((it) => it.state === 'done');
  if (!done.length) {
    const why = bundle.items.map((it) => `"${it.request.slice(0, 50)}": ${it.state === 'unneeded' ? 'already done' : it.state === 'question' ? 'needs your answer' : it.reason}`).join('; ');
    if (bundle.items.every((it) => it.state === 'unneeded' || it.state === 'question')) {
      job.status = 'unneeded';
      job.summary = `Nothing to change: ${why}`;
      return;
    }
    throw new Error(`None of the ${total} could be done. ${why}`);
  }

  // Review: a different AI from the one that wrote most of it, so it sees the work with fresh eyes.
  const authors = done.map((it) => it.agent!);
  const main = authors.sort((x, y) => authors.filter((a) => a === y).length - authors.filter((a) => a === x).length)[0];
  const chain = agentChain(job.local);
  const reviewer = chain.find((a) => a !== main) || chain[0];
  if (reviewer) {
    bundle.review = { agent: reviewer, state: 'working' };
    job.log.push(`${AGENT_NAMES[reviewer]} is reviewing the combined change`);
    save();
    const before = headOf(copy.dir);
    const combined = git(['diff', start, 'HEAD', ...pathspec(relOf(cb))], copy.dir);
    const prompt = `Review this combined update. It does these things:\n${done.map((it, n) => `${n + 1}. ${it.request}`).join('\n')}\n\nThe whole change (a git diff against the code before it):\n${combined.length > 60000 ? `${combined.slice(0, 60000)}\n…(cut short; read the files for the rest)` : combined}\n\nLook for bugs, parts that clash with each other, and anything left half-done. Fix real problems by editing the files. Do not rewrite working code or add new features. If you find nothing to fix, change nothing and say "No problems found".`;
    try {
      await runOne(reviewer, cb, job, copy.appDir, prompt);
      const files = changedFiles(cb, copy.dir, before);
      if (!files.length) {
        bundle.review = { agent: reviewer, state: 'done', note: job.lastAiMessage || 'No problems found.' };
      } else {
        const check = await runCheck(cb, copy.appDir, files, baseline.failed, baseline.types);
        if (check.ok) {
          commitStep(cb, copy.dir, 'Review fixes');
          bundle.review = { agent: reviewer, state: 'done', note: `Fixed ${files.length} file${files.length === 1 ? '' : 's'}. ${job.lastAiMessage || ''}`.trim() };
        } else {
          resetTo(cb, copy.dir, before);
          bundle.review = { agent: reviewer, state: 'skipped', note: `Its fixes failed the checks (${firstProblem(check.output)}), so they were left out.` };
        }
      }
    } catch (err: any) {
      noteAgentFailure(reviewer, String(err?.message || err));
      resetTo(cb, copy.dir, before);
      bundle.review = { agent: reviewer, state: 'skipped', note: `The review could not run: ${String(err?.message || err).slice(0, 200)}` };
    }
    job.log.push(`Review: ${bundle.review.note?.slice(0, 160)}`);
    save();
  }

  // The result: one change from where the copy started, checked as a whole.
  readChange(cb, job, copy.dir, start);
  job.status = 'checking';
  job.log.push(cb.check === 'tsc' ? 'Running the type check on the combined change' : 'Checking the combined change');
  save();
  job.check = await runCheck(cb, copy.appDir, job.files!.map((f) => f.path), baseline.failed, baseline.types);
  job.status = 'ready';
  const skipped = bundle.items.filter((it) => it.state !== 'done');
  job.summary = [
    `Combined update with ${done.length} of ${total} request${total === 1 ? '' : 's'}:`,
    ...done.map((it) => `- ${it.request.slice(0, 120)} (by ${AGENT_NAMES[it.agent!]})`),
    ...(skipped.length ? ['', 'Left out:', ...skipped.map((it) => `- ${it.request.slice(0, 120)}: ${it.state === 'unneeded' ? 'already done' : it.state === 'question' ? `needs your answer (${it.reason})` : it.reason}`)] : []),
    ...(bundle.review ? ['', `Review by ${AGENT_NAMES[bundle.review.agent]}: ${bundle.review.note}`] : []),
  ].join('\n');
  logActivity(job.check.ok ? 'done' : 'error', `Fix all failed: combined update ready for review (${done.length} of ${total} done${skipped.length ? `, ${skipped.length} left out` : ''})${job.check.ok ? '' : ', but its final check failed'}.`);
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
let lastBackup: BackupInfo | null = null;
try {
  lastBackup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
} catch (err: any) {
  fileProblem('load the last backup details', err);
}
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
  if (!local && !isOffline() && !agentChain().length) throw new Error(noAgentMessage());
  // If another update is running, this one waits in the queue.
  const job: UpdateJob = { id: `upd-${Date.now().toString(36)}`, codebaseId: cb.id, request, cardId, local: local || undefined, status: 'queued', createdAt: now(), log: [] };
  job.uncommitted = countUncommitted(cb); // shown right away; refreshed when the copy is actually made
  jobs.push(job);
  if (busy) logActivity('work', `Code update queued (${cb.name}): ${request.slice(0, 100)}`);
  save();
  startNext();
  return job.id;
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

// ---- Collecting what failed ------------------------------------------------------------------------
// The same request can fail several times ("Try again" makes a fresh update each time, with notes added under
// it). Retries are grouped back into one request by their text, and a request counts as settled once any
// update for it was applied, is ready or running, was found already done, or is part of a combined update.

const ANSWER_HEADER = '\n\nThe owner answered your question';
const baseRequest = (r: string) => r.split('\n\nLast time this failed:')[0].split(ANSWER_HEADER)[0].trim();
const requestKey = (r: string) => baseRequest(r).toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
const withAnswer = (request: string, question: string, answer: string) => `${baseRequest(request)}${ANSWER_HEADER} ("${question.slice(0, 300)}"): ${answer.slice(0, 1500)}`;
// A failure where the AI wrote nothing: what it said is the reason (it may be "already done" or a question).
const saidNothingChanged = (j: UpdateJob) => /without changing anything|did not make any change/i.test(j.error || '');

export interface FailedGroup {
  key: string;
  request: string;
  ids: string[]; // every update for this request, oldest first
  attempts: number;
  lastError?: string;
  said?: string; // already done: what the AI said; question: what it asked
}

export function collectFailed(codebaseId = 'hub'): { retry: FailedGroup[]; already: FailedGroup[]; questions: FailedGroup[] } {
  const mine = jobs.filter((j) => j.codebaseId === codebaseId && !j.bundle);
  const settled = new Set<string>();
  for (const j of mine) if (['queued', 'working', 'checking', 'ready', 'applied', 'unneeded'].includes(j.status)) settled.add(requestKey(j.request));
  for (const b of jobs.filter((j) => j.bundle && j.codebaseId === codebaseId && ['queued', 'working', 'checking', 'ready', 'applied'].includes(j.status))) {
    for (const it of b.bundle!.items) if (it.state === 'waiting' || it.state === 'working' || it.state === 'done') settled.add(it.key);
  }
  const groups = new Map<string, UpdateJob[]>();
  for (const j of mine) {
    // Discarded by the owner without an error (an update they looked at and didn't want) isn't a failure.
    const failedLike = j.status === 'failed' || j.status === 'question' || (j.status === 'discarded' && (!!j.error || !!j.retriedAs));
    const k = requestKey(j.request);
    if (!failedLike || !k || settled.has(k)) continue;
    groups.set(k, [...(groups.get(k) || []), j]);
  }
  const out = { retry: [] as FailedGroup[], already: [] as FailedGroup[], questions: [] as FailedGroup[] };
  for (const [key, list] of groups) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = list[list.length - 1];
    const g: FailedGroup = { key, request: baseRequest(last.request), ids: list.map((j) => j.id), attempts: list.length, lastError: last.error };
    const kind = last.status === 'question' ? 'question' : saidNothingChanged(last) ? readNoChange(last.lastAiMessage) : null;
    if (kind === 'question') out.questions.push({ ...g, said: last.question || last.lastAiMessage });
    else if (kind === 'already') out.already.push({ ...g, said: last.lastAiMessage });
    else out.retry.push(g);
  }
  return out;
}

// Puts the old updates of a request out of the Error list, pointing at what took their place.
function settleSources(ids: string[], status: Status, by?: string, summary?: string) {
  for (const id of ids) {
    const j = jobs.find((x) => x.id === id);
    if (!j || !['failed', 'discarded', 'question'].includes(j.status)) continue;
    j.status = status;
    if (by) j.retriedAs = by;
    if (summary) j.summary = summary;
  }
}

export function startBundle(codebaseId: string, items: BundleItem[], sourceIds: string[]): string {
  const cb = findCodebase(codebaseId);
  if (!cb) throw new Error('That codebase is not set up in the hub.');
  if (!agentChain().length) throw new Error(noAgentMessage());
  const id = `upd-${Date.now().toString(36)}`;
  const job: UpdateJob = {
    id,
    codebaseId: cb.id,
    request: `Fix all failed: redo ${items.length} request${items.length === 1 ? '' : 's'} as one update`,
    status: 'queued',
    createdAt: now(),
    log: [],
    bundle: { items },
  };
  job.uncommitted = countUncommitted(cb);
  jobs.push(job);
  settleSources(sourceIds, 'discarded', id);
  logActivity('work', `Fix all failed: ${items.length} request${items.length === 1 ? '' : 's'} queued as one combined update (${cb.name}).`);
  save();
  startNext();
  return id;
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
      agents: agentStatus(), // which AIs can do updates right now (Claude, Codex, Gemini), in the order they are tried
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

  // Fix all failed, step 1: what would happen. Requests the AI found already done are closed, ones where it
  // asked a question wait for the owner's answer, and the rest are redone together as one update.
  app.get('/api/updates/fix-all', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    const codebaseId = String(req.query.codebaseId || 'hub');
    res.json({ ...collectFailed(codebaseId), agents: agentStatus(), chain: agentChain().map((a) => AGENT_NAMES[a]) });
  });

  // Fix all failed, step 2: go. `answers`: { [key]: answer } for the questions; `skip`: keys to leave out.
  app.post('/api/updates/fix-all', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const codebaseId = String(req.body?.codebaseId || 'hub');
    const answers: Record<string, string> = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const skip = new Set<string>(Array.isArray(req.body?.skip) ? req.body.skip.map(String) : []);
    const found = collectFailed(codebaseId);
    // Already done: closed now, so they leave the Error list.
    for (const g of found.already) settleSources(g.ids, 'unneeded', undefined, `Already done: ${g.said || 'the AI found the code already does this.'}`);
    const items: BundleItem[] = [];
    const sources: string[] = [];
    for (const g of found.retry) {
      if (skip.has(g.key)) continue;
      items.push({ key: g.key, request: g.request, sourceIds: g.ids, state: 'waiting' });
      sources.push(...g.ids);
    }
    let unanswered = 0;
    for (const g of found.questions) {
      const answer = typeof answers[g.key] === 'string' ? answers[g.key].trim() : '';
      if (!answer || skip.has(g.key)) {
        unanswered++;
        continue;
      }
      items.push({ key: g.key, request: withAnswer(g.request, g.said || '', answer), sourceIds: g.ids, state: 'waiting' });
      sources.push(...g.ids);
    }
    save();
    if (!items.length) return res.json({ ok: true, closed: found.already.length, unanswered, started: 0 });
    try {
      const id = startBundle(codebaseId, items, sources);
      res.json({ ok: true, job: { id }, closed: found.already.length, unanswered, started: items.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // The AI asked what was meant: the owner's answer starts the update again with the answer added.
  app.post('/api/updates/:id/answer', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job || job.status !== 'question') return res.status(400).json({ error: 'That update is not waiting for an answer.' });
    const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
    if (!answer) return res.status(400).json({ error: 'Write your answer first.' });
    try {
      const id = requestCodeUpdate(job.codebaseId, withAnswer(job.request, job.question || '', answer), job.cardId, job.local === true);
      const fresh = jobs.find((j) => j.id === id);
      if (fresh) fresh.retryOf = job.id;
      job.retriedAs = id;
      job.status = 'discarded';
      save();
      res.json({ job: { id } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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
    if (job.bundle) {
      // A combined update is redone part by part on the current code, as a new combined update.
      try {
        const items = job.bundle.items.map((it) => ({ key: it.key, request: it.request, sourceIds: it.sourceIds, state: 'waiting' as const }));
        const id = startBundle(job.codebaseId, items, []);
        job.retriedAs = id;
        job.status = 'discarded';
        save();
        return res.json({ job: { id } });
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }
    }
    try {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 3000) : '';
      // The note always fits: the request is shortened to make room for it, never the other way round.
      const header = '\n\nLast time this failed:\n';
      const base = job.request.split(header.trimEnd())[0].trimEnd();
      const request = note ? `${base.slice(0, Math.max(500, 4000 - header.length - note.length))}${header}${note}`.slice(0, 4000 + 3000) : job.request;
      const local = req.body?.useClaude === true ? false : job.local === true;
      const id = requestCodeUpdate(job.codebaseId, request, job.cardId, local);
      const fresh = jobs.find((j) => j.id === id);
      if (fresh) fresh.retryOf = job.id;
      job.retriedAs = id;
      job.status = 'discarded'; // only after the new one has started, so a refused retry keeps the old one
      delete job.stale;
      delete job.olderBase;
      delete job.olderBaseSameFiles;
      save();
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
let ideaSets: Record<string, IdeaSet> = {};
try {
  ideaSets = JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf-8'));
  for (const s of Object.values(ideaSets)) s.running = false;
} catch (err: any) {
  fileProblem('load your saved update ideas', err);
}
const saveIdeas = () => {
  try {
    fs.writeFileSync(IDEAS_FILE, JSON.stringify(ideaSets, null, 2), 'utf-8');
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
      const child = spawn([cliPath('claude'), ...args].join(' '), { cwd: cb.dir, shell: true, windowsHide: true, env: planClaudeEnv() });
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
