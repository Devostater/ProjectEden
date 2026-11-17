import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, Pin, Plus, X } from 'lucide-react';

// The meetings panel in the left bar, top to bottom: what needs attention (next meeting of each project,
// your own events, anything pinned), a button to add a meeting, and the past meetings at the bottom.
// Project meetings come from the Meetings page; your own events and pins are saved on this device only.
interface MeetingInfo { projectId: string; name: string; color: string; meeting?: string; agenda?: { done: boolean }[] }
interface OwnEvent { id: string; text: string; when: string } // when: "2026-11-20T17:00", or empty if no time was set
interface Row { key: string; title: string; sub: string; color?: string; pinned: boolean; time: number | null; own: boolean; past: boolean }

const EVENTS_KEY = 'eden_upcoming_events';
const PINS_KEY = 'eden_upcoming_pins';

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const whenText = (when: string) => {
  const d = new Date(when);
  if (!when || Number.isNaN(d.getTime())) return '';
  const day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return when.length > 10 ? `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day;
};

// Anything passed as children (the project tabs) sits between "Add a meeting" and the past meetings.
export const UpcomingPanel: React.FC<{ refreshKey: string | number; onPickProject: (projectId: string) => void; children?: React.ReactNode }> = ({ refreshKey, onPickProject, children }) => {
  const [meetings, setMeetings] = useState<MeetingInfo[]>([]);
  const [events, setEvents] = useState<OwnEvent[]>(() => (Array.isArray(read(EVENTS_KEY, [])) ? read<OwnEvent[]>(EVENTS_KEY, []) : []));
  const [pins, setPins] = useState<string[]>(() => (Array.isArray(read(PINS_KEY, [])) ? read<string[]>(PINS_KEY, []) : []));
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');

  const load = useCallback(() => {
    fetch('/api/meetings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMeetings(Array.isArray(d.meetings) ? d.meetings : []))
      .catch(() => {});
  }, []);
  // Refresh when the page changes (so edits on the Meetings page show up here) and every minute.
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  const saveEvents = (next: OwnEvent[]) => { setEvents(next); write(EVENTS_KEY, next); };
  const savePins = (next: string[]) => { setPins(next); write(PINS_KEY, next); };
  const togglePin = (key: string) => savePins(pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key]);
  const addEvent = () => {
    const t = text.trim();
    if (!t) return;
    saveEvents([...events, { id: `ev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: t, when }]);
    setText('');
    setWhen('');
    setAdding(false);
  };
  const removeEvent = (id: string) => {
    saveEvents(events.filter((e) => e.id !== id));
    savePins(pins.filter((k) => k !== `event:${id}`));
  };

  const now = Date.now();
  const topicsText = (m: MeetingInfo) => {
    const n = (m.agenda || []).filter((a) => !a.done).length;
    return n > 0 ? ` · ${n} ${n === 1 ? 'topic' : 'topics'} to discuss` : '';
  };
  const rows: Row[] = [
    ...meetings
      .filter((m) => m.meeting)
      .map((m): Row => ({ key: `meeting:${m.projectId}`, title: m.meeting as string, sub: `${m.name}${topicsText(m)}`, color: m.color, pinned: pins.includes(`meeting:${m.projectId}`), time: null, own: false, past: false })),
    // Projects with topics waiting but no meeting set yet also need a look.
    ...meetings
      .filter((m) => !m.meeting && (m.agenda || []).some((a) => !a.done))
      .map((m): Row => ({ key: `meeting:${m.projectId}`, title: 'No meeting set yet', sub: `${m.name}${topicsText(m)}`, color: m.color, pinned: pins.includes(`meeting:${m.projectId}`), time: null, own: false, past: false })),
    ...events.map((e): Row => {
      const t = e.when ? new Date(e.when).getTime() : NaN;
      return { key: `event:${e.id}`, title: e.text, sub: whenText(e.when), pinned: pins.includes(`event:${e.id}`), time: Number.isNaN(t) ? null : t, own: true, past: !Number.isNaN(t) && t < now };
    }),
  ];
  // Pinned first, then things with a date (soonest first), then the rest in the order they were added.
  const order = (r: Row) => (r.past ? 3 : r.time !== null ? 1 : 2);
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(b.r.pinned) - Number(a.r.pinned) || order(a.r) - order(b.r) || (a.r.time ?? 0) - (b.r.time ?? 0) || a.i - b.i)
    .map((x) => x.r);

  // Top: what needs attention. Then: add a meeting. Bottom: everything that is already past.
  const attention = sorted.filter((r) => !r.past);
  const earlier = sorted.filter((r) => r.past);

  const field = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
  const heading = 'flex items-center gap-2 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  const renderRow = (r: Row) => (
    <li key={r.key} className={`group flex items-start gap-1.5 rounded-md px-1 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800/60 ${r.past ? 'opacity-50' : ''}`}>
      {r.color ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} /> : <CalendarClock className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />}
      <button onClick={() => r.key.startsWith('meeting:') && onPickProject(r.key.slice('meeting:'.length))} title={r.own ? undefined : 'Show this project'} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-slate-800 dark:text-slate-100">{r.title}</span>
        {r.sub && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{r.past ? `Past · ${r.sub}` : r.sub}</span>}
      </button>
      <button
        onClick={() => togglePin(r.key)}
        aria-pressed={r.pinned}
        aria-label={r.pinned ? `Unpin ${r.title}` : `Pin ${r.title}`}
        title={r.pinned ? 'Unpin' : 'Pin to the top'}
        className={`rounded p-0.5 ${r.pinned ? 'text-indigo-500' : 'text-slate-400 opacity-0 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100 dark:hover:text-slate-200'}`}
      >
        <Pin className={`h-3 w-3 ${r.pinned ? 'fill-current' : ''}`} />
      </button>
      {r.own && (
        <button onClick={() => removeEvent(r.key.slice('event:'.length))} aria-label={`Remove ${r.title}`} title="Remove" className="rounded p-0.5 text-slate-400 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );

  return (
    <div className="space-y-3">
      {/* 1. What needs attention */}
      <section aria-label="Needs attention" className="px-1 py-1">
        <h2 className={heading}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Needs attention</span>
          {attention.length > 0 && <span className="ml-auto text-[10px] font-normal tabular-nums">{attention.length}</span>}
        </h2>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {attention.map(renderRow)}
          {!attention.length && <li className="px-1 py-1 text-xs text-slate-500 dark:text-slate-400">Nothing needs attention right now.</li>}
        </ul>
      </section>

      {/* 2. Add a meeting */}
      <section aria-label="Add a meeting" className="border-t border-slate-200 px-1 pt-2 dark:border-slate-800">
        {adding ? (
          <form onSubmit={(e) => { e.preventDefault(); addEvent(); }} className="space-y-1 rounded-md border border-slate-200 p-2 dark:border-slate-700">
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What is it? e.g. Playtest" aria-label="Meeting name" className={field} />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When" className={field} />
            <div className="flex gap-1">
              <button disabled={!text.trim()} className="min-h-7 flex-1 rounded-md bg-indigo-600 text-xs font-semibold text-white disabled:opacity-40">Add</button>
              <button type="button" onClick={() => setAdding(false)} className="min-h-7 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-600 dark:text-slate-200">Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-indigo-300 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
            <Plus className="h-4 w-4" /> Add a meeting
          </button>
        )}
      </section>

      {children}

      {/* 3. Past meetings, at the bottom */}
      <section aria-label="Past meetings" className="border-t border-slate-200 px-1 pt-2 dark:border-slate-800">
        <h2 className={heading}>Past meetings</h2>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
          {earlier.map(renderRow)}
          {!earlier.length && <li className="px-1 py-1 text-xs text-slate-500 dark:text-slate-400">No past meetings yet.</li>}
        </ul>
      </section>
    </div>
  );
};
