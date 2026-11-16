import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Users, Bot, Loader2, Plus, Check, X } from 'lucide-react';
import type { Agent } from '../types/index.ts';
import { newlineOnCtrlEnter } from '../textbox.ts';
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
    // No @name means you're talking to whoever this chat is with (picked when it was started), else Chief.
    const named = resolveTargets(text);
    const chief = agents.find((a) => a.id === 'agent-synthesizer');
    const chosen = agents.filter((a) => (target.with || []).includes(a.id));
    const targets = named.length ? named : chosen.length ? chosen : chief ? [chief] : [];
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

  // 👥 Who this chat is with: a bar at the top (handy on phones, where the chat list is tucked away) with
  // "New chat", which asks who the new chat is with. "Change" edits who the current chat is with.
  const [picker, setPicker] = useState<null | 'new' | 'edit'>(null);
  const [pick, setPick] = useState<string[]>([]);
  const withAgents = agents.filter((a) => (thread.with || []).includes(a.id));
  const withLabel = withAgents.length === 0 ? 'Chief' : withAgents.length === agents.length ? 'Whole team' : withAgents.map((a) => a.name.split(' ')[0]).join(', ');
  const openPicker = (mode: 'new' | 'edit') => {
    setPick(mode === 'edit' ? thread.with || [] : []);
    setPicker(mode);
  };
  const confirmPick = () => {
    if (picker === 'new') chat.newThread(pick);
    else patchThread(thread.id, (t) => ({ ...t, with: pick }));
    setPicker(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const togglePick = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const providerOf = (m?: string) => models.find((x) => x.id === m)?.provider || '';
  const notConnected = Object.entries(providers).filter(([p, ok]) => !ok && p !== 'extra').map(([p]) => PROVIDER_NAME[p]);

  return (
    <div className="flex h-full">
      {/* Conversation */}
      <section className="relative flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <button
            onClick={() => openPicker('edit')}
            className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            title="Change who this chat is with"
          >
            <Users className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="truncate">
              With <b>{withLabel}</b>
            </span>
            <span className="shrink-0 text-xs text-slate-400">Change</span>
          </button>
          <button
            onClick={() => openPicker('new')}
            className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        {picker && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-xl bg-white/95 p-4 pb-24 backdrop-blur md:pb-4 dark:bg-slate-900/95" role="dialog" aria-label="Who is this chat with">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">{picker === 'new' ? 'New chat: who with?' : 'Who is this chat with?'}</h3>
              <button onClick={() => setPicker(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setPick([])}
                className={`min-h-[40px] rounded-full border px-4 text-sm ${pick.length === 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
              >
                Chief (your lead)
              </button>
              <button
                onClick={() => setPick(agents.map((a) => a.id))}
                className={`min-h-[40px] rounded-full border px-4 text-sm ${pick.length === agents.length && agents.length > 0 ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
              >
                Whole team
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {agents.map((a) => {
                const on = pick.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => togglePick(a.id)}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3 text-left ${on ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 dark:border-slate-800'}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: (a as any).color || '#6366f1' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{a.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{(a as any).role || ''}</span>
                    </span>
                    {on && <Check className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />}
                  </button>
                );
              })}
            </div>
            <button onClick={confirmPick} className="mt-3 min-h-[48px] rounded-xl bg-indigo-600 text-base font-medium text-white hover:bg-indigo-500">
              {picker === 'new' ? 'Start chat' : 'Done'}
              {pick.length > 0 && pick.length < agents.length ? ` with ${pick.length}` : ''}
            </button>
          </div>
        )}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {thread.messages.length === 0 && (
            <div className="mt-16 text-center text-slate-500 dark:text-slate-400">
              <Users className="mx-auto mb-3" />
              <p className="text-base text-slate-700 dark:text-slate-200">You're talking to {withLabel}.</p>
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
            <div className="absolute bottom-full left-3 mb-2 w-64 max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
                if (newlineOnCtrlEnter(e, setInput)) return;
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
