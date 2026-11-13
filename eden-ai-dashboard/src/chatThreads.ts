// Chat conversations, shared by the sidebar (which lists them) and the Chat page (which shows one).
import { useEffect, useState } from 'react';

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

export function useChatThreads() {
  const [threads, setThreads] = useState<Thread[]>(loadThreads);
  const [activeId, setActiveId] = useState(() => threads[0].id);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch {}
  }, [threads]);

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
