import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Activity, TerminalSquare, Trash2, Workflow, Users, TrendingUp, Maximize2, Minimize2, ZoomIn, ZoomOut, Scan, Inbox, Hammer, Wrench, Expand, Shrink, Eye, Footprints, ArrowLeftRight, Copy, Check, SlidersHorizontal, EyeOff } from 'lucide-react';
import type { Agent, Card, Project, RoadmapGoal } from '../types/index.ts';
import { FlowTab, WorkloadTab, ProgressTab } from './ProjectVisuals.tsx';
import { Roadmap, roadmapProgress } from './Roadmap.tsx';
import { Toolbox } from './Toolbox.tsx';
import { PreviewTab } from './PreviewTab.tsx';
import { WorkTrail } from './WorkTrail.tsx';
import { Arrangeable, useArrangedOrder } from '../arrange.tsx';
import { ReviewTab, type ReviewProps } from './ReviewTab.tsx';
import { LyraPanel, LyraChibi } from './LyraPanel.tsx';
import { OPEN_PANEL_EVENT } from '../panel.ts';
import { UsagePanel } from './UsageBars.tsx';
import { useSideActionsTarget } from './ProjectSidePanel.tsx';
import { PauseAI } from './PauseAI.tsx';

type PanelTab = 'flow' | 'workload' | 'progress' | 'trail' | 'roadmap' | 'toolbox' | 'preview' | 'review' | 'lyra' | 'activity' | 'terminal';
const PROJECT_TABS: PanelTab[] = ['flow', 'workload', 'progress', 'trail', 'roadmap', 'toolbox', 'preview'];
const ALL_TABS: PanelTab[] = [...PROJECT_TABS, 'review', 'lyra', 'activity', 'terminal'];

// The little LYRA face used as the tab's icon.
const LyraIcon: React.FC<{ className?: string }> = () => <LyraChibi connected className="h-5 w-5" />;

// Set while the Projects page is open: adds the Flow, Workload and Progress tabs for that project.
export interface PanelProject {
  project: Project;
  cards: Card[];
  agents: Agent[];
  onOpenCard: (id: string) => void;
  onSaveRoadmap: (roadmap: RoadmapGoal[]) => Promise<void>;
  onSaveProject: (p: Partial<Project>) => Promise<void>;
}

interface ActivityEntry {
  id: number;
  at: string;
  kind: 'info' | 'work' | 'done' | 'error';
  text: string; // the short version
  full?: string; // the whole message, only when it was longer than the short version (older saved lines don't have it)
  hint?: { explain: string; action: string }; // plain explanation and suggestion for common failures
  retry?: { kind: 'card' | 'update'; id: string }; // what Retry runs again
}

interface TerminalLine {
  id: number;
  cwd: string;
  command: string;
  output: string;
  exitCode: number | null; // null while running
}

const OPEN_KEY = 'eden_panel_open';
const TAB_KEY = 'eden_panel_tab';
const HEIGHT_KEY = 'eden_panel_height';
const MIN_HEIGHT = 150;

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const KIND_STYLE: Record<ActivityEntry['kind'], string> = {
  info: 'text-slate-500 dark:text-slate-400',
  work: 'text-indigo-600 dark:text-indigo-400',
  done: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

export const BottomPanel: React.FC<{
  onOpenPreferences: () => void;
  onRetryCard: (cardId: string) => Promise<boolean>; // false when the card is no longer failed
  project?: PanelProject | null;
  review: ReviewProps;
  working?: number; // AI jobs running right now, shown as a number beside Activity
  onOpenWorkers?: () => void;
}> = ({ onOpenPreferences, onRetryCard, project, review, working = 0, onOpenWorkers }) => {
  const [open, setOpen] = useState(() => read(OPEN_KEY, '0') === '1');
  const [savedTab, setTab] = useState<PanelTab>(() => {
    const saved = read(TAB_KEY, 'activity') as PanelTab;
    return ALL_TABS.includes(saved) ? saved : 'activity';
  });
  // Project tabs only exist on the Projects page; elsewhere fall back to Activity.
  const tab: PanelTab = PROJECT_TABS.includes(savedTab) && !project ? 'activity' : savedTab;

  const [actSub, setActSubState] = useState<'log' | 'usage' | 'pause'>(() => { let v = ''; try { v = localStorage.getItem('eden_activity_sub') || ''; } catch {} return v === 'usage' || v === 'pause' ? v : 'log'; });
  const setActSub = (v: 'log' | 'usage' | 'pause') => { setActSubState(v); try { localStorage.setItem('eden_activity_sub', v); } catch {} };
  const [maximized, setMaximized] = useState(false);
  // Large screen: the panel covers the whole window (for a roadmap, a graph, tool output, a preview). Esc leaves it.
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullScreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);
  // Flow graph zoom: 'fit' scales the whole graph to the panel.
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const zoomBy = (delta: number) => setZoom((z) => Math.max(0.4, Math.min(2, Math.round(((z === 'fit' ? 1 : z) + delta) * 10) / 10)));

  // Height: drag the top edge, or focus it and use the arrow keys.
  const [height, setHeight] = useState(() => Math.max(MIN_HEIGHT, Number(read(HEIGHT_KEY, '256')) || 256));
  const clampHeight = (h: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.75, h)));
  const resizeTo = (h: number) => {
    const next = clampHeight(h);
    setHeight(next);
    write(HEIGHT_KEY, String(next));
  };
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setMaximized(false);
    const move = (ev: PointerEvent) => setHeight(clampHeight(window.innerHeight - ev.clientY));
    const stop = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      resizeTo(window.innerHeight - ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  // ---- Activity
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [unread, setUnread] = useState(false);
  // Lines with an id below this were saved from an earlier session of the hub.
  const [sessionStart, setSessionStart] = useState(0);
  const latest = useRef(0);
  const watching = open && tab === 'activity';
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  const activityEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await fetch(`/api/activity?since=${latest.current}`).then((r) => r.json());
        if (!alive) return;
        if (typeof d.sessionStart === 'number') setSessionStart(d.sessionStart);
        // If the saved log was lost, the server counts from 1 again: start over rather than miss its lines.
        if (d.latest < latest.current) {
          latest.current = 0;
          setEntries([]);
          return;
        }
        if (d.entries.length) {
          latest.current = d.latest;
          setEntries((e) => [...e, ...d.entries].slice(-500));
          if (!watchingRef.current) setUnread(true);
        }
      } catch {}
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Long lines: click one to open the whole message; the copy button copies it.
  const [openLines, setOpenLines] = useState<Record<number, boolean>>({});
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const copyLine = async (e: ActivityEntry) => {
    try {
      await navigator.clipboard.writeText(e.full ?? e.text);
      setCopiedLine(e.id);
      setTimeout(() => setCopiedLine((c) => (c === e.id ? null : c)), 1500);
    } catch {}
  };

  // Retry buttons on [error] lines: what happened to each press, by line.
  const [retried, setRetried] = useState<Record<number, string>>({});
  const retry = async (e: ActivityEntry) => {
    if (!e.retry || retried[e.id]) return;
    const say = (msg: string) => setRetried((r) => ({ ...r, [e.id]: msg }));
    say('Trying again…');
    try {
      if (e.retry.kind === 'card') {
        say((await onRetryCard(e.retry.id)) ? 'Sent back to the team. It will start again shortly.' : 'Already handled. Nothing to retry.');
      } else {
        const res = await fetch(`/api/updates/${e.retry.id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await res.json().catch(() => ({}));
        say(res.ok ? 'Started again. Follow it in Code updates.' : d.error || "Couldn't retry that.");
      }
    } catch {
      say("Couldn't retry that. Check the hub is running.");
    }
  };

  useEffect(() => {
    if (watching) {
      setUnread(false);
      activityEnd.current?.scrollIntoView({ block: 'end' });
    }
  }, [watching, entries.length]);

  // ---- Terminal
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cwd, setCwd] = useState('');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const history = useRef<string[]>([]);
  const historyAt = useRef(-1);
  const terminalEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showingTerminal = open && tab === 'terminal';

  useEffect(() => {
    if (!showingTerminal) return;
    const check = () =>
      fetch('/api/terminal')
        .then((r) => r.json())
        .then((d) => {
          setEnabled(d.enabled);
          setCwd((c) => c || d.cwd);
        })
        .catch(() => setEnabled(false));
    check();
    window.addEventListener('eden-settings-changed', check);
    return () => window.removeEventListener('eden-settings-changed', check);
  }, [showingTerminal]);

  useEffect(() => {
    if (showingTerminal) terminalEnd.current?.scrollIntoView({ block: 'end' });
  }, [showingTerminal, lines]);

  const runCommand = async () => {
    const command = input.trim();
    if (!command || running) return;
    setInput('');
    history.current = [command, ...history.current.filter((c) => c !== command)].slice(0, 50);
    historyAt.current = -1;
    if (command === 'clear' || command === 'cls') return setLines([]);
    const id = Date.now();
    setLines((l) => [...l, { id, cwd, command, output: '', exitCode: null }]);
    setRunning(true);
    try {
      const res = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, cwd }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'The command could not be run.');
      if (d.cwd) setCwd(d.cwd);
      setLines((l) => l.map((x) => (x.id === id ? { ...x, output: d.output, exitCode: d.exitCode } : x)));
    } catch (err: any) {
      setLines((l) => l.map((x) => (x.id === id ? { ...x, output: err.message, exitCode: 1 } : x)));
      if (/turned off/.test(err.message)) setEnabled(false);
    } finally {
      setRunning(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const pick = (next: PanelTab) => {
    setTab(next);
    write(TAB_KEY, next);
    if (!open) {
      setOpen(true);
      write(OPEN_KEY, '1');
    }
  };
  // Lets the rest of the app open a tab here: the Dashboard's "Needs you" card, the top bar, voice commands.
  useEffect(() => {
    const show = (e: Event) => {
      const want = (e as CustomEvent).detail as PanelTab;
      if (want === 'review' || want === 'lyra' || want === 'activity' || want === 'terminal') pick(want);
      if ((want === 'trail' || want === 'roadmap' || want === 'toolbox' || want === 'preview') && project) pick(want);
    };
    window.addEventListener(OPEN_PANEL_EVENT, show);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, show);
  }, [open, project?.project.id]);
  const toggle = () => {
    write(OPEN_KEY, open ? '0' : '1');
    setOpen(!open);
    if (open) setFullScreen(false);
  };
  const roadmapPct = project ? roadmapProgress(project.project.roadmap)?.pct : undefined;

  const toolClass =
    'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white';

  // The tabs can be put in any order (Arrange, next to Large screen); saved per device.
  const dockOrder = useArrangedOrder('eden_dock_order', ALL_TABS);
  const [arrangingDock, setArrangingDock] = useState(false);
  // Tabs you hid with Customize (saved on this device). While the Projects side panel is open, its tools are
  // already there, so those tabs leave the bottom bar (Preview stays: the side panel has no Preview).
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem('eden_dock_hidden') || '["toolbox"]'); return Array.isArray(v) ? v : []; } catch { return []; } });
  const toggleHidden = (id: string) => setHiddenTabs((h) => { const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id]; try { localStorage.setItem('eden_dock_hidden', JSON.stringify(next)); } catch {} return next; });
  const sidePanelOpen = !!useSideActionsTarget();
  const inSidePanel = (id: PanelTab) => sidePanelOpen && PROJECT_TABS.includes(id) && id !== 'preview';
  const tabButton = (id: PanelTab, label: React.ReactNode, Icon: React.ElementType, dot = false) => inSidePanel(id) ? null : (
    <Arrangeable key={id} id={id} label={typeof label === 'string' ? label : id.charAt(0).toUpperCase() + id.slice(1)} arr={dockOrder} arranging={arrangingDock} horizontal showing={project ? ALL_TABS : ALL_TABS.filter((t) => !PROJECT_TABS.includes(t))} className="flex shrink-0" hidden={hiddenTabs.includes(id)} onToggleHidden={() => toggleHidden(id)}>
      <button
        onClick={() => pick(id)}
        aria-pressed={open && tab === id}
        className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
          open && tab === id
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4" /> {label}
        {dot && <span className="h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-slate-900" aria-label="New activity" />}
      </button>
    </Arrangeable>
  );

  return (
    <div
      className={`hidden shrink-0 flex-col md:flex border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${open && fullScreen ? 'fixed inset-0 z-[70]' : 'relative z-[5]'}`}
      style={open && fullScreen ? undefined : { height: open ? (maximized ? '75dvh' : height) : '3.25rem' }}
    >
      {open && !fullScreen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') resizeTo(height + 32);
            if (e.key === 'ArrowDown') resizeTo(height - 32);
          }}
          title="Drag to resize"
          className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize hover:bg-indigo-500/40 focus:bg-indigo-500/40 focus:outline-none"
        />
      )}
      <div className="flex h-[3.25rem] shrink-0 items-center border-b border-slate-200 px-2 dark:border-slate-800">
        <div className="flex min-w-0 flex-1 items-center justify-evenly gap-1 overflow-x-auto">
        {project && tabButton('flow', 'Flow', Workflow)}
        {project && tabButton('workload', 'Workload', Users)}
        {project && tabButton('progress', 'Progress', TrendingUp)}
        {project && tabButton('trail', 'Trail', Footprints)}
        {project &&
          tabButton(
            'roadmap',
            <>
              Roadmap
              {roadmapPct !== undefined && <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${open && tab === 'roadmap' ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>{roadmapPct}%</span>}
            </>,
            Hammer
          )}
        {project && tabButton('toolbox', 'Toolbox', Wrench)}
        {project && tabButton('preview', 'Preview', Eye)}
        {project && !arrangingDock && !sidePanelOpen && <span style={{ order: dockOrder.pos('review') }} className="mx-1.5 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />}
        {tabButton(
          'review',
          <>
            Review
            {review.cards.length > 0 && (
              <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${open && tab === 'review' ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'}`}>{review.cards.length}</span>
            )}
          </>,
          Inbox
        )}
        {tabButton('lyra', 'LYRA', LyraIcon)}
        {tabButton('activity', 'Activity', Activity, unread)}
        {working > 0 && (
          <button onClick={onOpenWorkers} title={`${working} AI ${working === 1 ? 'job' : 'jobs'} working now: see or stop them`} aria-label={`${working} AI working`} className="flex h-6 min-w-6 shrink-0 items-center justify-center self-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold tabular-nums text-white hover:bg-emerald-600">
            {working}
          </button>
        )}
        {tabButton('terminal', 'Terminal', TerminalSquare)}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2 dark:border-slate-800">
          {arrangingDock && (
            <button onClick={dockOrder.reset} title="Put the tabs back in their usual order" className={`${toolClass} px-2.5 text-sm`}>
              Reset
            </button>
          )}
          <button
            onClick={() => setArrangingDock((v) => !v)}
            aria-pressed={arrangingDock}
            aria-label={arrangingDock ? 'Done customizing' : 'Customize the bottom bar'}
            title={arrangingDock ? 'Done' : 'Customize: move tabs, show or hide them'}
            className={`${toolClass} gap-1.5 px-2.5 text-sm ${arrangingDock ? 'bg-indigo-600 text-white hover:bg-indigo-500 hover:text-white dark:text-white' : ''}`}
          >
            <SlidersHorizontal className="h-4 w-4" /> {arrangingDock ? 'Done' : 'Customize'}
          </button>
          {open && tab === 'flow' && (
            <>
              <button onClick={() => zoomBy(-0.2)} aria-label="Zoom out" title="Zoom out" className={toolClass}>
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
              <button onClick={() => zoomBy(0.2)} aria-label="Zoom in" title="Zoom in" className={toolClass}>
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={() => setZoom('fit')} aria-pressed={zoom === 'fit'} title="Fit the whole graph" className={`${toolClass} gap-1.5 px-2.5 text-sm`}>
                <Scan className="h-4 w-4" /> Fit
              </button>
              <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
            </>
          )}
          {open && tab === 'activity' && entries.length > 0 && (
            <button onClick={() => setEntries([])} title="Clear the log on this screen" className={`${toolClass} gap-1.5 px-2.5 text-sm`}>
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          )}
          {open && tab === 'terminal' && lines.length > 0 && (
            <button onClick={() => setLines([])} title="Clear the terminal" className={`${toolClass} gap-1.5 px-2.5 text-sm`}>
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          )}
          {open && !fullScreen && (
            <button onClick={() => setMaximized(!maximized)} aria-pressed={maximized} aria-label={maximized ? 'Restore panel size' : 'Make panel bigger'} title={maximized ? 'Restore size' : 'Make bigger'} className={toolClass}>
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          {open && (
            <button onClick={() => setFullScreen(!fullScreen)} aria-pressed={fullScreen} aria-label={fullScreen ? 'Leave the large screen' : 'Open on the large screen'} title={fullScreen ? 'Back to the panel (Esc)' : 'Large screen: fill the window'} className={`${toolClass} gap-1.5 px-2.5 text-sm`}>
              {fullScreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />} {fullScreen ? 'Close large screen' : 'Large screen'}
            </button>
          )}
          <button onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'} title={open ? 'Collapse' : 'Expand'} className={toolClass}>
            {open ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && tab === 'review' && (
        <div className="min-h-0 flex-1">
          <ReviewTab {...review} />
        </div>
      )}

      {open && project && PROJECT_TABS.includes(tab) && (
        <div className="min-h-0 flex-1">
          {tab === 'flow' && <FlowTab {...project} zoom={zoom} />}
          {tab === 'workload' && <WorkloadTab {...project} />}
          {tab === 'progress' && <ProgressTab {...project} />}
          {tab === 'roadmap' && (
            <div className="@container h-full overflow-y-auto">
              <Roadmap key={project.project.id} project={project.project} onSave={project.onSaveRoadmap} embedded />
            </div>
          )}
          {tab === 'toolbox' && (
            <div className="h-full overflow-y-auto">
              <Toolbox key={project.project.id} project={project.project} embedded />
            </div>
          )}
          {tab === 'preview' && <PreviewTab key={project.project.id} project={project.project} />}
          {tab === 'trail' && <WorkTrail key={project.project.id} project={project.project} cards={project.cards} agents={project.agents} onOpenCard={project.onOpenCard} />}
        </div>
      )}

      {open && tab === 'lyra' && (
        <div className="min-h-0 flex-1">
          <LyraPanel />
        </div>
      )}

      {open && tab === 'activity' && (
        <div role="tablist" aria-label="Activity views" className="flex shrink-0 gap-1 border-b border-slate-200 px-3 pt-1.5 dark:border-slate-800">
          {([['log', 'Log'], ['usage', 'AI usage'], ['pause', 'Pause AI']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={actSub === id} onClick={() => setActSub(id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs ${actSub === id ? 'border-indigo-500 font-medium text-indigo-600 dark:text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {open && tab === 'activity' && actSub === 'usage' && <div className="flex-1 overflow-y-auto p-3"><UsagePanel /></div>}
      {open && tab === 'activity' && actSub === 'pause' && <div className="flex-1 overflow-y-auto p-3"><div className="max-w-md"><PauseAI /></div></div>}
      {open && tab === 'activity' && actSub === 'log' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
          {entries.length === 0 && <p className="font-sans text-sm text-slate-500">Nothing yet. Card work, plans and chat replies show up here as they happen.</p>}
          {entries.map((e, i) => (
            <React.Fragment key={`${e.id}-${e.at}-${i}`}>
            {i > 0 && e.id >= sessionStart && entries[i - 1].id < sessionStart && (
              <div className="my-1.5 flex items-center gap-2 font-sans text-xs text-slate-400 dark:text-slate-500" role="separator">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                Earlier session
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>
            )}
            <div className="flex gap-3">
              <span className="shrink-0 text-slate-400">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className="min-w-0">
                {e.full ? (
                  <>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-expanded={!!openLines[e.id]}
                      title={openLines[e.id] ? 'Click to show less' : 'Click to show the whole message'}
                      onClick={() => {
                        if (!window.getSelection()?.toString()) setOpenLines((o) => ({ ...o, [e.id]: !o[e.id] }));
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setOpenLines((o) => ({ ...o, [e.id]: !o[e.id] }));
                        }
                      }}
                      className={`cursor-pointer break-words ${KIND_STYLE[e.kind]}`}
                    >
                      {openLines[e.id] ? e.full : `${e.text}…`}
                    </span>
                    {openLines[e.id] && (
                      <button
                        onClick={() => copyLine(e)}
                        title="Copy the whole message"
                        className="ml-2 inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 align-middle font-sans text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-200"
                      >
                        {copiedLine === e.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copiedLine === e.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </>
                ) : (
                  <span className={KIND_STYLE[e.kind]}>{e.text}</span>
                )}
                {e.kind === 'error' && (e.hint || e.retry) && (
                  <span className="mb-1 mt-0.5 block font-sans text-xs text-slate-600 dark:text-slate-300">
                    {e.hint && (
                      <>
                        {e.hint.explain} <span className="font-medium">{e.hint.action}</span>
                      </>
                    )}
                    {e.retry && (
                      <>
                        {' '}
                        <button
                          onClick={() => retry(e)}
                          disabled={!!retried[e.id]}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                        >
                          Retry
                        </button>
                        {retried[e.id] && <span className="ml-2 text-slate-500 dark:text-slate-400">{retried[e.id]}</span>}
                      </>
                    )}
                  </span>
                )}
              </span>
            </div>
            </React.Fragment>
          ))}
          <div ref={activityEnd} />
        </div>
      )}

      {open && tab === 'terminal' && (
        <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed dark:bg-slate-950" onClick={() => inputRef.current?.focus()}>
          {enabled === false ? (
            <div className="font-sans text-sm text-slate-600 dark:text-slate-400">
              <p>The terminal is turned off. It runs real commands on this computer, so you switch it on yourself.</p>
              <button onClick={onOpenPreferences} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                Open Preferences
              </button>
            </div>
          ) : (
            <>
              {lines.map((l) => (
                <div key={l.id} className="mb-1.5">
                  <div className="text-slate-900 dark:text-slate-100">
                    <span className="text-emerald-600 dark:text-emerald-400">{folderName(l.cwd)}</span> <span className="text-slate-400">&gt;</span> {l.command}
                  </div>
                  {l.exitCode === null ? (
                    <div className="text-slate-400">running…</div>
                  ) : (
                    (l.output || l.exitCode !== 0) && (
                      <pre className={`whitespace-pre-wrap break-words ${l.exitCode === 0 ? 'text-slate-700 dark:text-slate-300' : 'text-red-600 dark:text-red-400'}`}>
                        {l.output.replace(/\n+$/, '')}
                        {l.exitCode !== 0 && `${l.output.trim() ? '\n' : ''}(failed, exit code ${l.exitCode})`}
                      </pre>
                    )
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-emerald-600 dark:text-emerald-400" title={cwd}>{folderName(cwd)}</span>
                <span className="text-slate-400">&gt;</span>
                <input
                  ref={inputRef}
                  value={input}
                  disabled={running || enabled === null}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runCommand();
                    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const next = historyAt.current + (e.key === 'ArrowUp' ? 1 : -1);
                      historyAt.current = Math.max(-1, Math.min(history.current.length - 1, next));
                      setInput(historyAt.current < 0 ? '' : history.current[historyAt.current]);
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Terminal command"
                  placeholder={running ? '' : 'Type a command and press Enter'}
                  className="min-w-0 flex-1 bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none dark:text-slate-100"
                />
              </div>
              <div ref={terminalEnd} />
            </>
          )}
        </div>
      )}
    </div>
  );
};
