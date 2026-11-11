// Real plan limits, read from what the AI tools themselves record on this computer. Nothing is sent
// anywhere and no AI message is spent:
//   ChatGPT: the Codex tool logs the plan's rate limits (percent used and reset time) in
//            ~/.codex/sessions/**.jsonl after each request.
//   Claude:  Claude Code logs when a plan limit is hit (which window, and when it resets) in
//            ~/.claude/projects/**.jsonl. It doesn't log how close you are before that.
//   Gemini:  the free API key reports nothing until a request is refused; the hub keeps that message.
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface RealLimit {
  source: 'plan' | 'none';
  usedPercent?: number; // 0-100, when the tool reports it
  window?: string; // "5-hour", "weekly"…
  resetsAt?: number; // epoch ms
  limited?: boolean; // the plan says it is used up right now
  plan?: string;
  checkedAt: number;
}

const windowName = (minutes?: number) =>
  !minutes ? undefined : minutes === 300 ? '5-hour' : minutes === 10080 ? 'weekly' : minutes >= 1440 ? `${Math.round(minutes / 1440)}-day` : `${Math.round(minutes / 60)}-hour`;

// Newest files first, from a few directory levels down.
function newestFiles(root: string, ext: string, max: number, depth = 4): string[] {
  const found: { file: string; time: number }[] = [];
  const walk = (dir: string, d: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && d > 0) walk(p, d - 1);
      else if (e.isFile() && e.name.endsWith(ext)) {
        try {
          found.push({ file: p, time: fs.statSync(p).mtimeMs });
        } catch {}
      }
    }
  };
  walk(root, depth);
  return found.sort((a, b) => b.time - a.time).slice(0, max).map((f) => f.file);
}

// The last part of a file (these logs can be large; the newest records are at the end).
function tail(file: string, bytes = 400_000): string {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function chatgpt(): RealLimit {
  const now = Date.now();
  for (const file of newestFiles(path.join(os.homedir(), '.codex', 'sessions'), '.jsonl', 12)) {
    const text = tail(file);
    const matches = [...text.matchAll(/"rate_limits":(\{.*?"rate_limit_reached_type":[^}]*\})/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(matches[i][1]);
        const windows = [r.primary, r.secondary].filter((w: any) => w && typeof w.used_percent === 'number');
        if (!windows.length) continue;
        // The window closest to its limit is the one that matters.
        const w = windows.sort((a: any, b: any) => b.used_percent - a.used_percent)[0];
        const resetsAt = w.resets_at ? w.resets_at * 1000 : undefined;
        const expired = resetsAt !== undefined && resetsAt <= now;
        return {
          source: 'plan',
          usedPercent: expired ? 0 : Math.round(w.used_percent),
          window: windowName(w.window_minutes),
          resetsAt: expired ? undefined : resetsAt,
          limited: !expired && w.used_percent >= 100,
          plan: r.plan_type || undefined,
          checkedAt: now,
        };
      } catch {}
    }
  }
  return { source: 'none', checkedAt: now };
}

function claude(): RealLimit {
  const now = Date.now();
  let latest: { at: number; info: any } | null = null;
  for (const file of newestFiles(path.join(os.homedir(), '.claude', 'projects'), '.jsonl', 25, 2)) {
    const text = tail(file, 250_000);
    for (const m of text.matchAll(/"timestamp":"([^"]+)"[^\n]*?"quotaLimits":(\{[^{}]*\})/g)) {
      const at = Date.parse(m[1]);
      if (!latest || at > latest.at) {
        try {
          latest = { at, info: JSON.parse(m[2]) };
        } catch {}
      }
    }
  }
  if (!latest) return { source: 'none', checkedAt: now };
  const resetsAt = latest.info.resetsAt ? latest.info.resetsAt * 1000 : undefined;
  const limited = latest.info.status === 'rejected' && !!resetsAt && resetsAt > now;
  return {
    source: limited ? 'plan' : 'none',
    limited,
    resetsAt: limited ? resetsAt : undefined,
    window: (latest.info.rateLimitType || '').replace('five_hour', '5-hour').replace('seven_day', 'weekly') || undefined,
    checkedAt: now,
  };
}

let cache: { at: number; limits: Record<string, RealLimit> } | null = null;

// Re-reads at most once a minute unless asked to refresh.
export function realLimits(refresh = false): Record<'anthropic' | 'openai', RealLimit> {
  if (!refresh && cache && Date.now() - cache.at < 60_000) return cache.limits as any;
  const limits = { anthropic: claude(), openai: chatgpt() };
  cache = { at: Date.now(), limits };
  return limits;
}
