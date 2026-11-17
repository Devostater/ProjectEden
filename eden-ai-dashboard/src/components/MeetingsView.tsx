import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, X, MessagesSquare } from 'lucide-react';
import { ui } from '../ui.ts';
import { UpcomingPanel } from './UpcomingPanel.tsx';

// Meetings: three panels side by side.
//   Left   - what needs attention, add a meeting, the project tabs, then past meetings at the bottom.
//   Middle - the notes (topics to discuss) for the project you picked.
//   Right  - the details of that project's meeting.
// Same data as each project's Chief tab (To discuss), so adding a topic here shows there too.
interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface Meeting { projectId: string; name: string; color: string; meeting?: string; agenda: AgendaItem[] }

export const MeetingsView: React.FC<{ onOpenProject?: (id: string) => void }> = ({ onOpenProject }) => {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState('');
  const [loads, setLoads] = useState(0); // goes up after every load so the Coming up list refreshes with it

  const load = () =>
    fetch('/api/meetings')
      .then((r) => r.json())
      .then((d) => { setList(d.meetings || []); setLoads((n) => n + 1); })
      .catch(() => setError('Could not reach EDEN.'));
  useEffect(() => { load(); }, []);

  const change = (projectId: string, body: object) =>
    fetch(`/api/projects/${projectId}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => (r.ok ? load() : setError('Could not save that.')))
      .catch(() => setError('Could not save that.'));

  // The picked project, or the first one until you pick.
  const current = (list || []).find((m) => m.projectId === picked) || (list || [])[0];
  const open = current ? current.agenda.filter((a) => !a.done) : [];
  const done = current ? current.agenda.filter((a) => a.done) : [];

  const pick = (id: string) => { setPicked(id); setDraft(''); };

  const panel = 'min-h-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:overflow-y-auto';

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 lg:h-full lg:min-h-0">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white"><CalendarClock className="h-6 w-6 text-indigo-500" /> Meetings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Topics to discuss and the next meeting for each project. Tick a topic off once it's been talked through.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {list === null && !error && <p className={ui.empty}>Loading…</p>}
      {list && !list.length && <p className={ui.empty}>No projects yet. Make one first, then plan its meetings here.</p>}
      {list && list.length > 0 && current && (
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)_17rem]">
          {/* Left: coming up, then the project tabs */}
          <aside aria-label="Meetings and projects" className={`${panel} space-y-3`}>
            <UpcomingPanel refreshKey={loads} onPickProject={pick}>
            <nav aria-label="Projects" className="border-t border-slate-200 pt-2 dark:border-slate-800">
              <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Projects</h2>
              <ul className="space-y-0.5">
                {list.map((m) => {
                  const count = m.agenda.filter((a) => !a.done).length;
                  const active = m.projectId === current.projectId;
                  return (
                    <li key={m.projectId}>
                      <button
                        onClick={() => pick(m.projectId)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${active ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        {count > 0 && <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{count}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            </UpcomingPanel>
          </aside>

          {/* Middle: the notes for the picked project */}
          <section aria-label={`Notes for ${current.name}`} className={`${panel} space-y-3`}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: current.color }} />
              <h2 className="flex-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{current.name}</h2>
            </div>
            <ul className="space-y-1">
              {open.map((a) => (
                <li key={a.id} className="group flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input type="checkbox" checked={false} onChange={() => change(current.projectId, { id: a.id, done: true })} aria-label={`Discussed: ${a.text}`} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                  <span className="flex-1">{a.text}</span>
                  <button onClick={() => change(current.projectId, { id: a.id, remove: true })} aria-label={`Remove ${a.text}`} className="text-slate-400 opacity-0 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"><X className="h-4 w-4" /></button>
                </li>
              ))}
              {!open.length && <li className={ui.empty}>No topics yet.</li>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { change(current.projectId, { text: t }); setDraft(''); } }} className="flex gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a topic" aria-label={`Add a topic for ${current.name}`} className={ui.field} />
              <button disabled={!draft.trim()} aria-label="Add topic" className={ui.btn}><Plus className="h-4 w-4" /></button>
            </form>
          </section>

          {/* Right: details of the meeting */}
          <aside aria-label={`Details for ${current.name}`} className={`${panel} space-y-3`}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Details</h2>
            <label className="block text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-1 flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4 shrink-0" /> Next meeting</span>
              <input
                defaultValue={current.meeting || ''}
                key={`${current.projectId}:${current.meeting || 'none'}`}
                onBlur={(e) => e.target.value !== (current.meeting || '') && change(current.projectId, { meeting: e.target.value })}
                placeholder="e.g. Today 5pm"
                aria-label={`Next meeting for ${current.name}`}
                className={ui.field}
              />
            </label>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {open.length} {open.length === 1 ? 'topic' : 'topics'} to discuss · {done.length} discussed
            </p>
            {onOpenProject && (
              <button onClick={() => onOpenProject(current.projectId)} title="Open the project (Chief tab has the chat)" className={ui.btn}>
                <MessagesSquare className="h-4 w-4" /> Chat with Chief
              </button>
            )}
            {done.length > 0 && (
              <div>
                <p className="mb-1 flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span className="flex-1">Already discussed</span>
                  <button onClick={() => change(current.projectId, { clearDone: true })} className="font-normal normal-case text-indigo-600 hover:underline dark:text-indigo-400">clear them</button>
                </p>
                <ul className="space-y-1">
                  {done.map((a) => (
                    <li key={a.id} className="text-sm text-slate-500 line-through dark:text-slate-400">{a.text}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
