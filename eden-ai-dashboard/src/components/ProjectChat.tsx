import React, { useEffect, useRef, useState } from 'react';
import { picksAsText, clearPicks } from '../picker.ts';
import { ui } from '../ui.ts';
import { Send, Loader2, Plus, X, CalendarClock, ListChecks } from 'lucide-react';

// The project's ongoing chat with Chief (kept on the hub) and its to-discuss list.
interface ChatLine { role: 'owner' | 'chief'; text: string; at: string }
interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface Chat { messages: ChatLine[]; agenda: AgendaItem[]; meeting?: string }


export const ProjectChat: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [chat, setChat] = useState<Chat>({ messages: [], agenda: [] });
  const [text, setText] = useState('');
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChat({ messages: [], agenda: [] });
    fetch(`/api/projects/${projectId}/chat`).then((r) => r.json()).then((d) => d.messages && setChat(d)).catch(() => {});
  }, [projectId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [chat.messages.length]);

  const agenda = (body: object) =>
    fetch(`/api/projects/${projectId}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).then((d) => d.agenda && setChat(d)).catch(() => setError('Could not update the list.'));

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    setError('');
    setBusy(true);
    setChat((c) => ({ ...c, messages: [...c.messages, { role: 'owner', text: t, at: new Date().toISOString() }] }));
    try {
      const r = await fetch(`/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t + picksAsText() }) });
      clearPicks();
      const d = await r.json();
      if (d.messages) setChat(d);
      if (!r.ok) setError(d.error || 'Chief could not answer.');
    } catch {
      setError('The hub did not answer.');
    }
    setBusy(false);
  };

  const open = chat.agenda.filter((a) => !a.done);
  const done = chat.agenda.filter((a) => a.done);

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div className={ui.label}><ListChecks className="h-3.5 w-3.5" /> To discuss</div>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <input defaultValue={chat.meeting || ''} key={chat.meeting || 'none'} onBlur={(e) => e.target.value !== (chat.meeting || '') && agenda({ meeting: e.target.value })} placeholder="Next meeting, e.g. Today 5pm" aria-label="Next meeting" className="min-w-0 flex-1 bg-transparent focus:outline-none" />
        </label>
        <ul className="space-y-1">
          {open.map((a) => (
            <li key={a.id} className="group flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
              <input type="checkbox" checked={false} onChange={() => agenda({ id: a.id, done: true })} aria-label={`Done: ${a.text}`} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span className="flex-1">{a.text}</span>
              <button onClick={() => agenda({ id: a.id, remove: true })} aria-label={`Remove ${a.text}`} className="text-slate-400 opacity-0 hover:text-red-500 group-hover:opacity-100"><X className="h-4 w-4" /></button>
            </li>
          ))}
          {!open.length && <li className="text-sm text-slate-500 dark:text-slate-400">Nothing yet. Add a point, or tell Chief "add … to the list".</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); if (item.trim()) { agenda({ text: item }); setItem(''); } }} className="mt-2 flex gap-2">
          <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a point" aria-label="Add a point to discuss" className={ui.field} />
          <button disabled={!item.trim()} className="rounded-lg border border-slate-300 px-3 disabled:opacity-40 dark:border-slate-700" aria-label="Add"><Plus className="h-4 w-4" /></button>
        </form>
        {done.length > 0 && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {done.length} discussed · <button onClick={() => agenda({ clearDone: true })} className="text-indigo-600 hover:underline dark:text-indigo-400">clear them</button>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div className={ui.label}>Chat with Chief (kept for this project)</div>
        <div className="space-y-2">
          {chat.messages.map((m, i) => (
            <div key={i} className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'owner' ? 'ml-8 bg-indigo-600 text-white' : 'mr-8 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>{m.text}</div>
          ))}
          {busy && <div className="mr-8 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800"><Loader2 className="h-4 w-4 animate-spin" /> Chief is thinking…</div>}
          {!chat.messages.length && !busy && <p className="text-sm text-slate-500 dark:text-slate-400">Talk to Chief about this project. The conversation stays here, so you can come back to it.</p>}
          <div ref={endRef} />
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mt-3 flex gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={2} placeholder="Message Chief…" aria-label="Message Chief" className={ui.field} />
          <button disabled={busy || !text.trim()} aria-label="Send" className="self-end rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      </section>
    </div>
  );
};
