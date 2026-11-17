import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, ChevronLeft, Flag, Map, MessagesSquare } from 'lucide-react';
import { setMeetingNote, useMeetingSelection } from '../meetingSelection.ts';
import { ProjectChat } from './ProjectChat.tsx';
import { MissionView, JourneyView } from './ProjectPages.tsx';
import type { PanelProject } from './BottomPanel.tsx';
import { WorkloadTab } from './ProjectVisuals.tsx';
import { roadmapProgress } from './Roadmap.tsx';
import { PROJECT_PANELS } from '../panelMeta.ts';

// The right-hand panel, shown on every page when only one page is open on a wide screen. It always follows the
// project you have open on the Projects page.
// Health summary, the project's buttons (moved here from the page header, Projects page only), then the project tools.
// Drag its left edge to make it wider or narrower; the size is remembered.
type SideTab = 'meeting' | 'mission' | 'chief' | 'journey' | 'workload';
const SIDE_TABS: { id: SideTab; label: string; icon: React.ElementType }[] = [
  { id: 'meeting', label: 'Meeting', icon: CalendarClock },
  { id: 'mission', label: 'Mission', icon: Flag },
  { id: 'chief', label: 'Chief', icon: MessagesSquare },
  { id: 'journey', label: 'Journey', icon: Map },
  { id: 'workload', label: 'Workload', icon: PROJECT_PANELS.find((p) => p.id === 'workload')!.icon },
];
const ORDER: SideTab[] = ['mission', 'chief', 'journey', 'workload']; // the Meeting tab is added in front of these only on the Meetings page
const MIN_W = 320;
const DEFAULT_W = 720; // "double wide"

const read = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

// The box the Projects page draws its header buttons into while this panel is open.
const ACTIONS_EVENT = 'eden-side-actions';
let actionsBox: HTMLElement | null = null;
const setActionsBox = (el: HTMLElement | null) => {
  actionsBox = el;
  window.dispatchEvent(new Event(ACTIONS_EVENT));
};
export function useSideActionsTarget(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(actionsBox);
  useEffect(() => {
    const sync = () => setEl(actionsBox);
    sync();
    window.addEventListener(ACTIONS_EVENT, sync);
    return () => window.removeEventListener(ACTIONS_EVENT, sync);
  }, []);
  return el;
}

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
    <span className="h-3 w-0.5 rounded-full bg-indigo-500" /> {children}
  </h3>
);

// What you picked on the Meetings page: when it is, its topics, and a place for notes (shared with the middle).
const MeetingTab: React.FC = () => {
  const { selection: s, notes } = useMeetingSelection();
  if (!s) return <p className="text-sm text-slate-500 dark:text-slate-400">Pick a meeting on the left to see its details here.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {s.color ? <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} /> : <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />}
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-base font-semibold text-slate-900 dark:text-white">{s.title}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">{s.sub || 'No time set'}{s.kind === 'event' ? ' · your own event, saved on this device' : ''}</p>
        </div>
      </div>
      {s.kind === 'project' && (
        <div>
          <Label>Topics to discuss</Label>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800 dark:text-slate-100">
            {s.open.map((t, i) => <li key={`${i}:${t}`}>{t}</li>)}
          </ul>
          {!s.open.length && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No topics yet. Add them in the middle.</p>}
          {s.discussed > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{s.discussed} already discussed</p>}
        </div>
      )}
      <div>
        <Label>Notes</Label>
        <textarea
          value={notes[s.noteKey] || ''}
          onChange={(e) => setMeetingNote(s.noteKey, e.target.value)}
          rows={6}
          placeholder="Add notes for this meeting. Saved on this device only."
          aria-label={`Notes for ${s.title}`}
          className="mt-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
    </div>
  );
};

export const ProjectSidePanel: React.FC<{ project: PanelProject; showActions?: boolean; showMeeting?: boolean }> = ({ project, showActions = true, showMeeting = false }) => {
  const [tab, setTabState] = useState<SideTab>(() => (ORDER.includes(read('eden_side_tab', 'mission') as SideTab) ? (read('eden_side_tab', 'mission') as SideTab) : 'mission'));
  const [closed, setClosed] = useState(() => read('eden_side_closed', '') === '1');
  const [width, setWidth] = useState(() => Math.max(MIN_W, Number(read('eden_side_width', String(DEFAULT_W))) || DEFAULT_W));
  const setTab = (t: SideTab) => { setTabState(t); if (t !== 'meeting') write('eden_side_tab', t); };
  // Picking a different meeting brings the Meeting tab forward.
  const pickedKey = useMeetingSelection().selection?.key || '';
  useEffect(() => { if (showMeeting && pickedKey) setTabState('meeting'); }, [showMeeting, pickedKey]);
  const tabs: SideTab[] = showMeeting ? ['meeting', ...ORDER] : ORDER;
  const shownTab: SideTab = tabs.includes(tab) ? tab : 'mission';
  const toggle = () => { setClosed((c) => { write('eden_side_closed', c ? '' : '1'); return !c; }); };
  const boxRef = useCallback((el: HTMLDivElement | null) => setActionsBox(el), []);
  useEffect(() => () => setActionsBox(null), []);

  // Drag the left edge: wider to the left, narrower to the right (at most 70% of the window).
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(window.innerWidth * 0.7, Math.max(MIN_W, startW + (startX - ev.clientX))));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      write('eden_side_width', String(w));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (closed) {
    return (
      <button onClick={toggle} title="Show the project panel" aria-label="Show the project panel" style={{ order: 3 }} className="hidden w-8 shrink-0 items-start justify-center border-l border-slate-200 pt-4 text-slate-500 hover:bg-slate-50 hover:text-slate-800 xl:flex dark:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200">
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  const cards = project.cards.filter((c) => c.projectId === project.project.id);
  const done = cards.filter((c) => c.column === 'done').length;
  const running = cards.filter((c) => c.runState === 'running').length;
  const failed = cards.filter((c) => c.runState === 'failed').length;
  const review = cards.filter((c) => c.column === 'review').length;
  const rm = roadmapProgress(project.project.roadmap);
  const pct = rm ? rm.pct : cards.length ? Math.round((done / cards.length) * 100) : 0;
  const r = 34, circ = 2 * Math.PI * r;
  const narrow = width < 520;
  const square = 'flex h-16 flex-col items-center justify-center gap-2 rounded-xl border-2 p-2 text-center text-sm font-medium transition-colors';

  return (
    <aside aria-label="Project panel" style={{ order: 3, width: `min(${width}px, 50vw)`, minWidth: MIN_W }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/plain')) e.preventDefault(); }}
      onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); if (id && project.cards.some((c) => c.id === id)) { e.preventDefault(); project.onOpenCard(id); } }}
      className="relative hidden shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-slate-50 xl:flex dark:border-slate-800 dark:bg-slate-950">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the project panel"
        title="Drag to resize"
        onPointerDown={startDrag}
        onDoubleClick={() => { setWidth(DEFAULT_W); write('eden_side_width', String(DEFAULT_W)); }}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-indigo-400/60"
      />

      {/* Everything scrolls together when the window is too short to show it all. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain p-3">
      <section className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <Label>Project health</Label>
          <button onClick={toggle} title="Hide the project panel" aria-label="Hide the project panel" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white" title={project.project.name}>{project.project.name}</p>
        <div className="mt-3 flex items-center gap-5">
          <svg viewBox="0 0 80 80" className={`${narrow ? 'h-20 w-20' : 'h-28 w-28'} shrink-0`} role="img" aria-label={`${pct}% ${rm ? 'of the roadmap' : 'of cards'} done`}>
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-800" />
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-emerald-500" strokeDasharray={`${(pct / 100) * circ} ${circ}`} transform="rotate(-90 40 40)" />
            <text x="40" y="45" textAnchor="middle" className="fill-slate-900 text-[16px] font-bold dark:fill-white">{pct}%</text>
          </svg>
          <dl className={`grid flex-1 gap-x-4 gap-y-2 ${narrow ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {[['Cards', cards.length], ['Done', done], ['Working', running], ['To review', review], ['Failed', failed], ['Blocks', rm ? `${rm.done}/${rm.total}` : '–']].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className={`text-lg font-semibold tabular-nums ${k === 'Failed' && failed ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {showActions && (
      <section className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Label>Project</Label>
        {/* The Projects page draws its buttons (Plan with Chief, AI works Ready cards, team, Settings, Sync, New AZI project) here. */}
        <div
          ref={boxRef}
          className={`mt-3 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-2 [&>button]:!flex [&>button]:!h-20 [&>button]:!flex-col [&>button]:!items-center [&>button]:!justify-center [&>button]:!gap-2 [&>button]:!whitespace-normal [&>button]:!rounded-xl [&>button]:!p-2 [&>button]:!text-center [&>button]:!text-xs [&>button_svg]:!h-6 [&>button_svg]:!w-6`}
        />
      </section>
      )}

      <section className="flex shrink-0 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div role="tablist" aria-label="Project tools" className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
          {tabs.map((id) => {
            const t = SIDE_TABS.find((x) => x.id === id)!;
            const Icon = t.icon;
            const on = shownTab === id;
            return (
              <button key={id} role="tab" aria-selected={on} onClick={() => setTab(id)} title={t.label}
                className={`${square} ${on ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 text-slate-700 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-indigo-500'}`}>
                <Icon className="h-5 w-5" />
                {t.label}
                {id === 'journey' && rm && <span className="text-xs tabular-nums opacity-80">{rm.pct}%</span>}
              </button>
            );
          })}
        </div>
        <div className="overflow-x-hidden p-3">
          {shownTab === 'meeting' && <MeetingTab />}
          {shownTab === 'mission' && <div className="@container"><MissionView {...project} /></div>}
          {shownTab === 'chief' && <ProjectChat projectId={project.project.id} />}
          {shownTab === 'journey' && <JourneyView {...project} />}
          {shownTab === 'workload' && <WorkloadTab {...project} />}
        </div>
      </section>
      </div>
    </aside>
  );
};
