// Chat conversations, shared by the sidebar (which lists them) and the Chat page (which shows one).
import React, { useEffect, useRef, useState } from 'react';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  author: string;
  content: string;
  model?: string;
  error?: string;
  summary?: boolean;
  note?: string;
}

export interface Thread {
  id: string;
  title: string;
  messages: ChatMsg[];
  // Who this chat is with (agent ids). Empty or missing = Chief. "@name" in a message still overrides it.
  with?: string[];
}

const STORAGE_KEY = 'nexus_chat_threads';

export const emptyThread = (): Thread => ({ id: `t-${Date.now()}`, title: 'New chat', messages: [] });

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  return [emptyThread()];
}

// ---- sync with the hub, so every device shows the same chats ----
// Each chat change here is sent to the hub; the hub says when another device changed one, and we fetch it.
// `stamps` records when each chat was last changed on this device, to tell newer copies from older ones.
type Synced = Thread & { updatedAt: number };
const STAMP_KEY = 'nexus_chat_stamps';
const loadStamps = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(STAMP_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

function useChatSync(threads: Thread[], setThreads: React.Dispatch<React.SetStateAction<Thread[]>>) {
  const stamps = useRef<Record<string, number>>(loadStamps());
  const prev = useRef<Map<string, Thread>>(new Map());
  const fromHub = useRef(false); // the current change came from the hub: don't send it back
  const pending = useRef<{ threads: Map<string, Synced>; deleted: Record<string, number> }>({ threads: new Map(), deleted: {} });
  const timer = useRef<number | undefined>(undefined);
  const ready = useRef(false); // first copy from the hub merged in

  const flush = () => {
    const body = { threads: [...pending.current.threads.values()], deleted: pending.current.deleted };
    if (!body.threads.length && !Object.keys(body.deleted).length) return;
    pending.current = { threads: new Map(), deleted: {} };
    fetch('/api/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
      // Hub unreachable: try again with the next change (or the next time the page connects).
      for (const t of body.threads) if (!pending.current.threads.has(t.id)) pending.current.threads.set(t.id, t);
      pending.current.deleted = { ...body.deleted, ...pending.current.deleted };
    });
  };

  // Fetch the hub's copy and merge: a chat changed more recently on the hub replaces ours.
  const pull = async () => {
    let data: { threads: Synced[]; deleted: Record<string, number> };
    try {
      const r = await fetch('/api/chats');
      if (!r.ok) return;
      data = await r.json();
    } catch {
      return;
    }
    const first = !ready.current;
    ready.current = true;
    fromHub.current = true;
    setThreads((local) => {
      const byId = new Map(local.map((t) => [t.id, t]));
      const out: Thread[] = [];
      const hubIds = new Set<string>();
      for (const h of data.threads) {
        hubIds.add(h.id);
        const mine = byId.get(h.id);
        const myStamp = stamps.current[h.id] || 0;
        if (!mine || h.updatedAt >= myStamp) {
          const { updatedAt, ...t } = h;
          stamps.current[h.id] = updatedAt;
          out.push(t as Thread);
        } else out.push(mine);
      }
      // Ours that the hub doesn't have: deleted elsewhere (drop), or not sent yet (keep, and send).
      for (const t of local) {
        if (hubIds.has(t.id)) continue;
        if ((data.deleted[t.id] || 0) >= (stamps.current[t.id] || 0)) continue;
        if (!t.messages.length && local.length > 1 && !first) continue;
        out.push(t);
        if (first && t.messages.length) pending.current.threads.set(t.id, { ...t, updatedAt: stamps.current[t.id] || Date.now() });
      }
      return out.length ? out : [emptyThread()];
    });
    if (pending.current.threads.size) flush();
  };

  // Send what changed here.
  useEffect(() => {
    const now = Date.now();
    const seen = new Map(threads.map((t) => [t.id, t]));
    if (fromHub.current) {
      fromHub.current = false;
    } else if (ready.current) {
      for (const t of threads) {
        if (prev.current.get(t.id) === t) continue;
        stamps.current[t.id] = now;
        if (t.messages.length || prev.current.has(t.id)) pending.current.threads.set(t.id, { ...t, updatedAt: now });
      }
      for (const id of prev.current.keys()) if (!seen.has(id)) pending.current.deleted[id] = now;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 400);
    }
    prev.current = seen;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
      localStorage.setItem(STAMP_KEY, JSON.stringify(stamps.current));
    } catch {}
  }, [threads]);

  // Hear about changes from other devices (reconnects by itself if the hub restarts).
  useEffect(() => {
    let last = -1;
    const es = new EventSource('/api/chats/events');
    es.onmessage = (e) => {
      const v = Number(e.data);
      if (v !== last) {
        last = v;
        pull();
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && pull();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es.close();
      document.removeEventListener('visibilitychange', onVisible);
      flush();
    };
  }, []);
}

export function useChatThreads() {
  const [threads, setThreads] = useState<Thread[]>(loadThreads);
  const [activeId, setActiveId] = useState(() => threads[0].id);

  useChatSync(threads, setThreads);

  // The open chat was deleted on another device: show the first one instead.
  useEffect(() => {
    if (!threads.some((t) => t.id === activeId)) setActiveId(threads[0].id);
  }, [threads, activeId]);

  // Reuses the current chat if it is still empty, so "New chat" never stacks up blank ones.
  // `withIds`: who the new chat is with (picked in the chat's "New chat" sheet).
  const newThread = (withIds?: string[]): Thread => {
    const current = threads.find((t) => t.id === activeId);
    if (current && !current.messages.length) {
      if (!withIds) return current;
      const updated = { ...current, with: withIds };
      setThreads((ts) => ts.map((t) => (t.id === current.id ? updated : t)));
      return updated;
    }
    const t = { ...emptyThread(), ...(withIds ? { with: withIds } : {}) };
    setThreads((ts) => [t, ...ts]);
    setActiveId(t.id);
    return t;
  };

  const deleteThread = (id: string) => {
    setThreads((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      const next = rest.length ? rest : [emptyThread()];
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const thread = threads.find((t) => t.id === activeId) || threads[0];

  return { threads, setThreads, thread, activeId, setActiveId, newThread, deleteThread };
}

export type ChatThreads = ReturnType<typeof useChatThreads>;
