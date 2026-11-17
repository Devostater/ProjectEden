import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, Pin, Plus, X } from 'lucide-react';

// The meetings panel in the left bar, top to bottom: what needs attention (next meeting of each project,
// your own events, anything pinned), a button to add a meeting, and the past meetings at the bottom.
// Project meetings come from the Meetings page; your own events and pins are saved on this device only.
interface MeetingInfo { projectId: string; name: string; color: string; meeting?: string; agenda?: { done: boolean }[] }
type Repeat = '' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
interface OwnEvent { id: string; text: string; when: string; repeat?: Repeat } // when: "2026-11-20T17:00", or empty if no time was set
interface Row { key: string; title: string; sub: string; color?: string; pinned: boolean; time: number | null; own: boolean; past: boolean; unscheduled?: boolean }

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

const REPEAT_OPTIONS: { value: Repeat; label: string; sub: string }[] = [
  { value: '', label: 'Does not repeat', sub: '' },
  { value: 'daily', label: 'Every day', sub: 'Repeats every day' },
  { value: 'weekly', label: 'Every week', sub: 'Repeats every week' },
  { value: 'biweekly', label: 'Every 2 weeks', sub: 'Repeats every 2 weeks' },
  { value: 'monthly', label: 'Every month', sub: 'Repeats every month' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The next time a repeating event happens (or the first time, if that is still ahead). Others just keep their own time.
const nextTime = (when: string, repeat: Repeat | undefined, now: number): number => {
  const start = new Date(when);
  const t = start.getTime();
  if (!when || Number.isNaN(t) || !repeat || t >= now) return t;
  if (repeat === 'monthly') {
    let k = Math.max(1, (new Date(now).getFullYear() - start.getFullYear()) * 12 + new Date(now).getMonth() - start.getMonth());
    let d = new Date(start);
    for (;;) {
      d = new Date(start);
      d.setMonth(start.getMonth() + k);
      if (d.getTime() >= now) return d.getTime();
      k += 1;
    }
  }
  const step = (repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : 14) * 24 * 60 * 60 * 1000;
  const d = new Date(start);
  const days = repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : 14;
  const n = Math.ceil((now - t) / step);
  d.setDate(start.getDate() + n * days); // by calendar day, so the clock time stays the same across daylight saving changes
  return d.getTime();
};

// Anything passed as children (the project tabs) sits between "Add a meeting" and the past meetings.
// onPickEvent is called when one of your own events is clicked; selectedKey marks the row that is showing in the middle.
export interface PickedEvent { key: string; title: string; sub: string }
export const UpcomingPanel: React.FC<{ refreshKey: string | number; onPickProject: (projectId: string) => void; onPickEvent?: (event: PickedEvent) => void; selectedKey?: string; onChanged?: () => void; children?: React.ReactNode }> = ({ refreshKey, onPickProject, onPickEvent, selectedKey, onChanged, children }) => {
  const [meetings, setMeetings] = useState<MeetingInfo[]>([]);
  const [scheduling, setScheduling] = useState(''); // project id of the "Schedule a meeting" box, empty when closed
  const [schedWhen, setSchedWhen] = useState('');
  const [schedError, setSchedError] = useState('');
  const [schedSaving, setSchedSaving] = useState(false);
  const [events, setEvents] = useState<OwnEvent[]>(() => (Array.isArray(read(EVENTS_KEY, [])) ? read<OwnEvent[]>(EVENTS_KEY, []) : []));
  const [pins, setPins] = useState<string[]>(() => (Array.isArray(read(PINS_KEY, [])) ? read<string[]>(PINS_KEY, []) : []));
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('');

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
    saveEvents([...events, { id: `ev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: t, when, ...(when && repeat ? { repeat } : {}) }]);
    setText('');
    setWhen('');
    setRepeat('');
    setAdding(false);
  };
  const removeEvent = (id: string) => {
    saveEvents(events.filter((e) => e.id !== id));
    savePins(pins.filter((k) => k !== `event:${id}`));
  };

  const openSchedule = (projectId: string) => {
    onPickProject(projectId);
    setSchedWhen('');
    setSchedError('');
    setScheduling(projectId);
  };
  const closeSchedule = () => setScheduling('');
  // Close the box with the Escape key.
  useEffect(() => {
    if (!scheduling) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setScheduling('');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scheduling]);
  const saveSchedule = async () => {
    const text = whenText(schedWhen);
    if (!text || !scheduling) return;
    setSchedSaving(true);
    setSchedError('');
    try {
      const r = await fetch(`/api/projects/${scheduling}/agenda`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meeting: text }) });
      if (!r.ok) throw new Error('save failed');
      load();
      onChanged?.();
      setScheduling('');
    } catch {
      setSchedError('Could not save that. Try again.');
    } finally {
      setSchedSaving(false);
    }
  };
  const schedProject = meetings.find((m) => m.projectId === scheduling);

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
      .map((m): Row => ({ key: `meeting:${m.projectId}`, title: 'No meeting set yet', sub: `${m.name}${topicsText(m)}`, color: m.color, pinned: pins.includes(`meeting:${m.projectId}`), time: null, own: false, past: false, unscheduled: true })),
    ...events.map((e): Row => {
      const t = e.when ? nextTime(e.when, e.repeat, now) : NaN;
      const repeatSub = e.repeat && !Number.isNaN(t) ? REPEAT_OPTIONS.find((o) => o.value === e.repeat)?.sub : '';
      const sub = [whenText(Number.isNaN(t) ? e.when : toLocalInput(new Date(t))), repeatSub].filter(Boolean).join(' · ');
      return { key: `event:${e.id}`, title: e.text, sub, pinned: pins.includes(`event:${e.id}`), time: Number.isNaN(t) ? null : t, own: true, past: !Number.isNaN(t) && t < now };
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
    <li key={r.key} className={`group flex items-start gap-1.5 rounded-md px-1 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800/60 ${selectedKey === r.key ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''} ${r.past ? 'opacity-50' : ''}`}>
      {r.color ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} /> : <CalendarClock className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />}
      <button
        onClick={() => {
          if (!r.key.startsWith('meeting:')) {
            onPickEvent?.({ key: r.key, title: r.title, sub: r.sub });
            return;
          }
          const id = r.key.slice('meeting:'.length);
          if (r.unscheduled) openSchedule(id);
          else onPickProject(id);
        }}
        title={r.own ? 'Show this event' : r.unscheduled ? 'Schedule a meeting' : 'Show this meeting'}
        className="min-w-0 flex-1 text-left"
      >
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
            <select value={when ? repeat : ''} onChange={(e) => setRepeat(e.target.value as Repeat)} disabled={!when} aria-label="Does it repeat?" title={when ? undefined : 'Pick a day and time first'} className={`${field} disabled:opacity-50`}>
              {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="flex gap-1">
              <button disabled={!text.trim()} className="min-h-7 flex-1 rounded-md bg-indigo-600 text-xs font-semibold text-white disabled:opacity-40">Add</button>
              <button type="button" onClick={() => { setAdding(false); setRepeat(''); }} className="min-h-7 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-600 dark:text-slate-200">Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-indigo-300 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
            <Plus className="h-4 w-4" /> Add a meeting
          </button>
        )}
      </section>

      {children}

      {/* Big "Schedule a meeting" box, opened from a "No meeting set yet" row */}
      {scheduling && schedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={closeSchedule}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label={`Schedule a meeting for ${schedProject.name}`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveSchedule(); }}
            className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 sm:p-8"
          >
            <div className="flex items-start gap-3">
              <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: schedProject.color }} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Schedule a meeting</h2>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">{schedProject.name}{topicsText(schedProject)}</p>
              </div>
              <button type="button" onClick={closeSchedule} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Day and time
              <input autoFocus type="datetime-local" value={schedWhen} onChange={(e) => setSchedWhen(e.target.value)} className={`${field} mt-1 !py-2 !text-sm`} />
            </label>
            {(schedProject.agenda || []).some((a) => !a.done) && (
              <p className="text-sm text-slate-600 dark:text-slate-300">The topics waiting for this project are on the Meetings page, in the middle.</p>
            )}
            {schedError && <p role="alert" className="text-sm text-red-600">{schedError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeSchedule} className="min-h-9 rounded-md border border-slate-300 px-4 text-sm dark:border-slate-600 dark:text-slate-200">Cancel</button>
              <button disabled={!schedWhen || schedSaving} className="min-h-9 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{schedSaving ? 'Saving…' : 'Schedule meeting'}</button>
            </div>
          </form>
        </div>
      )}

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
