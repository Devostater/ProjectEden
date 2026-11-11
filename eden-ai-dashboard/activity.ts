// Activity log: a short running record of what the hub and the AI team are doing, shown in the
// bottom panel. Kept in memory only (the last few hundred lines), so it starts empty on each launch.
import type { Express } from 'express';

export type ActivityKind = 'info' | 'work' | 'done' | 'error';

interface Entry {
  id: number;
  at: string;
  kind: ActivityKind;
  text: string;
}

const MAX = 300;
const entries: Entry[] = [];
let nextId = 1;

export function logActivity(kind: ActivityKind, text: string) {
  entries.push({ id: nextId++, at: new Date().toISOString(), kind, text: text.replace(/\s+/g, ' ').slice(0, 300) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export function registerActivityRoutes(app: Express) {
  // `since` is the last id the page already has; only newer lines come back.
  app.get('/api/activity', (req, res) => {
    const since = Number(req.query.since) || 0;
    res.json({ entries: entries.filter((e) => e.id > since), latest: nextId - 1 });
  });
}
