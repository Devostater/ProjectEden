// Running low on an AI plan.
//   - A yellow warning shows in the hub when a connected plan passes 85% of its limit (the page works that out
//     from the same figures as the usage bars).
//   - "Pause AI automatically at 95%" (Account → Connections): when it's on, the hub itself pauses the team the
//     moment a plan crosses 95%, even with every page closed. It pauses once per crossing: if you press Resume AI
//     while the plan is still over, it stays resumed until the plan drops back under and crosses again.
// Only your plans count (Claude, ChatGPT, Gemini). LYRA and the free AIs run on this PC or on free tiers.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { providerUsage } from './providers';
import { aiPaused, setPaused } from './control';
import { fileProblem } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-usage-guard.json');
export const WARN_PERCENT = 85;
export const PAUSE_PERCENT = 95;
const PLANS = ['anthropic', 'openai', 'google'];

let state: { autoPause: boolean; handled: string[] } = { autoPause: false, handled: [] };
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  state = { autoPause: saved.autoPause === true, handled: Array.isArray(saved.handled) ? saved.handled.filter((x: unknown) => typeof x === 'string') : [] };
} catch (err: any) {
  fileProblem('load the "Pause AI at 95%" setting', err);
}
const save = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err: any) {
    fileProblem('save the "Pause AI at 95%" setting', err);
  }
};

type Usage = ReturnType<typeof providerUsage>[number];
// How much of its limit an AI has used (0-100): the plan's own figure when it reports one, otherwise this hub's
// daily message budget. The usage bars use the same sum, so the two always agree.
export function usagePercent(u: Usage): number {
  const real = u.real?.source === 'plan' ? u.real : undefined;
  const limited = !!real?.limited || !!u.limitNote;
  return real?.usedPercent !== undefined ? real.usedPercent : limited ? 100 : Math.min(100, Math.round((u.messages / u.limit) * 100));
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function check() {
  let usage: Usage[] = [];
  try {
    usage = providerUsage().filter((u) => u.mode !== 'off' && PLANS.includes(u.provider));
  } catch {
    return;
  }
  const over = usage.filter((u) => usagePercent(u) >= PAUSE_PERCENT);
  const still = state.handled.filter((id) => over.some((u) => u.provider === id));
  const fresh = state.autoPause ? over.filter((u) => !still.includes(u.provider)) : [];
  const changed = still.length !== state.handled.length || fresh.length > 0;
  state.handled = [...still, ...fresh.map((u) => u.provider)];
  if (fresh.length && !aiPaused()) {
    const what = fresh.map((u) => (usagePercent(u) >= 100 ? `${u.name} is used up` : `${u.name} is almost at its limit`));
    setPaused(true, `Paused: ${list(what)}. Press Resume AI when you want the team to carry on.`);
  }
  if (changed) save();
}

export function registerUsageGuard(app: Express) {
  setTimeout(check, 20000).unref?.();
  setInterval(check, 60000).unref?.();

  app.get('/api/usage-guard', (_req, res) => {
    res.json({ autoPause: state.autoPause, warnPercent: WARN_PERCENT, pausePercent: PAUSE_PERCENT, pausedFor: state.autoPause ? state.handled : [] });
  });
  app.post('/api/usage-guard', (req, res) => {
    if (typeof req.body?.autoPause !== 'boolean') return res.status(400).json({ error: 'Say whether it should be on or off.' });
    state.autoPause = req.body.autoPause;
    // Switching it off forgets what it had already paused for, so switching it back on starts fresh.
    if (!state.autoPause) state.handled = [];
    save();
    if (state.autoPause) check();
    res.json({ autoPause: state.autoPause, pausedFor: state.autoPause ? state.handled : [] });
  });
}
