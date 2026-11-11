// Activity log: a short running record of what the hub and the AI team are doing, shown in the
// bottom panel. Kept in memory only (the last few hundred lines), so it starts empty on each launch.
import type { Express } from 'express';

export type ActivityKind = 'info' | 'work' | 'done' | 'error';

// What can be tried again from an error line: a task card, or a Code update.
export interface ActivityRetry {
  kind: 'card' | 'update';
  id: string;
}

// A plain one-line explanation and a suggested action for a common failure.
export interface ActivityHint {
  explain: string;
  action: string;
}

interface Entry {
  id: number;
  at: string;
  kind: ActivityKind;
  text: string;
  hint?: ActivityHint; // only on [error] lines we recognise
  retry?: ActivityRetry; // only when the task can be tried again
}

// Common failures, checked in order (the first match wins). Anything not listed gets no hint.
const FAILURES: { test: RegExp; hint: ActivityHint }[] = [
  {
    test: /git\b.*\bcommit|commit\b.*\b(fail|error|couldn)|nothing to commit|pre-commit/i,
    hint: { explain: "The change couldn't be saved to your project history (git commit).", action: 'Check that git is set up for this folder and nothing else is using it, then try again.' },
  },
  {
    test: /patch|hunk|(couldn'?t|could not|failed to|unable to) apply|did not apply|does not apply/i,
    hint: { explain: "The AI's change no longer fits the current code, so it couldn't be applied.", action: 'Try again so the AI works from the latest code.' },
  },
  {
    test: /rate.?limit|too many requests|\b429\b|quota|usage (limit|cap)|resource.?exhausted|messages left|budget/i,
    hint: { explain: 'This AI has hit its usage limit for now.', action: 'Wait a little, or connect another AI in Account → Connections, then try again.' },
  },
  {
    test: /api.?key|no ai is available|not connected|missing.*key|key.*missing|invalid.*key|unauthori[sz]ed|\b401\b|\b403\b/i,
    hint: { explain: "The AI's key is missing or isn't accepted.", action: 'Add or fix the key in Account → Connections, then try again.' },
  },
  {
    test: /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|offline|couldn'?t be reached|could not reach|timed out/i,
    hint: { explain: "The hub couldn't reach the internet or the AI service.", action: 'Check this computer is online, then try again.' },
  },
];

export const explainFailure = (text: string): ActivityHint | undefined => FAILURES.find((f) => f.test.test(text))?.hint;

const MAX = 300;
const entries: Entry[] = [];
let nextId = 1;

// `reason` is just the failure message (so a card title can't be mistaken for one); `retry` says what a
// Retry button should run again.
export function logActivity(kind: ActivityKind, text: string, extra?: { reason?: string; retry?: ActivityRetry }) {
  const entry: Entry = { id: nextId++, at: new Date().toISOString(), kind, text: text.replace(/\s+/g, ' ').slice(0, 300) };
  if (kind === 'error') {
    const hint = explainFailure(extra?.reason ?? text);
    if (hint) entry.hint = hint;
    if (extra?.retry) entry.retry = extra.retry;
  }
  entries.push(entry);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  for (const fn of listeners) {
    try {
      fn(kind, entry.text);
    } catch {}
  }
}

// Other parts of the hub can follow the log (e.g. sending "needs you" alerts to your phone).
const listeners: ((kind: ActivityKind, text: string) => void)[] = [];
export const onActivity = (fn: (kind: ActivityKind, text: string) => void) => void listeners.push(fn);

// The latest lines (for the AI suggesting app updates: what went wrong recently).
export const recentActivity = (n = 60) => entries.slice(-n).map((e) => `${e.at.slice(0, 16)} [${e.kind}] ${e.text}`);

export function registerActivityRoutes(app: Express) {
  // `since` is the last id the page already has; only newer lines come back.
  app.get('/api/activity', (req, res) => {
    const since = Number(req.query.since) || 0;
    res.json({ entries: entries.filter((e) => e.id > since), latest: nextId - 1 });
  });
}
