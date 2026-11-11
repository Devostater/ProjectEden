import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Activity, TerminalSquare, Trash2, Workflow, Users, TrendingUp } from 'lucide-react';
import type { Agent, Card, Project } from '../types/index.ts';
import { FlowTab, WorkloadTab, ProgressTab } from './ProjectVisuals.tsx';

type PanelTab = 'flow' | 'workload' | 'progress' | 'activity' | 'terminal';
const PROJECT_TABS: PanelTab[] = ['flow', 'workload', 'progress'];
const ALL_TABS: PanelTab[] = [...PROJECT_TABS, 'activity', 'terminal'];

// Set while the Projects page is open: adds the Flow, Workload and Progress tabs for that project.
export interface PanelProject {
  project: Project;
  cards: Card[];
  agents: Agent[];
  onOpenCard: (id: string) => void;
}

interface ActivityEntry {
  id: number;
  at: string;
  kind: 'info' | 'work' | 'done' | 'error';
  text: string;
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

export const BottomPanel: React.FC<{ onOpenPreferences: () => void; project?: PanelProject | null }> = ({ onOpenPreferences, project }) => {
  const [open, setOpen] = useState(() => read(OPEN_KEY, '0') === '1');
  const [savedTab, setTab] = useState<PanelTab>(() => {
    const saved = read(TAB_KEY, 'activity') as PanelTab;
    return ALL_TABS.includes(saved) ? saved : 'activity';
  });
  // Project tabs only exist on the Projects page; elsewhere fall back to Activity.
  const tab: PanelTab = PROJECT_TABS.includes(savedTab) && !project ? 'activity' : savedTab;

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
        // A restarted server counts from 1 again: start over rather than miss its lines.
        if (d.latest < latest.current) {
          latest.current = 0;
          setEntries([]);
          return;
        }
        if (d.entries.length) {
          latest.current = d.latest;
          setEntries((e) => [...e, ...d.entries].slice(-300));
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
  const toggle = () => {
    write(OPEN_KEY, open ? '0' : '1');
    setOpen(!open);
  };

  const tabButton = (id: PanelTab, label: string, Icon: React.ElementType, dot = false) => (
    <button
      key={id}
      onClick={() => pick(id)}
      aria-pressed={open && tab === id}
      className={`relative flex h-full shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm ${
        open && tab === id ? 'border-indigo-500 text-slate-900 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-label="New activity" />}
    </button>
  );

  return (
    <div className="relative z-[5] flex shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ height: open ? height : '2.25rem' }}>
      {open && (
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
      <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-slate-200 pl-1 pr-2 dark:border-slate-800">
        {project && tabButton('flow', 'Flow', Workflow)}
        {project && tabButton('workload', 'Workload', Users)}
        {project && tabButton('progress', 'Progress', TrendingUp)}
        {project && <span className="mx-1 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />}
        {tabButton('activity', 'Activity', Activity, unread)}
        {tabButton('terminal', 'Terminal', TerminalSquare)}
        <div className="ml-auto flex items-center gap-1">
          {open && tab === 'terminal' && lines.length > 0 && (
            <button onClick={() => setLines([])} aria-label="Clear terminal" title="Clear" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button onClick={toggle} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'} title={open ? 'Collapse' : 'Expand'} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && project && PROJECT_TABS.includes(tab) && (
        <div className="min-h-0 flex-1">
          {tab === 'flow' && <FlowTab {...project} />}
          {tab === 'workload' && <WorkloadTab {...project} />}
          {tab === 'progress' && <ProgressTab {...project} />}
        </div>
      )}

      {open && tab === 'activity' && (
        <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
          {entries.length === 0 && <p className="font-sans text-sm text-slate-500">Nothing yet. Card work, plans and chat replies show up here as they happen.</p>}
          {entries.map((e) => (
            <div key={e.id} className="flex gap-3">
              <span className="shrink-0 text-slate-400">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className={KIND_STYLE[e.kind]}>{e.text}</span>
            </div>
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
