// Chats shared by every device: the hub keeps them in .eden-chats.json, and tells every open page the
// moment one changes (a new message, a reply, a rename, a delete), so the PC, tablet and phone all show
// the same conversations. Pages send only the chats they changed; the newer copy of each chat wins, and
// messages from both copies are kept, so two devices writing at once don't lose anything.
import { jsonObject, jsonStore } from './jsonStore';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express, Response } from 'express';
import { fileProblem } from './activity';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.eden-chats.json');

interface Msg {
  id: string;
  [k: string]: unknown;
}
interface Thread {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
  [k: string]: unknown;
}
interface Store {
  threads: Thread[];
  deleted: Record<string, number>; // chat id -> when it was deleted
  version: number;
}

const valid = (t: any): t is Thread => t && typeof t.id === 'string' && Array.isArray(t.messages) && typeof t.updatedAt === 'number';
const chatFile = jsonStore<Partial<Store>>(FILE, (value) =>
  jsonObject(value) &&
  (value.threads === undefined || (Array.isArray(value.threads) && value.threads.every(valid))) &&
  (value.deleted === undefined || jsonObject(value.deleted)) &&
  (value.version === undefined || typeof value.version === 'number'));
const store: Store = { threads: [], deleted: {}, version: 0, ...chatFile.read() };

let saveTimer: NodeJS.Timeout | null = null;
const save = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      chatFile.write(store);
    } catch (err: any) {
      fileProblem('save the shared chats', err);
    }
  }, 300);
};

// Newer copy wins for the title and settings; messages from both are kept, in order.
function mergeThread(old: Thread, incoming: Thread): Thread {
  const [base, other] = incoming.updatedAt >= old.updatedAt ? [incoming, old] : [old, incoming];
  const ids = new Set(base.messages.map((m) => m.id));
  const missing = other.messages.filter((m) => !ids.has(m.id));
  return { ...base, messages: missing.length ? [...base.messages, ...missing] : base.messages, updatedAt: Math.max(old.updatedAt, incoming.updatedAt) };
}

const watchers = new Set<Response>();
const tell = () => {
  for (const res of watchers) res.write(`data: ${store.version}\n\n`);
};

// Add messages to a chat from outside the page (for example LYRA asking EDEN's team a question), creating the chat
// if needed. Every open page sees it right away, like any other chat.
export function appendToChat(
  id: string,
  title: string,
  messages: { role: 'user' | 'assistant'; author: string; content: string; error?: string; model?: string; note?: string }[],
  withIds?: string[],
) {
  if (!messages.length) return;
  const stamp = Date.now();
  const msgs = messages.map((m, i) => ({ id: `m-${stamp}-${i}`, ...m }));
  const i = store.threads.findIndex((t) => t.id === id);
  if (i < 0) store.threads.unshift({ id, title, messages: msgs, updatedAt: stamp, ...(withIds?.length ? { with: withIds } : {}) });
  else store.threads[i] = { ...store.threads[i], messages: [...store.threads[i].messages, ...msgs].slice(-500), updatedAt: stamp };
  delete store.deleted[id];
  store.threads.sort((a, b) => b.updatedAt - a.updatedAt);
  store.version++;
  save();
  tell();
}

export function registerChatRoutes(app: Express) {

  app.get('/api/chats', (_req, res) => res.json(store));

  app.put('/api/chats', (req, res) => {
    const threads: unknown[] = Array.isArray(req.body?.threads) ? req.body.threads : [];
    const deleted: Record<string, unknown> = req.body?.deleted && typeof req.body.deleted === 'object' ? req.body.deleted : {};
    let changed = false;
    for (const [id, at] of Object.entries(deleted)) {
      if (typeof at !== 'number') continue;
      const t = store.threads.find((x) => x.id === id);
      if (t && t.updatedAt > at) continue; // changed somewhere after it was deleted here: keep it
      store.threads = store.threads.filter((x) => x.id !== id);
      store.deleted[id] = Math.max(store.deleted[id] || 0, at);
      changed = true;
    }
    for (const t of threads) {
      if (!valid(t)) continue;
      if ((store.deleted[t.id] || 0) >= t.updatedAt) continue; // deleted on another device after this edit
      const i = store.threads.findIndex((x) => x.id === t.id);
      if (i < 0) store.threads.unshift(t);
      else store.threads[i] = mergeThread(store.threads[i], t);
      changed = true;
    }
    if (changed) {
      store.threads.sort((a, b) => b.updatedAt - a.updatedAt);
      // Old delete markers aren't needed forever.
      const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
      for (const [id, at] of Object.entries(store.deleted)) if (at < monthAgo) delete store.deleted[id];
      store.version++;
      save();
      tell();
    }
    res.json({ ok: true, version: store.version });
  });

  app.get('/api/chats/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${store.version}\n\n`);
    watchers.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      watchers.delete(res);
    });
  });
}
