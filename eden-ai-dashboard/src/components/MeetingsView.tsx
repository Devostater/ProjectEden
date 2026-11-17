import React, { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, ArrowDown, ArrowUp, Plus, X, MessagesSquare } from 'lucide-react';
import { ui } from '../ui.ts';
import { UpcomingPanel, type PickedEvent } from './UpcomingPanel.tsx';
import { setMeetingNote, setMeetingSelection, useMeetingSelection } from '../meetingSelection.ts';

// Meetings: two areas side by side.
//   Left   - what needs attention, add a meeting, the project tabs, then past meetings at the bottom.
//   Middle - what you picked on the left: a project's meeting, or one of your own events.
//            The middle is a stack of small panels (topics, meeting details, already discussed, notes).
//            Each panel can be minimized and moved up or down; the order and what is minimized are remembered on this device.
// Same data as each project's Chief tab (To discuss), so adding a topic here shows there too.
interface AgendaItem { id: string; text: string; done: boolean; at: string }
interface Meeting { projectId: string; name: string; color: string; meeting?: string; agenda: AgendaItem[] }

type PanelId = 'topics' | 'details' | 'discussed' | 'notes';
const DEFAULT_ORDER: PanelId[] = ['topics', 'details', 'discussed', 'notes'];
const PANEL_TITLES: Record<PanelId, string> = { topics: 'Topics to discuss', details: 'Meeting details', discussed: 'Already discussed', notes: 'My notes' };
const LAYOUT_KEY = 'eden_meetings_layout';

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
// Whatever was saved, make sure every panel appears exactly once.
function cleanOrder(value: unknown): PanelId[] {
  const saved = Array.isArray(value) ? (value.filter((v) => DEFAULT_ORDER.includes(v as PanelId)) as PanelId[]) : [];
  const seen = saved.filter((v, i) => saved.indexOf(v) === i);
  return [...seen, ...DEFAULT_ORDER.filter((id) => !seen.includes(id))];
}

export const MeetingsView: React.FC<{ onOpenProject?: (id: string) => void }> = ({ onOpenProject }) => {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState('');
  const [pickedEvent, setPickedEvent] = useState<PickedEvent | null>(null); // one of your own events, shown in the middle instead of a project
  const [chosen, setChosen] = useState<string[]>([]); // topic ids ticked to send to another meeting
  const [sendTo, setSendTo] = useState(''); // the project that would receive them
  const [takeOff, setTakeOff] = useState(false); // also remove them from this meeting
  const [sentNote, setSentNote] = useState('');
  const [loads, setLoads] = useState(0); // goes up after every load so the Coming up list refreshes with it
  const [order, setOrder] = useState<PanelId[]>(() => cleanOrder(readJson<{ order?: unknown }>(LAYOUT_KEY, {}).order));
  const [minimized, setMinimized] = useState<PanelId[]>(() => {
    const m = readJson<{ minimized?: unknown }>(LAYOUT_KEY, {}).minimized;
    return Array.isArray(m) ? (m.filter((v) => DEFAULT_ORDER.includes(v as PanelId)) as PanelId[]) : [];
  });
  const { notes } = useMeetingSelection(); // notes are shared with the right-hand panel
  const [eventNotesOpen, setEventNotesOpen] = useState(false);
  const [projectsMinimized, setProjectsMinimized] = useState<boolean>(() => readJson<{ projectsMinimized?: unknown }>(LAYOUT_KEY, {}).projectsMinimized === true);
  // Save it next to the panel layout, keeping whatever else is already saved there.
  const toggleProjects = () => {
    const next = !projectsMinimized;
    setProjectsMinimized(next);
    writeJson(LAYOUT_KEY, { ...readJson<Record<string, unknown>>(LAYOUT_KEY, {}), projectsMinimized: next });
  };

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
  const others = (list || []).filter((m) => m.projectId !== current?.projectId); // the other meetings topics can go to
  const picks = open.filter((a) => chosen.includes(a.id));

  const pick = (id: string) => { setPicked(id); setPickedEvent(null); setDraft(''); setChosen([]); setSendTo(''); setSentNote(''); };

  const post = (projectId: string, body: object) =>
    fetch(`/api/projects/${projectId}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error('save failed'); });

  // Add some (or all) of this meeting's open topics to another project's meeting. Optionally take them off this one.
  const sendTopics = async (from: Meeting, items: AgendaItem[], toId: string, takeOff: boolean) => {
    const target = (list || []).find((m) => m.projectId === toId);
    if (!target || !items.length) return;
    setSentNote('');
    try {
      for (const a of items) await post(toId, { text: a.text });
      if (takeOff) for (const a of items) await post(from.projectId, { id: a.id, remove: true });
      setChosen([]);
      setSentNote(`${items.length} ${items.length === 1 ? 'topic' : 'topics'} ${takeOff ? 'moved' : 'added'} to ${target.name}.`);
    } catch {
      setError('Could not save that. Some topics may have been added already.');
    }
    await load();
  };

  const saveLayout = (nextOrder: PanelId[], nextMinimized: PanelId[]) => {
    setOrder(nextOrder);
    setMinimized(nextMinimized);
    writeJson(LAYOUT_KEY, { ...readJson<Record<string, unknown>>(LAYOUT_KEY, {}), order: nextOrder, minimized: nextMinimized });
  };
  const toggleMinimized = (id: PanelId) => saveLayout(order, minimized.includes(id) ? minimized.filter((p) => p !== id) : [...minimized, id]);
  const move = (id: PanelId, step: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    saveLayout(next, minimized);
  };
  const setNote = setMeetingNote;

  // Tell the right-hand panel what is picked, and clear it when leaving this page.
  const openTexts = open.map((a) => a.text);
  useEffect(() => {
    if (pickedEvent) {
      setMeetingSelection({ key: pickedEvent.key, noteKey: pickedEvent.key, kind: 'event', title: pickedEvent.title, sub: pickedEvent.sub, open: [], discussed: 0 });
    } else if (current) {
      setMeetingSelection({ key: `meeting:${current.projectId}`, noteKey: current.projectId, kind: 'project', title: current.name, sub: current.meeting || 'No meeting set yet', color: current.color, projectId: current.projectId, open: openTexts, discussed: done.length });
    } else {
      setMeetingSelection(null);
    }
  }, [pickedEvent, current?.projectId, current?.name, current?.meeting, current?.color, openTexts.join('\n'), done.length]);
  useEffect(() => () => setMeetingSelection(null), []);

  const panel = 'min-h-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:overflow-y-auto';
  const smallBtn = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200';

  // One small panel in the middle, with its own minimize and move buttons.
  const renderBox = (id: PanelId, body: React.ReactNode) => {
    const isMin = minimized.includes(id);
    const i = order.indexOf(id);
    const title = PANEL_TITLES[id];
    return (
      <section key={id} aria-label={title} className="rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button onClick={() => toggleMinimized(id)} aria-expanded={!isMin} title={isMin ? 'Show this panel' : 'Minimize this panel'} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {isMin ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            <span className="truncate">{title}</span>
          </button>
          <button onClick={() => move(id, -1)} disabled={i <= 0} aria-label={`Move ${title} up`} title="Move up" className={smallBtn}><ArrowUp className="h-3.5 w-3.5" /></button>
          <button onClick={() => move(id, 1)} disabled={i >= order.length - 1} aria-label={`Move ${title} down`} title="Move down" className={smallBtn}><ArrowDown className="h-3.5 w-3.5" /></button>
        </div>
        {!isMin && <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-700">{body}</div>}
      </section>
    );
  };

  const bodies = (m: Meeting): Record<PanelId, React.ReactNode> => ({
    topics: (
      <>
        <ul className="space-y-1">
          {open.map((a) => (
            <li key={a.id} className="group flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
              <input type="checkbox" checked={false} onChange={() => change(m.projectId, { id: a.id, done: true })} aria-label={`Discussed: ${a.text}`} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span className="flex-1">{a.text}</span>
              {others.length > 0 && (
                <input type="checkbox" checked={chosen.includes(a.id)} onChange={() => setChosen((c) => (c.includes(a.id) ? c.filter((x) => x !== a.id) : [...c, a.id]))} aria-label={`Pick to send to another meeting: ${a.text}`} title="Pick to send to another meeting" className="mt-0.5 h-4 w-4 accent-emerald-600" />
              )}
              <button onClick={() => change(m.projectId, { id: a.id, remove: true })} aria-label={`Remove ${a.text}`} className="text-slate-400 opacity-0 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"><X className="h-4 w-4" /></button>
            </li>
          ))}
          {!open.length && <li className={ui.empty}>No topics yet.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { change(m.projectId, { text: t }); setDraft(''); } }} className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a topic" aria-label={`Add a topic for ${m.name}`} className={ui.field} />
          <button disabled={!draft.trim()} aria-label="Add topic" className={ui.btn}><Plus className="h-4 w-4" /></button>
        </form>
        {others.length > 0 && open.length > 0 && (
          <div className="space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-800/50">
            <p className="text-xs text-slate-500 dark:text-slate-400">Tick the box on the right of a topic to pick it, then add the picked topics (or all of them) to another meeting.</p>
            <select value={sendTo} onChange={(e) => setSendTo(e.target.value)} aria-label="Which meeting to add topics to" className={ui.field}>
              <option value="">Choose a meeting…</option>
              {others.map((o) => <option key={o.projectId} value={o.projectId}>{o.name}{o.meeting ? ` (${o.meeting})` : ''}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={takeOff} onChange={(e) => setTakeOff(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              Also take them off this meeting (move instead of copy)
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={!sendTo || !picks.length} onClick={() => sendTopics(m, picks, sendTo, takeOff)} className={ui.btn}>Add picked ({picks.length})</button>
              <button disabled={!sendTo} onClick={() => sendTopics(m, open, sendTo, takeOff)} className={ui.btn}>Add all ({open.length})</button>
            </div>
            {sentNote && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">{sentNote}</p>}
          </div>
        )}
      </>
    ),
    details: (
      <>
        <label className="block text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-1 flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4 shrink-0" /> Next meeting</span>
          <input
            defaultValue={m.meeting || ''}
            key={`${m.projectId}:${m.meeting || 'none'}`}
            onBlur={(e) => e.target.value !== (m.meeting || '') && change(m.projectId, { meeting: e.target.value })}
            placeholder="e.g. Today 5pm"
            aria-label={`Next meeting for ${m.name}`}
            className={ui.field}
          />
        </label>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {open.length} {open.length === 1 ? 'topic' : 'topics'} to discuss · {done.length} discussed
        </p>
        {onOpenProject && (
          <button onClick={() => onOpenProject(m.projectId)} title="Open the project (Chief tab has the chat)" className={ui.btn}>
            <MessagesSquare className="h-4 w-4" /> Chat with Chief
          </button>
        )}
      </>
    ),
    discussed: (
      <>
        {done.length > 0 && (
          <p className="flex items-center text-xs text-slate-500 dark:text-slate-400">
            <span className="flex-1">{done.length} talked through</span>
            <button onClick={() => change(m.projectId, { clearDone: true })} className="text-indigo-600 hover:underline dark:text-indigo-400">clear them</button>
          </p>
        )}
        <ul className="space-y-1">
          {done.map((a) => (
            <li key={a.id} className="text-sm text-slate-500 line-through dark:text-slate-400">{a.text}</li>
          ))}
          {!done.length && <li className={ui.empty}>Nothing has been discussed yet.</li>}
        </ul>
      </>
    ),
    notes: (
      <textarea
        value={notes[m.projectId] || ''}
        onChange={(e) => setNote(m.projectId, e.target.value)}
        rows={5}
        placeholder="Jot down anything for this meeting. Saved on this device only."
        aria-label={`My notes for ${m.name}`}
        className={ui.field}
      />
    ),
  });

  const selectedKey = pickedEvent ? pickedEvent.key : picked ? `meeting:${picked}` : '';

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 lg:h-full lg:min-h-0">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white"><CalendarClock className="h-6 w-6 text-indigo-500" /> Meetings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pick a meeting on the left to see it here. Each panel can be minimized or moved up and down.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {list === null && !error && <p className={ui.empty}>Loading…</p>}
      {list && !list.length && <p className={ui.empty}>No projects yet. Make one first, then plan its meetings here.</p>}
      {list && list.length > 0 && current && (
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* Left: coming up, then the project tabs */}
          <aside aria-label="Meetings and projects" className={`${panel} space-y-3`}>
            <UpcomingPanel refreshKey={loads} onPickProject={pick} onPickEvent={setPickedEvent} selectedKey={selectedKey} onChanged={load}>
            <nav aria-label="Projects" className="border-t border-slate-200 pt-2 dark:border-slate-800">
              <h2 className="pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <button onClick={toggleProjects} aria-expanded={!projectsMinimized} title={projectsMinimized ? 'Show the projects' : 'Minimize the projects'} className="flex w-full items-center gap-1 rounded px-1 text-left uppercase tracking-wide hover:text-slate-700 dark:hover:text-slate-200">
                  {projectsMinimized ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <span className="flex-1">Projects</span>
                  {projectsMinimized && <span className="text-[10px] font-normal tabular-nums">{list.length}</span>}
                </button>
              </h2>
              <ul className={`space-y-0.5 ${projectsMinimized ? 'hidden' : ''}`}>
                {list.map((m) => {
                  const count = m.agenda.filter((a) => !a.done).length;
                  const active = !pickedEvent && m.projectId === current.projectId;
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

          {/* Middle: what you picked, as panels you can minimize and rearrange */}
          <section aria-label={pickedEvent ? `Details for ${pickedEvent.title}` : `Meeting for ${current.name}`} className={`${panel} space-y-3`}>
            {pickedEvent ? (
              <>
                <div className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <CalendarClock className="mt-1 h-5 w-5 shrink-0 text-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-semibold text-slate-900 dark:text-white">{pickedEvent.title}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{pickedEvent.sub || 'No time set'} · your own event, saved on this device</p>
                  </div>
                  <button onClick={() => setPickedEvent(null)} className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:text-slate-200">Back to {current.name}</button>
                </div>
                <section aria-label="Notes" className="rounded-lg border border-slate-200 dark:border-slate-700">
                  <button onClick={() => setEventNotesOpen((v) => !v)} aria-expanded={eventNotesOpen} title={eventNotesOpen ? 'Hide the notes' : 'Add or read notes'} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {eventNotesOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="flex-1">{notes[pickedEvent.key]?.trim() ? 'Notes' : 'Add notes'}</span>
                  </button>
                  {eventNotesOpen && (
                    <div className="border-t border-slate-200 p-3 dark:border-slate-700">
                      <textarea
                        value={notes[pickedEvent.key] || ''}
                        onChange={(e) => setNote(pickedEvent.key, e.target.value)}
                        rows={8}
                        placeholder="Jot down anything for this event. Saved on this device only."
                        aria-label={`Notes for ${pickedEvent.title}`}
                        className={ui.field}
                      />
                    </div>
                  )}
                </section>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: current.color }} />
                  <h2 className="flex-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{current.name}</h2>
                  <span className="truncate text-sm text-slate-500 dark:text-slate-400">{current.meeting || 'No meeting set yet'}</span>
                </div>
                {order.map((id) => renderBox(id, bodies(current)[id]))}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
