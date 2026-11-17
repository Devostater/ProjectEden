import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, X, MessagesSquare } from 'lucide-react';
import { ui } from '../ui.ts';

// Meetings: every project's next meeting and its topics to discuss, in one place.
// Same data as each project's Chief tab (To discuss), so adding a topic here shows there too.
interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface Meeting { projectId: string; name: string; color: string; meeting?: string; agenda: AgendaItem[] }

export const MeetingsView: React.FC<{ onOpenProject?: (id: string) => void }> = ({ onOpenProject }) => {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = () => fetch('/api/meetings').then((r) => r.json()).then((d) => setList(d.meetings || [])).catch(() => setError('Could not reach EDEN.'));
  useEffect(() => { load(); }, []);

  const change = (projectId: string, body: object) =>
    fetch(`/api/projects/${projectId}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => (r.ok ? load() : setError('Could not save that.')))
      .catch(() => setError('Could not save that.'));

  const withTopics = (list || []).filter((m) => m.meeting || m.agenda.some((a) => !a.done));
  const others = (list || []).filter((m) => !withTopics.includes(m));

  const card = (m: Meeting) => {
    const open = m.agenda.filter((a) => !a.done);
    const done = m.agenda.length - open.length;
    return (
      <section key={m.projectId} className={`${ui.card} space-y-2`}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
          <h2 className="flex-1 font-semibold text-slate-900 dark:text-white">{m.name}</h2>
          {onOpenProject && (
            <button onClick={() => onOpenProject(m.projectId)} title="Open the project (Chief tab has the chat)" className={ui.btn}>
              <MessagesSquare className="h-4 w-4" /> Chat with Chief
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <input
            defaultValue={m.meeting || ''}
            key={m.meeting || 'none'}
            onBlur={(e) => e.target.value !== (m.meeting || '') && change(m.projectId, { meeting: e.target.value })}
            placeholder="Next meeting, e.g. Today 5pm"
            aria-label={`Next meeting for ${m.name}`}
            className="min-w-0 flex-1 bg-transparent focus:outline-none"
          />
        </label>
        <ul className="space-y-1">
          {open.map((a) => (
            <li key={a.id} className="group flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
              <input type="checkbox" checked={false} onChange={() => change(m.projectId, { id: a.id, done: true })} aria-label={`Discussed: ${a.text}`} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span className="flex-1">{a.text}</span>
              <button onClick={() => change(m.projectId, { id: a.id, remove: true })} aria-label={`Remove ${a.text}`} className="text-slate-400 opacity-0 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"><X className="h-4 w-4" /></button>
            </li>
          ))}
          {!open.length && <li className={ui.empty}>No topics yet.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); const t = (drafts[m.projectId] || '').trim(); if (t) { change(m.projectId, { text: t }); setDrafts((d) => ({ ...d, [m.projectId]: '' })); } }} className="flex gap-2">
          <input value={drafts[m.projectId] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [m.projectId]: e.target.value }))} placeholder="Add a topic" aria-label={`Add a topic for ${m.name}`} className={ui.field} />
          <button disabled={!(drafts[m.projectId] || '').trim()} aria-label="Add topic" className={ui.btn}><Plus className="h-4 w-4" /></button>
        </form>
        {done > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {done} discussed · <button onClick={() => change(m.projectId, { clearDone: true })} className="text-indigo-600 hover:underline dark:text-indigo-400">clear them</button>
          </p>
        )}
      </section>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white"><CalendarClock className="h-6 w-6 text-indigo-500" /> Meetings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Topics to discuss and the next meeting for each project. Tick a topic off once it's been talked through.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {list === null && <p className={ui.empty}>Loading…</p>}
      {list && !list.length && <p className={ui.empty}>No projects yet. Make one first, then plan its meetings here.</p>}
      <div className="grid gap-4 md:grid-cols-2">{withTopics.map(card)}</div>
      {others.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">Projects with nothing planned ({others.length})</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">{others.map(card)}</div>
        </details>
      )}
    </div>
  );
};
