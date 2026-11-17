// What the code updates are doing, shared by the top bar and Review: one check every few seconds for everyone.
// Ready updates wait for you to apply them. Only available on the computer running the hub; anywhere else the lists are simply empty.
import { useSyncExternalStore } from 'react';

export interface ReadyUpdate {
  id: string;
  request: string;
  summary?: string;
  codebaseName?: string;
  files?: { path: string; added: number; removed: number }[];
}

// A short line about any update, for the notifications list.
export interface UpdateNote {
  id: string;
  request: string;
  status: string;
  codebaseName?: string;
  when: string; // when it was asked for or finished (ISO)
}

export interface UpdatesFeed {
  ready: ReadyUpdate[]; // finished, waiting for you to apply
  running: UpdateNote[]; // queued or being worked on
  failed: UpdateNote[]; // did not work out, and you haven't looked at the Code updates page since
  finished: UpdateNote[]; // applied, undone or discarded since you last looked at the Code updates page
  restartPending: boolean; // an applied update only takes effect after a restart
}

const EMPTY: UpdatesFeed = { ready: [], running: [], failed: [], finished: [], restartPending: false };
const SEEN_KEY = 'eden_updates_seen';

// The moment you last looked at the Code updates page. First time ever: now, so old history isn't announced as news.
const readSeen = (): number => {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY));
    if (v > 0) return v;
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {}
  return Date.now();
};
let seenAt = readSeen();

let feed: UpdatesFeed = EMPTY;
let lastJobs: any[] | null = null;
let lastRestart = false;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

const build = (): UpdatesFeed => {
  const jobs = lastJobs || [];
  const note = (j: any): UpdateNote => ({ id: j.id, request: j.request, status: j.status, codebaseName: j.codebaseName, when: j.finishedAt || j.createdAt });
  const after = (j: any) => new Date(j.finishedAt || j.createdAt).getTime() > seenAt;
  return {
    ready: jobs.filter((j) => j.status === 'ready'),
    running: jobs.filter((j) => j.status === 'queued' || j.status === 'working' || j.status === 'checking').map(note),
    failed: jobs.filter((j) => j.status === 'failed' && after(j)).map(note),
    finished: jobs.filter((j) => (j.status === 'applied' || j.status === 'undone' || j.status === 'discarded') && after(j)).map(note),
    restartPending: lastRestart,
  };
};

// Only tell listeners when something they can see actually changed.
const publish = () => {
  const next = build();
  if (JSON.stringify(next) === JSON.stringify(feed)) return;
  feed = next;
  listeners.forEach((l) => l());
};

export const refreshUpdatesFeed = async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const d = await fetch('/api/updates', { cache: 'no-store' }).then((r) => r.json());
    lastJobs = Array.isArray(d.jobs) ? d.jobs : [];
    lastRestart = !!d.restartPending;
  } catch {
    lastJobs = [];
    lastRestart = false;
  }
  publish();
};

// Call when you open the Code updates page: finished and failed updates stop counting as news.
export const markUpdatesSeen = () => {
  seenAt = Date.now();
  try { localStorage.setItem(SEEN_KEY, String(seenAt)); } catch {}
  publish();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  if (listeners.size === 1) {
    refreshUpdatesFeed();
    timer = setInterval(refreshUpdatesFeed, 10000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};

export const useUpdatesFeed = (): UpdatesFeed => useSyncExternalStore(subscribe, () => feed);

export const useReadyUpdates = (): ReadyUpdate[] => useUpdatesFeed().ready;
