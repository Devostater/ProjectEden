// Activity log: a short running record of what the hub and the AI team are doing, shown in the
// bottom panel. The last 500 lines are saved to activity-log.json in your user folder (.eden-hub, next to
// the backups) and read back at launch, so the log survives a restart.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express } from 'express';

export type ActivityKind = 'info' | 'work' | 'done' | 'error';

// What can be tried again from an error line: a task card, a Code update, or a message to LYRA.
export interface ActivityRetry {
  kind: 'card' | 'update' | 'lyra';
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
  text: string; // the short version (first 300 characters), shown by default and used everywhere else
  full?: string; // the whole message (up to 1000 characters); only saved when it is longer than `text`
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

const MAX = 500;
const SHORT_TEXT = 300; // characters shown on the line by default
const FULL_TEXT = 1000; // most characters kept of one message
const LOG_FILE = path.join(os.homedir(), '.eden-hub', 'activity-log.json');
const entries: Entry[] = [];
let nextId = 1;
let sessionStart = 1; // the first line id written in this launch; anything before it is from an earlier session
let saveTimer: NodeJS.Timeout | null = null;

// Write the log now (also used when the hub stops, so the last second of lines isn't lost).
function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const tmp = `${LOG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries.slice(-MAX)), 'utf-8');
    fs.renameSync(tmp, LOG_FILE);
  } catch (err: any) {
    fileProblem('save the activity log', err);
  }
}
const scheduleSave = () => {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 1000);
};
process.on('exit', () => {
  if (saveTimer) saveNow();
});

// `reason` is just the failure message (so a card title can't be mistaken for one); `retry` says what a
// Retry button should run again.
export function logActivity(kind: ActivityKind, text: string, extra?: { reason?: string; retry?: ActivityRetry }) {
  const oneLine = text.replace(/\s+/g, ' ');
  const entry: Entry = { id: nextId++, at: new Date().toISOString(), kind, text: oneLine.slice(0, SHORT_TEXT) };
  // Keep the whole message too (capped), so a long error can be opened and copied from the panel.
  if (oneLine.length > SHORT_TEXT) entry.full = oneLine.slice(0, FULL_TEXT);
  if (kind === 'error') {
    const hint = explainFailure(extra?.reason ?? text);
    if (hint) entry.hint = hint;
    if (extra?.retry) entry.retry = extra.retry;
  }
  entries.push(entry);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  scheduleSave();
  for (const fn of listeners) {
    try {
      fn(kind, entry.text);
    } catch {}
  }
}

// For the hub's own data files: say in the log when one can't be loaded or saved, instead of failing silently.
// A missing file is normal (first run), and the same problem is reported at most once every ten minutes.
const reported = new Map<string, number>();
export function fileProblem(what: string, err: any) {
  if (err?.code === 'ENOENT') return;
  if (Date.now() - (reported.get(what) || 0) < 10 * 60 * 1000) return;
  reported.set(what, Date.now());
  logActivity('error', `Could not ${what}: ${err?.message || err}`);
}

// Other parts of the hub can follow the log (e.g. sending "needs you" alerts to your phone).
const listeners: ((kind: ActivityKind, text: string) => void)[] = [];
export const onActivity = (fn: (kind: ActivityKind, text: string) => void) => void listeners.push(fn);

// Load the saved lines from the last launch. Ids carry on after the saved ones, so `since` keeps working.
// (This sits below `listeners` and `reported` because a load problem is itself written to the log.)
try {
  const saved = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  const kinds = ['info', 'work', 'done', 'error'];
  if (Array.isArray(saved)) {
    for (const e of saved) {
      if (e && Number.isInteger(e.id) && e.id > 0 && typeof e.at === 'string' && kinds.includes(e.kind) && typeof e.text === 'string') {
        // Older logs have no `full`; ignore it if it's anything but text.
        if (typeof e.full !== 'string') delete e.full;
        else e.full = e.full.slice(0, FULL_TEXT);
        entries.push(e as Entry);
      }
    }
    entries.splice(0, Math.max(0, entries.length - MAX));
    nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    sessionStart = nextId;
  }
} catch (err: any) {
  if (err?.code !== 'ENOENT') fileProblem('load the activity log', err);
}

// The latest lines (for the AI suggesting app updates: what went wrong recently).
export const recentActivity = (n = 60) => entries.slice(-n).map((e) => `${e.at.slice(0, 16)} [${e.kind}] ${e.text}`);

export function registerActivityRoutes(app: Express) {
  // `since` is the last id the page already has; only newer lines come back.
  app.get('/api/activity', (req, res) => {
    const since = Number(req.query.since) || 0;
    res.json({ entries: entries.filter((e) => e.id > since), latest: nextId - 1, sessionStart });
  });
}
