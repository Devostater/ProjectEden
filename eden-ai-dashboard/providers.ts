// Unified multi-provider LLM layer: LYRA (your own local AI), Claude (Anthropic), Gemini (Google), OpenAI.
// Every AI call in the server goes through generate(); the provider is picked from the model id.
import { GoogleGenAI } from '@google/genai';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { realLimits, type RealLimit } from './realLimits';
import { extraModels, extraConnected, freeFallbacks, callExtra } from './extraAI';
import { pcBusy } from './busy';
import { isOffline, localModelFor, kindFor } from './offline';
import { auraInstalled, auraRunning, auraCliArgs, auraSystemNote, isAuraModel } from './aura';

export type ProviderId = 'lyra' | 'anthropic' | 'google' | 'openai' | 'extra';

// ---- LYRA ----------------------------------------------------------------------------------
// LYRA (Forge, Nova.bat) runs on this PC. EDEN sends it the conversation and LYRA's Auto mode picks
// the model: free local/cloud models first, paid ones only if you allowed them in LYRA (with LYRA's
// spending caps). LYRA counts as connected while it answers on LYRA_URL.
const LYRA_URL = () => (process.env.LYRA_URL || 'http://127.0.0.1:4777').replace(/\/+$/, '');
let lyraUp = false;
export async function pingLyra() {
  try {
    const r = await fetch(`${LYRA_URL()}/api/cloud`, { signal: AbortSignal.timeout(4000) });
    lyraUp = r.ok;
  } catch {
    lyraUp = false;
  }
}
pingLyra();
setInterval(pingLyra, 30000).unref?.();
export const lyraConnected = () => lyraUp;

export interface ModelInfo {
  id: string;
  label: string;
  provider: ProviderId;
}

// Functions (not constants) so values set later via .env.local or the Settings page take effect.
export const models = (): ModelInfo[] => [
  { id: 'lyra', label: 'LYRA (your local AI, picks the best model)', provider: 'lyra' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'google' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'google' },
  { id: process.env.OPENAI_MODEL || 'gpt-5', label: `OpenAI ${process.env.OPENAI_MODEL || 'gpt-5'}`, provider: 'openai' },
  // Aura: Claude with Aura's Unreal tools (Aura app must be open). See aura.ts.
  ...(auraInstalled()
    ? [
        { id: 'aura', label: 'Aura: Unreal, inspect & plan (no changes)', provider: 'anthropic' as ProviderId },
        { id: 'aura-build', label: 'Aura: Unreal, can change the project (no undo)', provider: 'anthropic' as ProviderId },
      ]
    : []),
  // Extra AIs (+ Add AI): local models, Google AI Studio models, free tiers you connected.
  ...extraModels().map((m) => ({ id: m.id, label: `${m.label}${m.local ? ' (this PC, free)' : m.free ? ' (free)' : ''}`, provider: 'extra' as ProviderId })),
];

export const defaultModel = () => process.env.DEFAULT_MODEL || (lyraUp ? 'lyra' : 'gemini-3.6-flash');

export function providerFor(model: string): ProviderId {
  const known = models().find((m) => m.id === model);
  if (known) return known.provider;
  if (model.startsWith('x:')) return 'extra';
  if (model.startsWith('lyra')) return 'lyra';
  if (model.startsWith('claude') || isAuraModel(model)) return 'anthropic';
  if (model.startsWith('gemini')) return 'google';
  return 'openai';
}

const hasKey = (v?: string) => !!v && !/^MY_[A-Z_]+$/.test(v);

// Subscription mode: run the provider's own CLI, signed in with your plan (no API key, no per-token bill).
//   Claude  -> Claude Code  (`claude`, Pro/Max login)
//   Gemini  -> Gemini CLI   (`gemini`, Google account login, free tier)
//   OpenAI  -> Codex CLI    (`codex`, ChatGPT plan login)
const CLI: Record<ProviderId, string> = { lyra: '', anthropic: 'claude', google: 'gemini', openai: 'codex', extra: '' };
const cliCache: Partial<Record<ProviderId, boolean>> = {};

export function cliInstalled(p: ProviderId, refresh = false): boolean {
  if (p === 'lyra' || p === 'extra') return false;
  if (refresh || cliCache[p] === undefined) {
    const r = spawnSync(`${CLI[p]} --version`, { shell: true, timeout: 15000, windowsHide: true });
    cliCache[p] = r.status === 0;
  }
  return cliCache[p]!;
}

// Installed is not enough: the tool must also be signed in to your plan.
const signedInCache: Partial<Record<ProviderId, boolean>> = {};
const checkedAt: Partial<Record<ProviderId, number>> = {};
const RECHECK_MS = 2 * 60 * 1000;

export function cliSignedIn(p: ProviderId, refresh = false): boolean {
  if (!cliInstalled(p, refresh)) return false;
  if (refresh || signedInCache[p] === undefined || Date.now() - (checkedAt[p] || 0) > RECHECK_MS) {
    checkedAt[p] = Date.now();
    const run = (cmd: string) => spawnSync(cmd, { shell: true, timeout: 20000, windowsHide: true, encoding: 'utf-8' });
    if (p === 'anthropic') {
      const r = run('claude auth status');
      try {
        signedInCache[p] = JSON.parse(r.stdout).loggedIn === true;
      } catch {
        signedInCache[p] = r.status === 0 && !/"loggedIn":\s*false|not logged in/i.test(r.stdout + r.stderr);
      }
    } else if (p === 'openai') {
      const r = run('codex login status');
      const out = `${r.stdout}${r.stderr}`;
      signedInCache[p] = r.status === 0 && /logged in/i.test(out) && !/not logged in/i.test(out);
    } else {
      signedInCache[p] = true; // The Gemini CLI has no status command; a failed call marks it unavailable instead.
    }
  }
  return signedInCache[p]!;
}

export type ProviderMode = 'subscription' | 'api' | 'off';

// API key wins if set; otherwise fall back to the subscription CLI if it is installed.
export function providerMode(p: ProviderId): ProviderMode {
  if (p === 'lyra') return lyraUp ? 'api' : 'off';
  if (p === 'extra') return extraConnected() ? 'api' : 'off';
  const key = { anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }[p];
  if (hasKey(process.env[key])) return 'api';
  if (cliSignedIn(p)) return 'subscription';
  return 'off';
}

export function providerStatus(): Record<ProviderId, boolean> {
  return {
    lyra: providerMode('lyra') !== 'off',
    anthropic: providerMode('anthropic') !== 'off',
    google: providerMode('google') !== 'off',
    openai: providerMode('openai') !== 'off',
    extra: providerMode('extra') !== 'off',
  };
}

export function providerDetails(refresh = false) {
  return (['anthropic', 'google', 'openai'] as ProviderId[]).map((p) => {
    if (refresh) {
      cliSignedIn(p, true);
      clearUnavailable();
    }
    return { provider: p, cli: CLI[p], cliInstalled: cliInstalled(p), mode: providerMode(p) };
  });
}

function flatten(req: GenerateRequest, opts: { tools?: boolean } = {}): string {
  const parts: string[] = [];
  if (req.system) parts.push(`# Instructions
${req.system}`);
  const msgs = toMessages(req);
  if (msgs.length > 1) {
    parts.push('# Conversation so far');
    for (const m of msgs.slice(0, -1)) parts.push(`${m.role === 'user' ? 'Owner' : 'Assistant'}: ${m.content}`);
  }
  parts.push(`# Reply to this
${msgs[msgs.length - 1]?.content ?? ''}`);
  // Aura teammates are the exception: they must use Aura's Unreal tools.
  if (!opts.tools) parts.push('Reply with plain text only. Do not use tools, read files or run commands.');
  return parts.join('\n\n');
}

function runCli(cmd: string, input: string, cwd: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, cwd, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Subscription CLI timed out'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        const clean = (err || out).replace(/\u001b\[[0-9;]*m/g, '').trim();
        const errLine = clean.split('\n').find((l) => /error/i.test(l));
        reject(new Error((errLine || clean.split('\n').pop() || `exited with ${code}`).replace(/^ERROR:\s*/i, '').trim()));
      }
    });
    child.stdin.end(input);
  });
}

async function callSubscription(provider: ProviderId, model: string, req: GenerateRequest): Promise<GenerateResult> {
  // Empty scratch folder so the CLI agents have nothing to touch.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'eden-'));
  const prompt = flatten(req, { tools: isAuraModel(model) });
  try {
    let text: string;
    if (provider === 'anthropic' && isAuraModel(model)) {
      // Aura works on the real Unreal project and can take several minutes.
      if (!(await auraRunning())) throw new Error('Aura isn\'t open. Open the Aura app (it starts Unreal for the project), then try again.');
      const withNote = `# Working with Aura\n${auraSystemNote(model)}\n\n${prompt}`;
      text = await runCli(`claude -p --model claude-sonnet-5-5 --output-format text ${auraCliArgs(model)}`, withNote, cwd, 15 * 60 * 1000);
    } else if (provider === 'anthropic') {
      text = await runCli(`claude -p --model ${model} --output-format text`, prompt, cwd);
    } else if (provider === 'google') {
      text = await runCli(`gemini -m ${model}`, prompt, cwd);
    } else {
      const outFile = path.join(cwd, 'reply.txt');
      const m = process.env.OPENAI_MODEL ? ` -m ${process.env.OPENAI_MODEL}` : '';
      await runCli(`codex exec --skip-git-repo-check --sandbox read-only${m} -o "${outFile}" -`, prompt, cwd);
      text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf-8') : '';
    }
    return { text: text.trim(), model, provider };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  model?: string;
  system?: string;
  prompt?: string;
  messages?: ChatMessage[];
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  tokens?: number;
  model: string;
  provider: ProviderId;
}

function toMessages(req: GenerateRequest): ChatMessage[] {
  const msgs = req.messages?.length ? [...req.messages] : [];
  if (req.prompt) msgs.push({ role: 'user', content: req.prompt });
  // Providers require alternating turns starting with user: merge consecutive same-role turns.
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  let model = req.model || defaultModel();
  // Offline mode: anything bound for a cloud AI goes to a model on this PC that suits the job instead.
  if (isOffline() && !(model.startsWith('x:') && localModelFor('general') && isLocalModel(model))) {
    if (isAuraModel(model)) throw new Error('Aura needs the internet (it runs through Claude). This waits until you are back online.');
    if (!model.startsWith('lyra')) {
      const local = localModelFor(kindFor(model));
      if (!local) throw new Error('Offline, and no AI on this PC is running. Start Ollama (it runs local models), then try again.');
      model = local;
    }
  }
  if (!(model.startsWith('x:') ? /^x:[\w.\-]+:[\w.\-:/@]+$/ : /^[\w.\-]+$/).test(model)) throw new Error(`Invalid model id: ${model}`);
  const provider = providerFor(model);
  const mode = providerMode(provider);
  if (mode === 'off') {
    if (provider === 'extra') throw new Error('That free AI is not available right now (not running or removed). Check Account → Connections → Free AIs.');
    if (provider === 'lyra') throw new Error("LYRA isn't running. Start it with Nova.bat on the PC (it answers on " + LYRA_URL() + ').');
    throw new Error(`${provider === 'anthropic' ? 'Claude' : provider === 'google' ? 'Gemini' : 'OpenAI'} isn't connected yet. Connect it in Account → Connections.`);
  }
  try {
    const result = await dispatch(provider, mode, model, req);
    recordUsage(provider, result.tokens || 0);
    return result;
  } catch (err: any) {
    recordFailure(provider, String(err?.message || err));
    throw err;
  }
}

const isLocalModel = (id: string) => /^x:(ollama|lmstudio):/.test(id);

function dispatch(provider: ProviderId, mode: ProviderMode, model: string, req: GenerateRequest): Promise<GenerateResult> {
  if (provider === 'lyra') return callLyra(req);
  if (provider === 'extra') return callExtra(model, { system: req.system, messages: toMessages(req), maxTokens: req.maxTokens }).then((r) => ({ ...r, provider: 'extra' as ProviderId }));
  if (mode === 'subscription' || isAuraModel(model)) return callSubscription(provider, model, req);
  switch (provider) {
    case 'anthropic':
      return callClaude(model, req);
    case 'openai':
      return callOpenAI(model, req);
    default:
      return callGemini(model, req);
  }
}

// ---- Usage tracking -------------------------------------------------------------------------
// Counts what THIS app sends to each AI per day. The vendors don't expose how much of a
// subscription is left, so the bar is "messages today vs. a daily budget you choose"; when a
// vendor says the plan is used up, that message is kept and shown until a call succeeds again.
const USAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-usage.json');

interface DayUsage {
  day: string;
  messages: number;
  tokens: number;
  limitNote?: string;
  limitAt?: number; // when the plan said it was used up
}

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
let usage: Partial<Record<ProviderId, DayUsage>> = {};
try {
  usage = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf-8'));
} catch {}

function dayUsage(p: ProviderId): DayUsage {
  const u = usage[p];
  if (!u || u.day !== today()) {
    // New day: counts reset, but a "plan used up" note stays until a call succeeds.
    usage[p] = { day: today(), messages: 0, tokens: 0, limitNote: u?.limitNote, limitAt: u?.limitAt };
  }
  return usage[p]!;
}

function saveUsage() {
  try {
    fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2), 'utf-8');
  } catch {}
}

function recordUsage(p: ProviderId, tokens: number) {
  const u = dayUsage(p);
  u.messages += 1;
  u.tokens += tokens;
  delete u.limitNote;
  delete u.limitAt;
  delete downUntil[p];
  saveUsage();
}

// Providers that just failed for a reason that won't fix itself in seconds (not signed in, bad key,
// plan used up). Callers skip them for a few minutes instead of failing the same way on every message.
const downUntil: Partial<Record<ProviderId, number>> = {};
const DOWN_MS = 5 * 60 * 1000;

const LIMIT_RETRY_MS = 60 * 60 * 1000;
const limited = (p: ProviderId) => {
  if (p === 'lyra' || p === 'extra') return false; // LYRA has its own caps; extra AIs rest per model
  if (p !== 'google') {
    const real = realLimits()[p];
    if (real.limited) return true; // the plan itself says it's used up, until its reset time
  }
  const u = dayUsage(p);
  return !!u.limitNote && Date.now() - (u.limitAt || 0) < LIMIT_RETRY_MS; // otherwise try again once an hour
};

export function providerUnavailable(p: ProviderId): boolean {
  // While the PC is busy, LYRA (which runs models on this PC) is skipped and cloud AIs answer instead.
  return providerMode(p) === 'off' || limited(p) || (downUntil[p] || 0) > Date.now() || (p === 'lyra' && pcBusy());
}

export function clearUnavailable() {
  for (const k of Object.keys(downUntil) as ProviderId[]) delete downUntil[k];
}

// Forgets the saved "limit hit" notes so a refresh starts clean. If a plan is still really used up,
// the plan check (real limits) or the next failed message will bring the note back.
function clearLimitNotes() {
  let changed = false;
  for (const p of ['lyra', 'anthropic', 'google', 'openai'] as ProviderId[]) {
    const u = usage[p];
    if (u && (u.limitNote || u.limitAt)) {
      u.limitNote = undefined;
      u.limitAt = undefined;
      changed = true;
    }
  }
  if (changed) saveUsage();
}

const PROVIDER_LABEL: Record<ProviderId, string> = { lyra: 'LYRA', anthropic: 'Claude', google: 'Gemini', openai: 'ChatGPT', extra: 'Free AIs' };
export const providerLabel = (p: ProviderId) => PROVIDER_LABEL[p];

// Working models on other providers, best first, for when an agent's own AI can't answer.
export function fallbackModels(exclude: ProviderId): string[] {
  const pick: Record<ProviderId, string> = {
    lyra: 'lyra',
    extra: '',
    google: 'gemini-3.6-flash',
    anthropic: 'claude-sonnet-5-5',
    openai: process.env.OPENAI_MODEL || 'gpt-5',
  };
  const main = (['lyra', 'anthropic', 'google', 'openai'] as ProviderId[]).filter((p) => p !== exclude && !providerUnavailable(p)).map((p) => pick[p]);
  // Then free extra AIs (Google AI Studio models, Ollama on this PC, free tiers you added).
  return [...main, ...freeFallbacks()];
}

function recordFailure(p: ProviderId, message: string) {
  if (p === 'lyra' || p === 'extra') return; // LYRA marks itself; extra AIs rest per model
  if (/log ?in|logged|sign ?in|auth|unauthor|\b401\b|\b403\b|api key|usage limit|hit your .{0,20}limit|quota|credit balance/i.test(message)) {
    downUntil[p] = Date.now() + DOWN_MS;
  }
  if (!/usage limit|hit your .{0,20}limit|quota|rate.?limit|\b429\b|credit balance/i.test(message)) return;
  dayUsage(p).limitNote = message.replace(/\s+/g, ' ').slice(0, 220);
  dayUsage(p).limitAt = Date.now();
  saveUsage();
}

const LIMIT_ENV: Record<ProviderId, string> = {
  lyra: 'LYRA_DAILY_LIMIT',
  extra: 'EXTRA_DAILY_LIMIT',
  anthropic: 'CLAUDE_DAILY_LIMIT',
  google: 'GEMINI_DAILY_LIMIT',
  openai: 'CHATGPT_DAILY_LIMIT',
};
const DEFAULT_DAILY_LIMIT = 100;

export function providerUsage(refresh = false) {
  const real = realLimits(refresh);
  if (refresh) {
    for (const p of ['anthropic', 'openai'] as ProviderId[]) cliSignedIn(p, true);
    clearUnavailable();
    clearLimitNotes();
  }
  const names: Record<ProviderId, string> = { lyra: 'LYRA', anthropic: 'Claude', google: 'Gemini', openai: 'ChatGPT', extra: 'Free AIs' };
  return (['lyra', 'anthropic', 'google', 'openai', 'extra'] as ProviderId[]).map((p) => {
    const u = dayUsage(p);
    const limit = Math.max(1, parseInt(process.env[LIMIT_ENV[p]] || '', 10) || (p === 'lyra' || p === 'extra' ? 1000 : DEFAULT_DAILY_LIMIT));
    return {
      provider: p,
      name: names[p],
      mode: providerMode(p),
      messages: u.messages,
      tokens: u.tokens,
      limit,
      limitNote: u.limitNote || '',
      // What the plan itself reports, when the tool records it (ChatGPT: percent used; Claude: limit hits).
      real: p === 'google' || p === 'lyra' || p === 'extra' ? ({ source: 'none', checkedAt: Date.now() } as RealLimit) : real[p],
    };
  });
}

// LYRA's chat API streams one JSON event per line; the reply is the last "answer" event.
async function callLyra(req: GenerateRequest): Promise<GenerateResult> {
  const history = toMessages(req);
  if (req.system && history.length) {
    history[0] = { ...history[0], content: '(Instructions from EDEN AI Hub, follow them for this conversation:\n' + req.system + ')\n\n' + history[0].content };
  }
  let res: Response;
  try {
    res = await fetch(LYRA_URL() + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', mode: 'chat', project: null, trust: 'ask', history }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (e: any) {
    lyraUp = false;
    throw new Error("LYRA isn't running (" + (e?.cause?.code || e?.message || e) + '). Start it with Nova.bat.');
  }
  if (!res.ok || !res.body) throw new Error('LYRA answered ' + res.status);
  let answer = '';
  let error = '';
  let tokens = 0;
  let used = 'lyra';
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: any;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'answer' && ev.text) answer = ev.text;
    else if (ev.type === 'error') error = ev.text || 'LYRA failed';
    else if (ev.type === 'usage') tokens = (ev.input || 0) + (ev.output || 0);
    else if (ev.type === 'route' && ev.model) used = 'lyra (' + ev.model + ')';
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, k)); buf = buf.slice(k + 1); }
  }
  handle(buf);
  if (!answer) throw new Error('LYRA: ' + (error || 'no answer'));
  return { text: answer.trim(), tokens, model: used, provider: 'lyra' };
}

const GEMINI_FALLBACK = 'gemini-3.5-flash-lite';

function geminiErrorMessage(err: any): string {
  const raw = String(err?.message || err);
  try {
    return JSON.parse(raw).error?.message || raw;
  } catch {
    return raw;
  }
}

// If Google says the model is busy (503) or over quota (429), retry once on the lighter model.
async function callGemini(model: string, req: GenerateRequest): Promise<GenerateResult> {
  try {
    return await callGeminiOnce(model, req);
  } catch (err: any) {
    const msg = geminiErrorMessage(err);
    const busy = /\b(503|429)\b|UNAVAILABLE|high demand|quota/i.test(String(err?.message || err));
    if (busy && model !== GEMINI_FALLBACK) {
      try {
        return await callGeminiOnce(GEMINI_FALLBACK, req);
      } catch (err2: any) {
        throw new Error(`Gemini is busy right now: ${geminiErrorMessage(err2)}`);
      }
    }
    throw new Error(`Gemini: ${msg}`);
  }
}

async function callGeminiOnce(model: string, req: GenerateRequest): Promise<GenerateResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // Some Gemini models accept the request but never answer; give up instead of hanging.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini (${model}) didn't answer within 90 seconds. Try another Gemini model.`)), 90000)
  );
  const response = await Promise.race([timeout, ai.models.generateContent({
    model,
    contents: toMessages(req).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    config: req.system ? { systemInstruction: req.system } : undefined,
  })]);
  return {
    text: response.text ?? '',
    tokens: response.usageMetadata?.totalTokenCount,
    model,
    provider: 'google',
  };
}

async function callClaude(model: string, req: GenerateRequest): Promise<GenerateResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.system ? { system: req.system } : {}),
      messages: toMessages(req),
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`Claude error: ${data?.error?.message || res.statusText}`);
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return {
    text,
    tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    model,
    provider: 'anthropic',
  };
}

async function callOpenAI(model: string, req: GenerateRequest): Promise<GenerateResult> {
  const messages: any[] = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  messages.push(...toMessages(req));
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, max_completion_tokens: req.maxTokens ?? 4096 }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`OpenAI error: ${data?.error?.message || res.statusText}`);
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    tokens: data.usage?.total_tokens,
    model,
    provider: 'openai',
  };
}
