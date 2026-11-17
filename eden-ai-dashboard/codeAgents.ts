// The coding AIs that can make code updates, tried in order when one can't:
//   Claude Code (your Claude plan) -> Codex (your ChatGPT plan) -> Gemini CLI (your Gemini key).
// Each one edits the update's separate copy of the code (never the real folder); the hub checks the result.
// An AI on this PC (Ollama) is only used when you ask for it or the internet is down: small local models
// can't drive the file tools well enough for code changes, so they are not used as an automatic fallback.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cliSignedIn, providerUnavailable, recordFailure } from './providers';
import { localAgentModel, localClaudeEnv, planClaudeEnv } from './localClaude';
import { isOffline } from './offline';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'local';
export const AGENT_NAMES: Record<AgentId, string> = { claude: 'Claude', codex: 'Codex (ChatGPT)', gemini: 'Gemini', local: 'AI on this PC' };

export const USAGE_LIMIT_ERROR = /hit your .*limit|usage limit|rate.?limit|too many requests|\b429\b|quota|credit balance|resource.?exhausted/i;

// The installed command, by its full path when npm put it in the usual place: the hub's own PATH can miss
// the npm folder (that was behind "'claude' is not recognized"), so it isn't relied on.
export function cliPath(name: string): string {
  const npm = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', `${name}.cmd`);
  return process.platform === 'win32' && fs.existsSync(npm) ? `"${npm}"` : name;
}
const installed = (name: string) => {
  if (process.platform !== 'win32') return true; // found through PATH elsewhere
  return fs.existsSync(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', `${name}.cmd`));
};

// Codex and Gemini that ran out of usage rest for a while instead of failing every update in the meantime.
const resting = new Map<AgentId, number>();
const REST_MS = 30 * 60 * 1000;
export function noteAgentFailure(agent: AgentId, message: string) {
  if (!USAGE_LIMIT_ERROR.test(message)) return;
  if (agent === 'claude') recordFailure('anthropic', message);
  else resting.set(agent, Date.now() + REST_MS);
}

// "codex login status" is slow to ask, so it is asked in the background now and then.
let codexSignedIn = false;
function refreshCodex() {
  if (!installed('codex')) return void (codexSignedIn = false);
  const child = spawn(`${cliPath('codex')} login status`, { shell: true, windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('error', () => (codexSignedIn = false));
  child.on('close', () => (codexSignedIn = /logged in/i.test(out) && !/not logged in/i.test(out)));
}
refreshCodex();
setInterval(refreshCodex, 10 * 60 * 1000).unref?.();

const geminiKey = () => {
  const k = process.env.GEMINI_API_KEY || '';
  return k && !/^MY_|your|placeholder/i.test(k) ? k : '';
};

export function agentReady(agent: AgentId): { ok: boolean; why?: string } {
  if ((resting.get(agent) || 0) > Date.now()) return { ok: false, why: 'its usage limit was reached a little while ago' };
  if (agent === 'claude') {
    if (!cliSignedIn('anthropic')) return { ok: false, why: 'not signed in' };
    if (providerUnavailable('anthropic')) return { ok: false, why: 'its usage limit is used up for now' };
    return { ok: true };
  }
  if (agent === 'codex') {
    if (!installed('codex')) return { ok: false, why: 'not installed' };
    return codexSignedIn ? { ok: true } : { ok: false, why: 'not signed in (run "codex login" once)' };
  }
  if (agent === 'gemini') {
    if (!installed('gemini')) return { ok: false, why: 'not installed' };
    return geminiKey() ? { ok: true } : { ok: false, why: 'no Gemini key (add GEMINI_API_KEY to the hub\'s .env.local)' };
  }
  return localAgentModel() ? { ok: true } : { ok: false, why: 'no coding model in Ollama' };
}

// Which AIs to try for an update, best first. `local` = the owner asked for the AI on this PC.
export function agentChain(local?: boolean): AgentId[] {
  if (local || isOffline()) return localAgentModel() ? ['local'] : [];
  return (['claude', 'codex', 'gemini'] as AgentId[]).filter((a) => agentReady(a).ok);
}

// Why each AI isn't available, for messages like "No AI can do code updates right now".
export function agentStatus() {
  return (['claude', 'codex', 'gemini'] as AgentId[]).map((a) => ({ id: a, name: AGENT_NAMES[a], ...agentReady(a) }));
}

export interface AgentRun {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  log: (line: string) => void; // what the AI is doing ("Editing src/App.tsx")
  said: (text: string) => void; // the last thing it said in words
}

const shortPath = (p: string) => String(p || '').replace(/\\/g, '/').split('/').slice(-2).join('/');

function describeClaudeTool(name: string, input: any): string {
  const file = input?.file_path || input?.path || input?.pattern || '';
  if (name === 'Read') return `Reading ${shortPath(file)}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${shortPath(file)}`;
  if (name === 'Write') return `Writing ${shortPath(file)}`;
  if (name === 'Glob' || name === 'Grep') return `Searching for ${String(file).slice(0, 60)}`;
  return name;
}

// Runs one command, feeding the prompt on stdin and each output line to `onLine`. Rejects with the error text.
function runCli(command: string, opts: { cwd: string; env?: NodeJS.ProcessEnv; input: string; timeoutMs: number; onLine: (line: string) => void; errFilter?: (line: string) => boolean }): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: opts.cwd, shell: true, windowsHide: true, env: opts.env });
    let buffer = '';
    let err = '';
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
      else child.kill();
      reject(new Error(`The AI took longer than ${Math.round(opts.timeoutMs / 60000)} minutes and was stopped.`));
    }, opts.timeoutMs);
    child.stdout.on('data', (d) => {
      buffer += d.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) opts.onLine(line);
      }
    });
    child.stderr.on('data', (d) => {
      for (const l of d.toString().split(/\r?\n/)) if (l.trim() && (!opts.errFilter || opts.errFilter(l))) err += `${l}\n`;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buffer.trim()) opts.onLine(buffer.trim());
      resolve({ code, err: err.trim() });
    });
    child.stdin.end(opts.input);
  });
}

async function runClaude(run: AgentRun, local: string | null): Promise<string> {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--tools', 'Read,Edit,Write,Glob,Grep', '--model', local ? 'sonnet' : 'claude-sonnet-5-5'];
  let summary = '';
  let failed = '';
  const r = await runCli([cliPath('claude'), ...args].join(' '), {
    cwd: run.cwd,
    env: local ? localClaudeEnv(local) : planClaudeEnv(),
    input: run.prompt,
    timeoutMs: run.timeoutMs,
    // Warnings (the model-name note, the connectors note) are not failures: only keep real error lines.
    errFilter: (l) => !/^\s*⚠|unrecognized_model|doesn't recognize the model|connectors are disabled|ANTHROPIC_API_KEY/i.test(l),
    onLine: (line) => {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'assistant') {
          for (const part of ev.message?.content || []) if (part.type === 'tool_use') run.log(describeClaudeTool(part.name, part.input));
          const said = (ev.message?.content || []).filter((p: any) => p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('\n').trim();
          if (said) run.said(said);
        } else if (ev.type === 'result') {
          if (ev.is_error) failed = ev.result || 'The AI stopped with an error.';
          else summary = String(ev.result || '').trim();
        }
      } catch {}
    },
  });
  if (failed || r.code !== 0 || r.err) throw new Error((failed || r.err).trim().split('\n').slice(-2).join(' ') || `Claude Code exited with ${r.code}`);
  return summary;
}

async function runCodex(run: AgentRun): Promise<string> {
  const lastFile = path.join(os.tmpdir(), `eden-codex-${Date.now().toString(36)}.txt`);
  // workspace-write: Codex may read anything but only write inside the copy, with no network. Commands it runs
  // are for looking at files; the hub runs the real checks afterwards.
  // -C and --add-dir name the copy as the writable folder: the copy is a git worktree, and without them Codex
  // took the workspace to be somewhere else and refused to edit ("outside this session's writable workspace").
  const root = `"${run.cwd}"`;
  const cmd = [cliPath('codex'), 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'workspace-write', '-c', 'approval_policy=never', '-C', root, '--add-dir', root, '--json', '-o', `"${lastFile}"`, '-'].join(' ');
  let failed = '';
  let said = '';
  // The copy is a git worktree: its ".git" file points back at the real repository, and Codex followed it there
  // (it edited the real folder in testing). While Codex works, that pointer is set aside, so the copy looks like
  // a plain folder; it is put back as soon as Codex stops, whatever happens.
  const pointer = worktreePointer(run.cwd);
  const hidden = pointer ? `${pointer}.eden-hidden` : '';
  if (pointer) fs.renameSync(pointer, hidden);
  try {
    const r = await runCli(cmd, {
      cwd: run.cwd,
      input: run.prompt,
      timeoutMs: run.timeoutMs,
      errFilter: (l) => /error|limit|not logged|unauthori[sz]ed|forbidden/i.test(l),
      onLine: (line) => {
        try {
          const ev = JSON.parse(line);
          const item = ev.item || {};
          if (ev.type === 'item.started' && item.type === 'file_change') for (const c of item.changes || []) run.log(`Editing ${shortPath(c.path)}`);
          else if (ev.type === 'item.started' && item.type === 'command_execution') run.log('Looking through the files');
          else if (ev.type === 'item.completed' && item.type === 'agent_message' && item.text) {
            said = String(item.text).trim();
            run.said(said);
          } else if (ev.type === 'turn.failed' || ev.type === 'error') failed = ev.error?.message || ev.message || 'Codex stopped with an error.';
        } catch {}
      },
    });
    if (failed || r.code !== 0) throw new Error(failed || r.err.split('\n').slice(-2).join(' ') || `Codex exited with ${r.code}`);
    try {
      return fs.readFileSync(lastFile, 'utf-8').trim() || said;
    } catch {
      return said;
    }
  } finally {
    fs.rmSync(lastFile, { force: true });
    if (pointer) {
      try {
        fs.renameSync(hidden, pointer);
      } catch {}
    }
  }
}

// The ".git" FILE of a git worktree (a real repository has a .git FOLDER, which is left alone), in the folder
// itself or a few folders up. Only inside Eden's own update copies.
function worktreePointer(dir: string): string | null {
  let d = path.resolve(dir);
  for (let i = 0; i < 4; i++) {
    const p = path.join(d, '.git');
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return null;
      if (st.isFile()) return p.includes(`${path.sep}.eden-hub${path.sep}updates${path.sep}`) ? p : null;
    } catch {}
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

async function runGemini(run: AgentRun): Promise<string> {
  // auto_edit: file edits are allowed, anything else (running commands) is refused in this headless mode.
  // --skip-trust: the update's copy is a fresh folder Gemini hasn't seen; without it, edits are switched off.
  const cmd = [cliPath('gemini'), '--skip-trust', '--approval-mode', 'auto_edit', '-o', 'json', '-p', '"Do the task given on standard input."'].join(' ');
  let out = '';
  run.log('Gemini is working (it reports when it finishes)');
  const r = await runCli(cmd, { cwd: run.cwd, env: { ...process.env, GEMINI_API_KEY: geminiKey() }, input: run.prompt, timeoutMs: run.timeoutMs, onLine: (l) => (out += `${l}\n`) });
  let parsed: any = null;
  try {
    parsed = JSON.parse(out.slice(out.indexOf('{')));
  } catch {}
  if (parsed?.error) throw new Error(String(parsed.error.message || 'Gemini stopped with an error.'));
  if (r.code !== 0) throw new Error(r.err.split('\n').slice(-2).join(' ') || `Gemini exited with ${r.code}`);
  const text = String(parsed?.response || '').trim();
  if (text) run.said(text);
  return text;
}

export async function runAgent(agent: AgentId, run: AgentRun): Promise<string> {
  if (agent === 'codex') return runCodex(run);
  if (agent === 'gemini') return runGemini(run);
  if (agent === 'local') {
    const model = localAgentModel();
    if (!model) throw new Error('No coding model is running in Ollama on this PC.');
    run.log(`Running on this PC (${model})`);
    return runClaude(run, model);
  }
  return runClaude(run, null);
}

