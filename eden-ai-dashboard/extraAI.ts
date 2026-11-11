// Extra AIs: anything that speaks the common "OpenAI-compatible" chat format.
//
// Found automatically (no sign-up):
//   - Ollama on this PC: free, unlimited, private (the models LYRA already uses).
//   - LM Studio on this PC, if it's running.
//   - Google AI Studio: every text model your Gemini key can use (Gemma, Gemini versions, antigravity-preview…).
//     Google's free tier limits each model separately, so spreading work across them stretches it.
// Added with a free key (one sign-up each): Groq, OpenRouter (free models only), Cerebras, Mistral,
// Hugging Face, GitHub Models, or any other compatible service.
//
// Model ids look like "x:<provider id>:<model>", e.g. "x:ollama:qwen3.5:4b".
// When one model hits its limit it is rested for a while and the next free one is used.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pcBusy } from './busy';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-ai.json');

export interface ExtraProvider {
  id: string;
  name: string;
  baseUrl: string; // ends before /chat/completions
  apiKey?: string; // stored only in .eden-ai.json on this PC (never sent to the page)
  keyFromEnv?: string; // use a key the hub already has, e.g. GEMINI_API_KEY
  models: string[];
  free: boolean; // costs nothing (free tier or local)
  local?: boolean; // runs on this PC
  auto?: boolean; // found automatically
  enabled: boolean;
  modelFilter?: string; // only models whose id contains this (e.g. ":free" on OpenRouter)
  lastError?: string;
  checkedAt?: string;
  // Models tried once: true = answers, string = why it can't be used (retired, needs another API, …).
  tested?: Record<string, true | string>;
}

// Services with a free tier: sign up once, paste the key, and the hub lists their models.
export const PRESETS: { id: string; name: string; baseUrl: string; signup: string; note: string; modelFilter?: string }[] = [
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', signup: 'https://console.groq.com/keys', note: 'Very fast; free tier with daily limits per model.' },
  { id: 'openrouter', name: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', signup: 'https://openrouter.ai/keys', note: 'Dozens of free models; only the free ones are added.', modelFilter: ':free' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', signup: 'https://cloud.cerebras.ai', note: 'Very fast; free tier with daily limits.' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', signup: 'https://console.mistral.ai/api-keys', note: 'Free "Experiment" plan with rate limits.' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', signup: 'https://huggingface.co/settings/tokens', note: 'Small free monthly allowance across many open models.' },
  { id: 'github', name: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', signup: 'https://github.com/settings/personal-access-tokens', note: 'Free with a GitHub account (token with "Models" permission).' },
];

let providers: ExtraProvider[] = [];
try {
  providers = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
} catch {}
const save = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(providers, null, 2), 'utf-8');
  } catch {}
};

const keyOf = (p: ExtraProvider) => p.apiKey || (p.keyFromEnv ? process.env[p.keyFromEnv] : '') || '';

// Text-chat models only: skip speech, image, video, music, embeddings and live-audio models.
const NOT_CHAT = /(tts|image|imagen|veo|lyria|embed|transcrib|whisper|audio|live|realtime|moderation|guard|rerank|ocr|vision-only|robotics|computer-use|nano-banana|deep-research|translate|aqa)/i;

async function listModels(p: Pick<ExtraProvider, 'baseUrl' | 'modelFilter'> & { key: string }): Promise<string[]> {
  const res = await fetch(`${p.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: p.key ? { authorization: `Bearer ${p.key}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  const data: any = await res.json();
  const list: any[] = Array.isArray(data) ? data : data.data || data.models || [];
  return list
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter((id) => id && !NOT_CHAT.test(id) && (!p.modelFilter || id.includes(p.modelFilter)))
    .slice(0, 80);
}

function upsert(p: ExtraProvider) {
  const i = providers.findIndex((x) => x.id === p.id);
  if (i >= 0) providers[i] = { ...providers[i], ...p, enabled: providers[i].enabled, tested: providers[i].tested };
  else providers.push(p);
}

const errorOf = (data: any) => (Array.isArray(data) ? data[0]?.error : data?.error) || null;
// The service says this model can't be used at all (as opposed to "busy, try later").
const permanent = (status: number, msg: string) => status === 404 || (status === 400 && /only supports|not supported|no longer available|does not exist/i.test(msg));

// Cloud services list models that can't actually chat (retired, or a different API only). Try each new
// one once with a tiny message and hide the ones that refuse. Local models are always kept.
async function testNewModels(p: ExtraProvider) {
  if (p.local) return;
  p.tested ||= {};
  for (const model of p.models.filter((m) => p.tested![m] === undefined).slice(0, 40)) {
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(keyOf(p) ? { authorization: `Bearer ${keyOf(p)}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 }),
        signal: AbortSignal.timeout(60000),
      });
      const data: any = await res.json().catch(() => ({}));
      const msg = String(errorOf(data)?.message || '');
      if (res.ok) p.tested[model] = true;
      else if (permanent(res.status, msg)) p.tested[model] = msg.slice(0, 120) || `${res.status}`;
      // Busy / rate-limited: leave untested and try again on the next scan.
    } catch {}
  }
}

// Looks for AIs that need no sign-up, and refreshes the model lists of the ones you added.
export async function scanExtraAIs(): Promise<{ found: string[] }> {
  const found: string[] = [];
  const at = new Date().toISOString();

  const local: [string, string, string][] = [
    ['ollama', 'Ollama (on this PC)', 'http://127.0.0.1:11434/v1'],
    ['lmstudio', 'LM Studio (on this PC)', 'http://127.0.0.1:1234/v1'],
  ];
  for (const [id, name, baseUrl] of local) {
    try {
      const models = await listModels({ baseUrl, key: '' });
      if (models.length) {
        upsert({ id, name, baseUrl, models, free: true, local: true, auto: true, enabled: true, checkedAt: at, lastError: undefined });
        found.push(`${name}: ${models.length} model${models.length === 1 ? '' : 's'}`);
      }
    } catch {
      const p = providers.find((x) => x.id === id);
      if (p) Object.assign(p, { lastError: 'Not running right now.', checkedAt: at });
    }
  }

  if (process.env.GEMINI_API_KEY && !/^MY_/.test(process.env.GEMINI_API_KEY)) {
    try {
      const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
      const models = await listModels({ baseUrl, key: process.env.GEMINI_API_KEY });
      upsert({ id: 'aistudio', name: 'Google AI Studio (your Gemini key)', baseUrl, keyFromEnv: 'GEMINI_API_KEY', models, free: true, auto: true, enabled: true, checkedAt: at, lastError: undefined });
      found.push(`Google AI Studio: ${models.length} models`);
    } catch (err: any) {
      const p = providers.find((x) => x.id === 'aistudio');
      if (p) Object.assign(p, { lastError: err.message, checkedAt: at });
    }
  }

  for (const p of providers.filter((x) => !x.auto && x.enabled)) {
    try {
      p.models = await listModels({ baseUrl: p.baseUrl, modelFilter: p.modelFilter, key: keyOf(p) });
      p.lastError = undefined;
    } catch (err: any) {
      p.lastError = err.message;
    }
    p.checkedAt = at;
  }
  save();
  for (const p of providers.filter((x) => x.enabled && !x.lastError)) await testNewModels(p);
  save();
  return { found };
}

export async function addExtraAI(input: { presetId?: string; name?: string; baseUrl?: string; apiKey?: string; free?: boolean }) {
  const preset = PRESETS.find((p) => p.id === input.presetId);
  const baseUrl = (preset?.baseUrl || input.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const name = (preset?.name || input.name || '').trim().slice(0, 40);
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error('Enter the AI\'s address (it starts with https://).');
  if (!name) throw new Error('Give it a name.');
  const key = (input.apiKey || '').trim();
  const models = await listModels({ baseUrl, modelFilter: preset?.modelFilter, key }).catch((err) => {
    throw new Error(`Couldn't reach it with that key: ${err.message}. Check the key and try again.`);
  });
  if (!models.length) throw new Error('Connected, but it offers no chat models.');
  const id = preset?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  upsert({ id, name, baseUrl, apiKey: key || undefined, models, free: preset ? true : !!input.free, enabled: true, modelFilter: preset?.modelFilter, checkedAt: new Date().toISOString() });
  save();
  const added = providers.find((p) => p.id === id)!;
  testNewModels(added).then(save, () => {});
  return { id, models: models.length };
}

export function setExtraEnabled(id: string, enabled: boolean) {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error('Not found.');
  p.enabled = enabled;
  save();
}

export function removeExtraAI(id: string) {
  providers = providers.filter((x) => x.id !== id);
  save();
}

// For the page: everything except keys.
export const extraSummary = () =>
  providers.map(({ apiKey, tested, ...p }) => ({ ...p, models: usable(p as ExtraProvider & { tested?: any }, tested), hasKey: !!apiKey || !!p.keyFromEnv }));

const usable = (p: ExtraProvider, tested = p.tested) => p.models.filter((m) => typeof tested?.[m] !== 'string');

// ---- Using them ----------------------------------------------------------------------------------

const resting = new Map<string, number>(); // model id -> rest until (epoch ms)
const REST_MS = 10 * 60 * 1000;

export const extraModelId = (providerId: string, model: string) => `x:${providerId}:${model}`;
const parse = (id: string) => {
  const m = id.match(/^x:([^:]+):(.+)$/);
  return m ? { provider: providers.find((p) => p.id === m[1]), model: m[2] } : null;
};

export function extraModels(): { id: string; label: string; free: boolean; local: boolean; proven: boolean }[] {
  return providers
    .filter((p) => p.enabled && !p.lastError)
    .flatMap((p) => usable(p).map((m) => ({ id: extraModelId(p.id, m), label: `${p.name.replace(/ \(.*\)$/, '')} · ${m}`, free: p.free, local: !!p.local, proven: !!p.local || p.tested?.[m] === true })));
}

export const extraConnected = () => providers.some((p) => p.enabled && !p.lastError && usable(p).length);

// Free models to fall back on, best first: cloud free tiers (stronger), then models on this PC
// (always available). Models that just hit a limit are skipped while they rest.
export function freeFallbacks(max = 6): string[] {
  const now = Date.now();
  const cloud = extraModels().filter((m) => m.free && !m.local);
  // Models on this PC need 3+ GB of free memory to load; skip them when memory is short so the PC doesn't lag.
  const local = !pcBusy() && os.freemem() > 3 * 1024 ** 3 ? extraModels().filter((m) => m.free && m.local) : [];
  // Prefer general chat models over code-only ones, and bigger "flash/pro/gemma" families on AI Studio.
  // Models that answered a test go first; newest versions before older ones; code-only and previews last.
  const version = (id: string) => Number(id.match(/(\d+(?:\.\d+)?)/)?.[1] || 0);
  const score = (m: { id: string; proven: boolean }) => (m.proven ? 0 : 10) + (/(coder|code)/i.test(m.id) ? 2 : 0) + (/preview|exp|latest/i.test(m.id) ? 1 : 0) - version(m.id) / 100;
  const ordered = [...cloud.sort((a, b) => score(a) - score(b)), ...local.sort((a, b) => score(a) - score(b))];
  return ordered.filter((m) => (resting.get(m.id) || 0) < now).slice(0, max).map((m) => m.id);
}

export async function callExtra(id: string, req: { system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens?: number }) {
  const parsed = parse(id);
  if (!parsed?.provider) throw new Error(`Unknown AI: ${id}`);
  const { provider, model } = parsed;
  const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages];
  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(keyOf(provider) ? { authorization: `Bearer ${keyOf(provider)}` } : {}) },
      // Small models on this PC answer much faster (and don't run out of room) without "thinking" first.
      body: JSON.stringify({ model, messages, max_tokens: Math.min(req.maxTokens ?? 4096, 8192), stream: false, ...(provider.local ? { reasoning_effort: 'none' } : {}) }),
      signal: AbortSignal.timeout(provider.local ? 10 * 60 * 1000 : 3 * 60 * 1000),
    });
  } catch (err: any) {
    resting.set(id, Date.now() + REST_MS);
    throw new Error(`${provider.name} couldn't be reached: ${err?.cause?.code || err.message}`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(errorOf(data)?.message || data?.message || res.statusText || res.status);
    if (permanent(res.status, msg)) {
      provider.tested = { ...provider.tested, [model]: msg.slice(0, 120) };
      save();
    } else resting.set(id, Date.now() + REST_MS);
    throw new Error(`${provider.name} (${model}): ${msg.slice(0, 200)}`);
  }
  // Drop the model's private "thinking" (some put it in <think> or <thought> tags, possibly unclosed).
  const text = String(data?.choices?.[0]?.message?.content ?? '')
    .replace(/<(think|thought)>[\s\S]*?(<\/\1>|$)/g, '')
    .trim();
  if (!text) throw new Error(`${provider.name} (${model}) returned an empty answer.`);
  const tokens = (data?.usage?.prompt_tokens || 0) + (data?.usage?.completion_tokens || 0);
  return { text, tokens, model: `${provider.name.replace(/ \(.*\)$/, '')} · ${model}` };
}

// First look on startup, then every 10 minutes (local AIs come and go).
export function startExtraScan() {
  scanExtraAIs().catch(() => {});
  setInterval(() => scanExtraAIs().catch(() => {}), 10 * 60 * 1000).unref?.();
}
