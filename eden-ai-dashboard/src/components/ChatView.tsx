import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Users, Bot, Loader2 } from 'lucide-react';
import type { Agent } from '../types/index.ts';
import { emptyThread, type ChatMsg, type ChatThreads, type Thread } from '../chatThreads.ts';

interface ModelInfo {
  id: string;
  label: string;
  provider: 'anthropic' | 'google' | 'openai';
}

// A message handed over from another page: `send` sends it straight away, otherwise it just fills the box.
export interface ChatDraft {
  text: string;
  send: boolean;
}

const SUMMARY_KEY = 'eden_chat_summary';
const PROVIDER_NAME: Record<string, string> = { lyra: 'LYRA', anthropic: 'Claude', google: 'Gemini', openai: 'ChatGPT', extra: 'Free AI' };

const providerColor: Record<string, string> = {
  lyra: 'text-fuchsia-500 bg-fuchsia-500/10',
  anthropic: 'text-orange-500 bg-orange-500/10',
  google: 'text-sky-500 bg-sky-500/10',
  openai: 'text-emerald-500 bg-emerald-500/10',
  extra: 'text-lime-600 bg-lime-500/10',
};

// Light formatting for AI answers: **bold**, *italic*, `code`, headings and bullets. No HTML is injected.
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded bg-black/10 px-1 font-mono text-[0.85em] dark:bg-white/10">{part.slice(1, -1)}</code>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export const Formatted: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-1 text-sm leading-relaxed">
    {text.split('\n').map((line, i) => {
      const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (heading) return <p key={i} className="pt-1 font-semibold">{inline(heading[1])}</p>;
      const bullet = line.match(/^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/);
      if (bullet) {
        return (
          <div key={i} className="flex gap-2" style={{ paddingLeft: `${Math.min(bullet[1].length, 8) * 0.4}rem` }}>
            <span className="shrink-0 text-slate-400">{bullet[2] ? `${bullet[2]}.` : '•'}</span>
            <span>{inline(bullet[3])}</span>
          </div>
        );
      }
      if (!line.trim()) return <div key={i} className="h-1" />;
      return <p key={i}>{inline(line)}</p>;
    })}
  </div>
);

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface ChatViewProps {
  agents: Agent[];
  chat: ChatThreads;
  draft?: ChatDraft | null;
  onDraftUsed?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ agents, chat, draft, onDraftUsed }) => {
  const { thread, setThreads, setActiveId } = chat;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [summarise, setSummarise] = useState(() => {
    try {
      return localStorage.getItem(SUMMARY_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models);
        setProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SUMMARY_KEY, summarise ? 'on' : 'off');
    } catch {}
  }, [summarise]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages.length, busy]);

  // "@all" sends to every agent; "@name" targets specific agents.
  const resolveTargets = (text: string): Agent[] => {
    const mentions = [...text.matchAll(/@([\w-]+)/g)].map((m) => slug(m[1]));
    if (mentions.some((m) => m === 'all' || m === 'team' || m === 'swarm')) return agents;
    return agents.filter((a) => mentions.some((m) => slug(a.name).startsWith(m) || slug(a.name.split(' ')[0]) === m));
  };

  const mentionQuery = useMemo(() => {
    const m = input.match(/@([\w-]*)$/);
    return m ? slug(m[1]) : null;
  }, [input]);

  const suggestions =
    mentionQuery === null
      ? []
      : [{ id: 'all', name: 'all', role: 'Whole team' } as any, ...agents].filter((a) => slug(a.name).startsWith(mentionQuery)).slice(0, 6);

  const patchThread = (id: string, fn: (t: Thread) => Thread) => setThreads((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  const append = (id: string, msgs: ChatMsg[]) => patchThread(id, (t) => ({ ...t, messages: [...t.messages, ...msgs] }));

  const send = async (textOverride?: string, target: Thread = thread) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    const userMsg: ChatMsg = { id: `m-${Date.now()}`, role: 'user', author: 'You', content: text };
    const history = [...target.messages, userMsg];
    patchThread(target.id, (t) => ({ ...t, title: t.messages.length ? t.title : text.replace(/@[\w-]+\s*/g, '').slice(0, 40) || text.slice(0, 40), messages: history }));
    if (textOverride === undefined) setInput('');
    setBusy(true);
    // No @name means you're talking to Chief.
    const named = resolveTargets(text);
    const chief = agents.find((a) => a.id === 'agent-synthesizer');
    const targets = named.length ? named : chief ? [chief] : [];
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentIds: targets.map((a) => a.id),
          messages: history.filter((m) => !m.error && !m.summary).map(({ role, content, author }) => ({ role, content, author })),
        }),
      });
      const data = await res.json();
      const raw: any[] = data.replies || [{ author: 'System', error: data.error || 'Request failed', content: '' }];
      append(
        target.id,
        raw.map((r, i) => ({ id: `m-${Date.now()}-${i}`, role: 'assistant', author: r.author, content: r.content, model: r.model, error: r.error, note: r.note }))
      );

      // When several teammates answered, Chief combines them into one plan.
      const good = raw.filter((r) => !r.error && r.content);
      if (summarise && good.length >= 2) {
        const sRes = await fetch('/api/swarm/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, results: good.map((r) => ({ agentName: r.author, content: r.content })) }),
        });
        const sData = await sRes.json();
        append(target.id, [
          sRes.ok
            ? { id: `m-${Date.now()}-s`, role: 'assistant', author: 'Chief · summary', content: sData.synthesis, summary: true }
            : { id: `m-${Date.now()}-s`, role: 'assistant', author: 'Chief · summary', content: '', error: sData.error || 'Summary failed', summary: true },
        ]);
      }
    } catch (err: any) {
      append(target.id, [{ id: `m-${Date.now()}`, role: 'assistant', author: 'System', content: '', error: err?.message || 'Network error' }]);
    } finally {
      setBusy(false);
    }
  };

  // A message handed over from Home, Team or Files.
  useEffect(() => {
    if (!draft) return;
    onDraftUsed?.();
    let target = thread;
    if (thread.messages.length) {
      target = emptyThread();
      setThreads((ts) => [target, ...ts]);
      setActiveId(target.id);
    }
    if (draft.send) {
      send(draft.text, target);
    } else {
      setInput(draft.text);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const providerOf = (m?: string) => models.find((x) => x.id === m)?.provider || '';
  const notConnected = Object.entries(providers).filter(([p, ok]) => !ok && p !== 'extra').map(([p]) => PROVIDER_NAME[p]);

  return (
    <div className="flex h-full">
      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {thread.messages.length === 0 && (
            <div className="mt-16 text-center text-slate-500 dark:text-slate-400">
              <Users className="mx-auto mb-3" />
              <p className="text-base text-slate-700 dark:text-slate-200">You're talking to Chief.</p>
              <p className="mt-1">Add @name to ask a teammate, or @all for the whole team.</p>
              <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2">
                {agents.filter((a) => a.id !== 'agent-synthesizer').map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setInput((v) => `${v}@${a.name.split(' ')[0]} `);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-indigo-400"
                  >
                    @{a.name.split(' ')[0]}
                  </button>
                ))}
              </div>
              {notConnected.length > 0 && <p className="mt-6 text-sm text-amber-600 dark:text-amber-400">Not connected yet: {notConnected.join(', ')}. Set them up in Account → Connections.</p>}
            </div>
          )}
          {thread.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : m.summary
                      ? 'border border-indigo-300 bg-indigo-50 text-slate-900 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-slate-100'
                      : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {m.role === 'assistant' && (
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <Bot size={12} className="text-slate-400" />
                    <span className="font-semibold">{m.author}</span>
                    {m.model && <span className={`rounded px-1.5 py-0.5 ${providerColor[providerOf(m.model)] || 'text-slate-400'}`}>{PROVIDER_NAME[providerOf(m.model)] || m.model}</span>}
                  </div>
                )}
                {m.error ? (
                  <p className="text-sm text-red-500">{m.error}</p>
                ) : m.role === 'user' ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                ) : (
                  <Formatted text={m.content} />
                )}
                {m.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{m.note}</p>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Working…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="relative border-t border-slate-200 p-3 dark:border-slate-800">
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-3 mb-2 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {suggestions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setInput(input.replace(/@[\w-]*$/, `@${a.name === 'all' ? 'all' : a.name.split(' ')[0]} `))}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span>@{a.name === 'all' ? 'all' : a.name.split(' ')[0]}</span>
                  <span className="truncate pl-2 text-xs text-slate-500">{a.role}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Message Chief…  (@name for a teammate)"
              className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <button onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send" className="rounded-lg bg-indigo-600 px-4 text-white hover:bg-indigo-500 disabled:opacity-40">
              <Send size={18} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={summarise} onChange={(e) => setSummarise(e.target.checked)} className="accent-indigo-600" />
              Chief sums up team answers
            </label>
          </div>
        </div>
      </section>
    </div>
  );
};
