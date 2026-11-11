// "Pause AI": one switch that stops the team working on its own. While paused:
//   - running Nexus discussions stop after the message being written, and no new ones start;
//   - the card runner starts no new cards (a card already being written finishes and lands in Review).
// Chat is not affected: a chat message is you asking directly.
// The setting is saved, so the hub stays paused after a restart.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { logActivity } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-control.json');

let paused = false;
try {
  paused = !!JSON.parse(fs.readFileSync(FILE, 'utf-8')).paused;
} catch {}

const listeners: Array<(paused: boolean) => void> = [];

export const aiPaused = () => paused;
export const onPauseChange = (fn: (paused: boolean) => void) => listeners.push(fn);

export function registerControlRoutes(app: Express, runningCount: () => { cards: number; rooms: number }) {
  app.get('/api/ai/pause', (_req, res) => {
    res.json({ paused, running: runningCount() });
  });

  app.post('/api/ai/pause', (req, res) => {
    const next = !!req.body?.paused;
    if (next !== paused) {
      paused = next;
      try {
        fs.writeFileSync(FILE, JSON.stringify({ paused }), 'utf-8');
      } catch {}
      logActivity(paused ? 'error' : 'done', paused ? 'AI paused: discussions stopped and no new card work will start.' : 'AI resumed.');
      for (const fn of listeners) fn(paused);
    }
    res.json({ paused, running: runningCount() });
  });
}
