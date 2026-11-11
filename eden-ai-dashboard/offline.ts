// Offline mode: the team keeps working with no internet, on AI models that run on this PC (Ollama).
//   auto (default)   offline mode turns on by itself when the internet drops, and off when it's back
//   on               always offline: nothing is sent to cloud AIs, even with internet
//   off              never: cloud AIs only (local ones stay a backup, as before)
// While offline:
//   - every AI request goes to a local model that suits the job: a coding model for code, a general
//     model for writing, planning and chat (picked from what Ollama has)
//   - work that only works online waits and starts by itself when the internet is back: code updates
//     (Claude Code), update suggestions, and Aura (it runs through Claude)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Request } from 'express';
import { logActivity } from './activity';
import { extraModels } from './extraAI';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-offline.json');
export type OfflineMode = 'auto' | 'on' | 'off';

let mode: OfflineMode = 'auto';
try {
  const m = JSON.parse(fs.readFileSync(FILE, 'utf-8')).mode;
  if (m === 'on' || m === 'off' || m === 'auto') mode = m;
} catch {}

let internetUp = true;
let fails = 0;
let changedAt = 0;
const listeners: Array<(offline: boolean) => void> = [];

export const isOffline = () => mode === 'on' || (mode === 'auto' && !internetUp);
export const onOfflineChange = (fn: (offline: boolean) => void) => listeners.push(fn);

async function reachable(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return r.status > 0;
  } catch {
    return false;
  }
}

// Checks the internet every 30 seconds. Two misses in a row count as "down" (so one slow answer doesn't flip it).
async function checkInternet() {
  const before = isOffline();
  const ok = (await reachable('https://www.gstatic.com/generate_204')) || (await reachable('https://1.1.1.1'));
  if (ok) {
    fails = 0;
    internetUp = true;
  } else if (++fails >= 2) internetUp = false;
  const after = isOffline();
  if (before !== after) {
    changedAt = Date.now();
    logActivity(after ? 'error' : 'done', after ? 'Internet is down: offline mode on. The team runs on AI on this PC.' : 'Internet is back: offline mode off. Waiting online work carries on.');
    for (const fn of listeners) fn(after);
  }
}
setTimeout(checkInternet, 3000).unref?.();
setInterval(checkInternet, 30000).unref?.();

// ---- Picking a local model for a job ----------------------------------------------------------------

export type JobKind = 'code' | 'general' | 'quick';

// Best first. Sized for a 6 GB graphics card: these fit on it, so they answer quickly.
const PREFER: Record<JobKind, RegExp[]> = {
  code: [/qwen2\.5-coder:7b/, /coder:7b|coder:6\.7b|coder:8b/, /coder/, /qwen3\.5:4b/],
  general: [/qwen3\.5:4b/, /qwen3:8b/, /llama3\.[12]:8b|gemma3:4b|gemma3n/, /qwen|llama|gemma|mistral|phi/],
  quick: [/qwen3\.5:4b/, /:(1|1\.5|2|3|4)b/, /qwen|llama|gemma|phi/],
};

export function localModels(): string[] {
  return extraModels()
    .filter((m) => m.local)
    .map((m) => m.id);
}

export function localModelFor(kind: JobKind): string | null {
  const list = localModels();
  if (!list.length) return null;
  for (const re of PREFER[kind]) {
    const hit = list.find((id) => re.test(id));
    if (hit) return hit;
  }
  return list[0];
}

// What kind of job a model or teammate does, so the right local model is used instead.
export function kindFor(model: string, role = ''): JobKind {
  if (/engineer|code|build|program|unreal|developer|tech/i.test(role) || /coder|codex/i.test(model)) return 'code';
  if (/haiku|flash-lite|mini|nano/i.test(model)) return 'quick';
  return 'general';
}

export const offlineStatus = () => ({
  mode,
  internetUp,
  offline: isOffline(),
  changedAt: changedAt ? new Date(changedAt).toISOString() : undefined,
  models: { general: localModelFor('general'), code: localModelFor('code'), quick: localModelFor('quick') },
  localCount: localModels().length,
});

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerOfflineRoutes(app: Express) {
  app.get('/api/offline', (_req, res) => res.json(offlineStatus()));
  app.post('/api/offline', (req, res) => {
    if (!isLocal(req)) return res.status(403).json({ error: 'Only from this computer.' });
    const next = req.body?.mode;
    if (next !== 'auto' && next !== 'on' && next !== 'off') return res.status(400).json({ error: 'Pick auto, on or off.' });
    const before = isOffline();
    mode = next;
    try {
      fs.writeFileSync(FILE, JSON.stringify({ mode }), 'utf-8');
    } catch {}
    logActivity('info', `Offline mode set to ${mode === 'auto' ? 'automatic' : mode === 'on' ? 'always offline' : 'never'}.`);
    if (before !== isOffline()) {
      changedAt = Date.now();
      for (const fn of listeners) fn(isOffline());
    }
    res.json(offlineStatus());
  });
}
