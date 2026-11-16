// "Pause AI": one switch that stops the team working on its own. While paused:
//   - running Nexus discussions stop after the message being written, and no new ones start;
//   - the card runner starts no new cards (a card already being written finishes and lands in Review).
// Chat is not affected: a chat message is you asking directly.
// The setting is saved, so the hub stays paused after a restart.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import { logActivity, fileProblem } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-control.json');

let paused = false;
// True while the pause was put on by a running code update (not by you). Only then is it lifted by itself.
let heldForUpdate = false;
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  paused = !!saved.paused;
  heldForUpdate = paused && !!saved.heldForUpdate;
} catch (err: any) {
  fileProblem('load the Pause AI setting', err);
}

const listeners: Array<(paused: boolean) => void> = [];

export const aiPaused = () => paused;

// Pause or resume from code (e.g. when the main server moves to another device).
const saveControl = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ paused, heldForUpdate }), 'utf-8');
  } catch (err: any) {
    fileProblem('save the Pause AI setting', err);
  }
};

// Code updates change the code the team is working on, so while one runs the team's project work waits.
// Called with true when an update starts and false when none are left. A pause you set yourself is never lifted here.
export function holdForUpdates(running: boolean) {
  if (running && !paused) {
    heldForUpdate = true;
    setPaused(true, 'AI paused while a code update runs, so Eden projects stop working on code that is changing. It resumes by itself when the updates finish.');
  } else if (!running && heldForUpdate) {
    heldForUpdate = false;
    setPaused(false, 'AI resumed: code updates finished.');
  }
}
export const pausedForUpdate = () => heldForUpdate;

export function setPaused(next: boolean, note?: string) {
  if (next === paused) return;
  paused = next;
  if (!paused) heldForUpdate = false;
  try {
    fs.writeFileSync(FILE, JSON.stringify({ paused, heldForUpdate }), 'utf-8');
  } catch (err: any) {
    fileProblem('save the Pause AI setting', err);
  }
  logActivity(paused ? 'info' : 'done', note ||(paused ? 'AI paused.' : 'AI resumed.'));
  for (const fn of listeners) fn(paused);
}
export const onPauseChange = (fn: (paused: boolean) => void) => listeners.push(fn);

export function registerControlRoutes(app: Express, runningCount: () => { cards: number; rooms: number }) {
  app.get('/api/ai/pause', (_req, res) => {
    res.json({ paused, heldForUpdate, running: runningCount() });
  });

  app.post('/api/ai/pause', (req, res) => {
    const next = !!req.body?.paused;
    if (next !== paused || heldForUpdate) {
      paused = next;
      heldForUpdate = false; // your choice now: a finishing update won't undo it
      saveControl();
      logActivity(paused ? 'info' : 'done', paused ? 'AI paused: discussions stopped and no new card work will start.' : 'AI resumed.');
      for (const fn of listeners) fn(paused);
    }
    res.json({ paused, heldForUpdate, running: runningCount() });
  });
}
