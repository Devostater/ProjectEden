// Points and achievements earned by using the Eden IDE itself (projects, cards, workflows, team, chat, coming back).
// The four profile stats (Creativity, Logic, Charm, Luck) are worked out from this, so they cannot be typed in.
// Counts only ever go up (deleting a project does not take points away). Saved on this device only.
import { useEffect, useState } from 'react';
import { PAGES } from './pages.tsx';

const ACTIVITY_KEY = 'eden_activity';
const UNLOCKED_KEY = 'eden_unlocked';
const NOTICE_KEY = 'eden_achievement_notices';
// After 'Start again': the totals seen at that moment, counted from zero from then on (so a reset really resets).
const BASELINE_KEY = 'eden_activity_baseline';
// The latest real totals (a snapshot where something has loaded), so 'Start again' can use the totals of that moment as
// the new zero right away, even before a reload. Startup zeros (before the hub's data arrives) never replace it.
const SEEN_KEY = 'eden_activity_seen';
export const ACTIVITY_EVENT = 'eden-activity';
export const UNLOCK_EVENT = 'eden-unlocked';

export interface Activity {
  projects: number; // projects made
  cards: number; // cards on project boards
  doneCards: number; // cards finished
  workflows: number;
  teammates: number; // AI teammates on your team
  rooms: number; // Nexus rooms
  files: number; // files saved in Files
  chatMessages: number; // messages you sent in Chat
  days: string[]; // each day you opened the hub (YYYY-MM-DD)
  pages: string[]; // each page you have opened
}

const NUMBERS = ['projects', 'cards', 'doneCards', 'workflows', 'teammates', 'rooms', 'files', 'chatMessages'] as const;
const EMPTY: Activity = { projects: 0, cards: 0, doneCards: 0, workflows: 0, teammates: 0, rooms: 0, files: 0, chatMessages: 0, days: [], pages: [] };

export function readActivity(): Activity {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '{}');
    const a: Activity = { ...EMPTY, days: [], pages: [] };
    for (const k of NUMBERS) if (typeof raw[k] === 'number' && isFinite(raw[k]) && raw[k] > 0) a[k] = Math.floor(raw[k]);
    if (Array.isArray(raw.days)) a.days = raw.days.filter((d: unknown) => typeof d === 'string').slice(-3650);
    if (Array.isArray(raw.pages)) a.pages = raw.pages.filter((d: unknown) => typeof d === 'string');
    return a;
  } catch {
    return { ...EMPTY, days: [], pages: [] };
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One way to earn points: how many points each thing is worth, and how to do it.
export interface Rule { how: string; per: number; count: (a: Activity) => number; unit: string }
export type StatKey = 'creativity' | 'logic' | 'charm' | 'luck';

export const STAT_RULES: Record<StatKey, Rule[]> = {
  creativity: [
    { how: 'Make a project (Projects page)', per: 3, count: (a) => a.projects, unit: 'projects' },
    { how: 'Add a card to a project board', per: 1, count: (a) => a.cards, unit: 'cards' },
    { how: 'Save a file (Files page)', per: 2, count: (a) => a.files, unit: 'files' },
  ],
  logic: [
    { how: 'Build a workflow (Workflows page)', per: 4, count: (a) => a.workflows, unit: 'workflows' },
    { how: 'Finish a card (move it to Done)', per: 2, count: (a) => a.doneCards, unit: 'finished cards' },
    { how: 'Unlock an achievement', per: 1, count: (a) => unlockedIds(a).length, unit: 'achievements' },
  ],
  charm: [
    { how: 'Add an AI teammate (Team page)', per: 3, count: (a) => a.teammates, unit: 'teammates' },
    { how: 'Start a room (Nexus page)', per: 3, count: (a) => a.rooms, unit: 'rooms' },
    { how: 'Send a message in Chat (2 messages = 1 point)', per: 0.5, count: (a) => a.chatMessages, unit: 'messages' },
  ],
  luck: [
    { how: 'Come back on a new day', per: 2, count: (a) => a.days.length, unit: 'days' },
    { how: 'Open a page for the first time', per: 2, count: (a) => a.pages.length, unit: 'pages' },
    { how: 'Unlock an achievement', per: 1, count: (a) => unlockedIds(a).length, unit: 'achievements' },
  ],
};

export const statPoints = (a: Activity, key: StatKey) => Math.floor(STAT_RULES[key].reduce((sum, r) => sum + r.per * r.count(a), 0));
// Every stat starts at 1 and goes up to 99.
export const statValue = (a: Activity, key: StatKey) => Math.min(99, 1 + statPoints(a, key));
export const earnedStats = (a: Activity) => ({ creativity: statValue(a, 'creativity'), logic: statValue(a, 'logic'), charm: statValue(a, 'charm'), luck: statValue(a, 'luck') });

export interface Achievement { id: string; title: string; how: string; test: (a: Activity) => boolean }
const atLeast = (key: (typeof NUMBERS)[number], n: number) => (a: Activity) => a[key] >= n;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-project', title: 'Fresh start', how: 'Make your first project.', test: atLeast('projects', 1) },
  { id: 'five-projects', title: 'Studio head', how: 'Make 5 projects.', test: atLeast('projects', 5) },
  { id: 'first-card', title: 'First idea', how: 'Add a card to a project board.', test: atLeast('cards', 1) },
  { id: 'twenty-cards', title: 'Planner', how: 'Add 20 cards to your boards.', test: atLeast('cards', 20) },
  { id: 'first-done', title: 'Done and dusted', how: 'Finish a card by moving it to Done.', test: atLeast('doneCards', 1) },
  { id: 'ten-done', title: 'Getting things shipped', how: 'Finish 10 cards.', test: atLeast('doneCards', 10) },
  { id: 'first-workflow', title: 'Pipeline builder', how: 'Build a workflow on the Workflows page.', test: atLeast('workflows', 1) },
  { id: 'first-file', title: 'Filing clerk', how: 'Save a file on the Files page.', test: atLeast('files', 1) },
  { id: 'first-teammate', title: 'Not alone', how: 'Have an AI teammate on your team.', test: atLeast('teammates', 1) },
  { id: 'three-teammates', title: 'A whole crew', how: 'Have 3 AI teammates on your team.', test: atLeast('teammates', 3) },
  { id: 'first-room', title: 'Round table', how: 'Start a room on the Nexus page.', test: atLeast('rooms', 1) },
  { id: 'chat-10', title: 'Chatty', how: 'Send 10 messages in Chat.', test: atLeast('chatMessages', 10) },
  { id: 'chat-100', title: 'Best friends', how: 'Send 100 messages in Chat.', test: atLeast('chatMessages', 100) },
  { id: 'days-3', title: 'Regular', how: 'Open the hub on 3 different days.', test: (a) => a.days.length >= 3 },
  { id: 'days-7', title: 'Part of the routine', how: 'Open the hub on 7 different days.', test: (a) => a.days.length >= 7 },
  { id: 'explorer', title: 'Explorer', how: 'Open 8 different pages.', test: (a) => a.pages.length >= 8 },
  { id: 'everywhere', title: 'Seen it all', how: 'Open every page in the left bar.', test: (a) => PAGES.every((p) => a.pages.includes(p.id)) },
];

// Ids of the achievements these numbers unlock. (The two stat rules above that count achievements only look at
// the ones that do not depend on stats, so there is no loop.)
export const unlockedIds = (a: Activity) => ACHIEVEMENTS.filter((x) => x.test(a)).map((x) => x.id);

export function readUnlocked(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(UNLOCKED_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const readNotices = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) !== '0';
  } catch {
    return true;
  }
};
export function setNotices(on: boolean) {
  try {
    localStorage.setItem(NOTICE_KEY, on ? '1' : '0');
  } catch {}
}

// Called by the app with what it can see right now. Takes the higher of old and new for every count, remembers the
// day and the pages, and announces any achievement that just unlocked.
// No 'Achievement unlocked' pop-ups for a short while after the page opens: the first numbers arrive in pieces as
// pages load, and every old achievement would otherwise be announced at once. Same on a brand-new device.
const QUIET_UNTIL = Date.now() + 15_000;
const FIRST_EVER = (() => { try { return localStorage.getItem(UNLOCKED_KEY) === null; } catch { return true; } })();

type Baseline = { pending?: boolean } & Partial<Record<(typeof NUMBERS)[number], number>>;
function readBaseline(): Baseline {
  try {
    const v = JSON.parse(localStorage.getItem(BASELINE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function recordActivity(seen: Partial<Pick<Activity, (typeof NUMBERS)[number]>> & { page?: string[]; loaded?: boolean }) {
  // Remember the latest real totals: only once everything has loaded from the hub (never startup zeros or half a load).
  try {
    if (seen.loaded) {
      const latest: Partial<Record<(typeof NUMBERS)[number], number>> = {};
      for (const k of NUMBERS) { const v = seen[k]; if (typeof v === 'number' && isFinite(v)) latest[k] = Math.max(0, Math.floor(v)); }
      localStorage.setItem(SEEN_KEY, JSON.stringify(latest));
    }
  } catch {}
  // Right after a reset, the first full set of totals becomes the new zero.
  let base = readBaseline();
  if (base.pending && seen.loaded) {
    base = {};
    for (const k of NUMBERS) if (typeof seen[k] === 'number' && isFinite(seen[k] as number)) base[k] = Math.floor(seen[k] as number);
    try { localStorage.setItem(BASELINE_KEY, JSON.stringify(base)); } catch {}
  }
  const old = readActivity();
  const next: Activity = { ...old, days: [...old.days], pages: [...old.pages] };
  for (const k of NUMBERS) {
    const raw = seen[k];
    if (base.pending || typeof raw !== 'number' || !isFinite(raw)) continue;
    const v = Math.max(0, raw - (base[k] || 0));
    if (v > next[k]) next[k] = Math.floor(v);
  }
  if (!next.days.includes(today())) next.days.push(today());
  for (const p of seen.page || []) if (p && !next.pages.includes(p)) next.pages.push(p);

  const changed = JSON.stringify(next) !== JSON.stringify(old);
  let had = true;
  try { had = localStorage.getItem(UNLOCKED_KEY) !== null; } catch {}
  const unlocked = readUnlocked();
  const fresh = ACHIEVEMENTS.filter((x) => x.test(next) && !unlocked[x.id]);
  if (!changed && !fresh.length && had) return;
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next));
    for (const x of fresh) unlocked[x.id] = Date.now();
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify(unlocked));
  } catch {}
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
  // Nothing is announced the first time (you would get every old achievement at once).
  if (had && !FIRST_EVER && Date.now() > QUIET_UNTIL && fresh.length && readNotices()) window.dispatchEvent(new CustomEvent(UNLOCK_EVENT, { detail: fresh.map((x) => x.title) }));
}

export function resetActivity() {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
    localStorage.setItem(UNLOCKED_KEY, '{}'); // empty, not missing: nothing old gets announced again
    // The new zero is the totals right now. Only if nothing has loaded yet does it wait for the next real totals.
    const top = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    const known = NUMBERS.some((k) => typeof top[k] === 'number');
    localStorage.setItem(BASELINE_KEY, JSON.stringify(known ? top : { pending: true }));
  } catch {}
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
}

export function useActivity(): Activity {
  const [a, setA] = useState(readActivity);
  useEffect(() => {
    const sync = () => setA(readActivity());
    window.addEventListener(ACTIVITY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return a;
}
