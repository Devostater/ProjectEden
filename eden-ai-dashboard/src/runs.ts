// Runs: every time a plan is turned into cards (from Nexus or "Plan with Chief") those cards form one
// run, so they can be shown or hidden together. Cards added by hand form the "Added by hand" line.
import type { Card } from './types/index.ts';

export const MANUAL_RUN = 'manual';

// The run a card belongs to. Older cards without a run id are grouped by the plan they came from.
export function runKey(card: Card): string {
  const s = card.source;
  if (!s) return MANUAL_RUN;
  if (s.runId) return s.runId;
  if (s.kind === 'nexus') return `nexus:${s.roomId || ''}:${s.messageSeq ?? ''}`;
  return `plan:${s.label || ''}`;
}

export interface RunInfo {
  key: string;
  kind: 'nexus' | 'plan' | 'manual';
  title: string;
  at: string; // when it was made (earliest card)
  total: number;
  done: number;
  review: number;
  running: boolean;
}

export function runsOf(cards: Card[]): RunInfo[] {
  const map = new Map<string, RunInfo>();
  for (const c of cards) {
    const key = runKey(c);
    let r = map.get(key);
    if (!r) {
      const s = c.source;
      r = {
        key,
        kind: s ? s.kind : 'manual',
        title: !s ? 'Added by hand' : s.kind === 'nexus' ? `Nexus · ${s.roomName || 'a room'}` : s.label || 'Plan with Chief',
        at: s?.at || c.createdAt,
        total: 0,
        done: 0,
        review: 0,
        running: false,
      };
      map.set(key, r);
    }
    r.total += 1;
    if (c.column === 'done') r.done += 1;
    if (c.column === 'review') r.review += 1;
    if (c.runState === 'running') r.running = true;
    const at = c.source?.at || c.createdAt;
    if (at < r.at) r.at = at;
  }
  // Newest runs first; hand-made cards last.
  return [...map.values()].sort((a, b) => (a.key === MANUAL_RUN ? 1 : b.key === MANUAL_RUN ? -1 : b.at.localeCompare(a.at)));
}
