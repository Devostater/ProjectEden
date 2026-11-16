// Easy fixes for Code updates that went wrong. Each failed update is read once and given a plain-words reason
// and one button that does the right thing for that kind of failure. "Fix all" runs the same buttons for every
// failed update in one go (see UpdatesView).

export interface FixableJob {
  id: string;
  request: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
  check?: { ok: boolean; output: string };
  interrupted?: boolean;
  stale?: boolean;
  local?: boolean;
  retriedAs?: string;
  codebaseId?: string;
}

// What the button does:
//   retry      - start it again as it is
//   retryClaude - start it again on your Claude plan instead of the AI on this PC
//   fixChecks  - start it again with the checks that failed last time added, so the AI fixes them
//   discard    - clear it away (nothing left to do, or the same request is already in the list)
//   wait       - out of AI usage: nothing to do until the limit resets
export type FixAction = 'retry' | 'retryClaude' | 'fixChecks' | 'discard' | 'wait';

export interface Fix {
  kind: string;
  reason: string; // plain words: what went wrong
  action: FixAction;
  label: string; // the button
}

export const USAGE_LIMIT = /hit your .*limit|usage limit|rate.?limit|too many requests/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Minutes a time zone is ahead of UTC at a moment (e.g. -480 for Los Angeles in winter). No or unknown zone: this PC's.
function zoneOffsetMin(zone: string | undefined, at: number): number {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: zone || undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(at));
    const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return Math.round((Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - at) / 60_000);
  } catch {
    return -new Date(at).getTimezoneOffset();
  }
}

// When a usage limit message says it resets, as a time in ms. `at` is when the message was written.
// Understands "resets 5am", "resets 5:30pm (America/Los_Angeles)" and "resets Nov 20". Anything else: 5 hours later.
export function limitResetsAt(text: string, at: string): number {
  const when = new Date(at).getTime();
  if (Number.isNaN(when)) return 0;
  const clock = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b\s*(?:\(([^)]+)\))?/i);
  if (clock) {
    const resetMin = ((Number(clock[1]) % 12) + (clock[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(clock[2] || 0);
    let atMin: number;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: clock[4] || undefined, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(when));
      atMin = Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
    } catch {
      const d = new Date(when); // unknown time zone name: use this PC's
      atMin = d.getHours() * 60 + d.getMinutes();
    }
    const wait = (resetMin - atMin + 1440) % 1440 || 1440;
    return when + wait * 60_000;
  }
  // "resets Nov 20" or "resets Nov 20, 5pm (America/Los_Angeles)"
  const day = text.match(/resets?\s+(?:on\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b(?:,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b)?\s*(?:\(([^)]+)\))?/i);
  const month = day ? MONTHS.indexOf(day[1].toLowerCase()) : -1;
  if (day && month >= 0) {
    const year = new Date(when).getUTCFullYear();
    const hour = day[3] ? (Number(day[3]) % 12) + (day[5].toLowerCase() === 'pm' ? 12 : 0) : 24; // no time given: the end of that day
    const minute = Number(day[4] || 0);
    const at = (y: number) => {
      const guess = Date.UTC(y, month, Number(day[2]), hour, minute); // that wall-clock time as if it were UTC…
      return guess - zoneOffsetMin(day[6], guess) * 60_000; // …moved by the zone's offset on that date
    };
    let t = at(year);
    if (t < when - 86_400_000) t = at(year + 1); // "resets Jan 2" written in December
    return t;
  }
  return when + 5 * 3_600_000;
}

// An error without the AI's own last words quoted in it ('… It said: "…"'): those can mention anything, such as
// "rate limit" or "timed out" in a request about those things, and must not be mistaken for the reason it failed.
export const whatWentWrong = (error?: string) => (error || '').replace(/ It said: "[\s\S]*$/, '');

// True while a usage limit hit at `at` is still in force.
export const limitStillOn = (text: string, at: string, now = Date.now()) => {
  const t = whatWentWrong(text);
  return USAGE_LIMIT.test(t) && now < limitResetsAt(t, at);
};

// The same request, ignoring spacing, case and the "Last time this failed" note a fix may have added.
export const sameRequest = (a: string, b: string) => {
  const norm = (s: string) => s.split('\n\nLast time this failed:')[0].replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
};

// `jobs` is the whole list, newest first (as the hub sends it). Returns null when there is nothing to fix:
// only failed updates, and finished ones whose checks failed (they wait in Active with "Apply anyway"), get a fix.
export function diagnose(job: FixableJob, jobs: FixableJob[], now = Date.now()): Fix | null {
  const checksFailed = job.status === 'ready' && !!job.check && !job.check.ok;
  if (job.status !== 'failed' && !checksFailed) return null;
  const err = whatWentWrong(job.error);

  // Another copy of the same request makes this one unnecessary: one waiting or running now, or a newer one
  // (failed, finished or applied). An applied copy from before this one was asked doesn't count: asking the
  // same thing again after it was done means you want it done again.
  const twin = jobs.find(
    (j) =>
      j.id !== job.id &&
      sameRequest(j.request, job.request) &&
      (['queued', 'working', 'checking'].includes(j.status) || (['failed', 'ready', 'applied'].includes(j.status) && j.createdAt > job.createdAt))
  );
  if (twin) {
    const where = ['queued', 'working', 'checking'].includes(twin.status) ? 'The same request is already waiting or running' : twin.status === 'applied' ? 'A newer copy of this request was already applied' : 'A newer copy of this request is also in the list';
    return { kind: 'duplicate', reason: `${where}, so this one isn't needed.`, action: 'discard', label: 'Clear the extra copy' };
  }

  if (checksFailed) {
    return { kind: 'checks', reason: "The AI's change didn't pass the checks, so applying it would likely break things. It can redo it knowing exactly what failed.", action: 'fixChecks', label: 'Ask the AI to fix it' };
  }

  if (USAGE_LIMIT.test(err)) {
    const at = job.finishedAt || job.createdAt;
    if (now >= limitResetsAt(err, at)) {
      return { kind: 'usage-reset', reason: 'It ran out of Claude usage, but the limit has reset since, so it can run now.', action: 'retry', label: 'Run it again' };
    }
    const until = new Date(limitResetsAt(err, at)).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return { kind: 'usage', reason: `Out of Claude usage until about ${until}. Trying again before then fails the same way.`, action: 'wait', label: 'Try again anyway' };
  }

  if (/is not recognized|command not found|ENOENT.*claude|spawn claude/i.test(err)) {
    return { kind: 'claude-missing', reason: "Eden couldn't start Claude when this ran. That's fixed now, so it can simply run again.", action: 'retry', label: 'Run it again' };
  }

  if (/unrecognized_model|model.*not (found|supported)|no AI on this PC/i.test(err)) {
    return { kind: 'local-model', reason: "The AI on this PC can't do code updates (its model isn't supported for this). Your Claude plan can.", action: 'retryClaude', label: 'Run it with Claude' };
  }

  if (/finished without changing anything|nothing (was )?changed|no changes/i.test(err)) {
    return { kind: 'no-change', reason: 'The AI looked and found nothing to change. It is probably already done.', action: 'discard', label: 'Clear it' };
  }

  if (/old working copy|worktree.*(already exists|is a missing but locked)|already checked out/i.test(err)) {
    return { kind: 'leftover-copy', reason: 'A leftover copy from an earlier try got in the way. Eden now clears those before it starts.', action: 'retry', label: 'Clean up and run again' };
  }

  if ((job.check && !job.check.ok) || /checks? failed|error TS\d+|type.?check/i.test(err)) {
    return { kind: 'checks', reason: "The AI's change didn't pass the checks. It can try again knowing exactly what failed.", action: 'fixChecks', label: 'Ask the AI to fix it' };
  }

  if (job.interrupted || /hub restarted|interrupted/i.test(err)) {
    return { kind: 'interrupted', reason: 'Eden restarted while this was running, so it stopped partway.', action: 'retry', label: 'Run it again' };
  }

  if (/timed? ?out|took (too|longer) long|took longer than|was stopped after/i.test(err)) {
    return { kind: 'timeout', reason: 'It ran out of time. A second run often finishes, or split the request into smaller ones.', action: 'retry', label: 'Run it again' };
  }

  if (/offline|internet|network|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(err)) {
    return { kind: 'network', reason: "The internet dropped while it ran.", action: 'retry', label: 'Run it again' };
  }

  return { kind: 'other', reason: 'Something else went wrong. The AI will get what it said last time so it can avoid it.', action: 'fixChecks', label: 'Ask the AI to fix it' };
}

// What "Last time this failed" tells the AI on a fixChecks run: the failed checks, else the error itself.
export function failureNote(job: FixableJob): string {
  const parts: string[] = [];
  if (job.check && !job.check.ok && job.check.output) parts.push(`The checks failed:\n${job.check.output.slice(-2500)}`);
  if (job.error) parts.push(job.error.slice(0, 1200));
  return parts.join('\n\n').slice(0, 3000);
}

// Carries out one fix through the hub's own routes. Throws if the hub refuses; returns the new update's id when
// the fix started it again. `post` sends a JSON POST and throws with the hub's message on an error answer.
export async function applyFix(job: FixableJob, fix: Fix, post: (url: string, body?: unknown) => Promise<any>): Promise<string | undefined> {
  if (fix.action === 'discard') {
    await post(`/api/updates/${job.id}/discard`);
    return undefined;
  }
  // One call even for a finished update whose checks failed: the hub clears the old one only once the new one
  // has started, so if it refuses, nothing is lost.
  const body = fix.action === 'retryClaude' ? { useClaude: true } : fix.action === 'fixChecks' ? { note: failureNote(job) } : {};
  const d = await post(`/api/updates/${job.id}/retry`, body);
  return d?.job?.id;
}

// Whether the button can work right now: anything that runs the AI needs Claude, except a rerun on this PC's AI.
export const canFix = (job: FixableJob, fix: Fix, claudeReady: boolean) => fix.action === 'discard' || claudeReady || (fix.action === 'retry' && job.local === true);

// The plan "Fix all" shows before it runs: what happens to each failed update. `blocked` ones would run the AI
// but can't right now (Claude isn't signed in), so Fix all leaves them and says so.
export function planFixAll(jobs: FixableJob[], now = Date.now(), claudeReady = true) {
  const plan = jobs
    .map((j) => ({ job: j, fix: diagnose(j, jobs, now) }))
    .filter((p): p is { job: FixableJob; fix: Fix } => !!p.fix)
    .map((p) => ({ ...p, blocked: p.fix.action !== 'wait' && !canFix(p.job, p.fix, claudeReady) }));
  const runs = plan.filter((p) => !p.blocked && (p.fix.action === 'retry' || p.fix.action === 'retryClaude' || p.fix.action === 'fixChecks'));
  return {
    plan,
    run: runs.length,
    fixChecks: runs.filter((p) => p.fix.action === 'fixChecks').length,
    clear: plan.filter((p) => p.fix.action === 'discard').length,
    waiting: plan.filter((p) => p.fix.action === 'wait').length,
    blocked: plan.filter((p) => p.blocked).length,
  };
}
