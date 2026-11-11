import React, { useState } from 'react';
import { ArrowRight, ChevronDown, GitBranch, FileText, GripVertical, Plus, Send } from 'lucide-react';
import type { Agent, Card, DAGPipeline, HostedFile, Project } from '../types/index.ts';
import { UsageBar, useProviderUsage } from './UsageBars.tsx';

interface HomeViewProps {
  agents: Agent[];
  pipelines: DAGPipeline[];
  files: HostedFile[];
  projects: Project[];
  cards: Card[];
  onOpenProject: (id: string) => void;
  ownerName?: string;
  onAsk: (text: string) => void; // open Chat and send this
  onTalkTo: (agent: Agent) => void; // open Chat addressed to this agent
  onOpen: (tab: 'projects' | 'my-ai' | 'pipelines' | 'files' | 'settings') => void;
}

// Starting points for a games and digital products studio. They fill the box so you can edit before sending.
const STARTERS = [
  {
    label: 'Pitch the next game',
    text: '@Scout @Quill @Atlas Pitch our next small game. Scout: what is selling and where the gap is. Quill: core loop and hook. Atlas: go or no-go, and the first 3 steps.',
  },
  {
    label: 'Plan a launch',
    text: '@Nova @Rex @Atlas We are launching a product in 4 weeks. List what must be done in your area before launch day, in order.',
  },
  {
    label: 'Fix weak sales',
    text: '@Scout @Rex @Nova A released product is selling below expectations. Give the most likely cause in your area and the cheapest fix to test first.',
  },
];

type PanelId = 'projects' | 'team' | 'ai' | 'workflows' | 'files';
const DEFAULT_ORDER: PanelId[] = ['projects', 'team', 'ai', 'workflows', 'files'];
const ORDER_KEY = 'eden_dashboard_order';
const COLLAPSED_KEY = 'eden_dashboard_collapsed';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Saved order, tolerant of panels being added or removed in later versions.
function loadOrder(): PanelId[] {
  const saved = load<PanelId[]>(ORDER_KEY, []).filter((id) => DEFAULT_ORDER.includes(id));
  return [...DEFAULT_ORDER.filter((id) => !saved.includes(id)), ...saved];
}

export const HomeView: React.FC<HomeViewProps> = ({ agents, pipelines, files, projects, cards, onOpenProject, ownerName, onAsk, onTalkTo, onOpen }) => {
  const [text, setText] = useState('');
  const [order, setOrder] = useState<PanelId[]>(loadOrder);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => load(COLLAPSED_KEY, {}));
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const usage = useProviderUsage();
  const recentFiles = [...files].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 4);

  const submit = () => {
    if (text.trim()) onAsk(text.trim());
  };

  const toggle = (id: PanelId) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    save(COLLAPSED_KEY, next);
  };

  // Put `id` where `target` currently is.
  const moveTo = (id: PanelId, target: PanelId) => {
    if (id === target) return;
    setOrder((current) => {
      const next = current.filter((p) => p !== id);
      const targetIndex = current.indexOf(target);
      next.splice(targetIndex, 0, id);
      save(ORDER_KEY, next);
      return next;
    });
  };

  // Keyboard alternative to dragging: arrow keys on the grip move the panel.
  const nudge = (id: PanelId, delta: number) => {
    setOrder((current) => {
      const from = current.indexOf(id);
      const to = Math.max(0, Math.min(current.length - 1, from + delta));
      if (from === to) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, id);
      save(ORDER_KEY, next);
      return next;
    });
  };

  const panels: Record<PanelId, { title: string; count?: number; wide?: boolean; action: string; onAction: () => void; body: React.ReactNode }> = {
    projects: {
      title: 'Projects',
      count: projects.length,
      wide: true,
      action: 'Open boards',
      onAction: () => onOpen('projects'),
      body: projects.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {projects.map((p) => {
            const mine = cards.filter((c) => c.projectId === p.id);
            const open = mine.filter((c) => c.column !== 'done').length;
            const review = mine.filter((c) => c.column === 'review').length;
            const done = mine.length - open;
            const busy = mine.filter((c) => c.runState === 'running').map((c) => agents.find((a) => a.id === c.assigneeId)?.name).filter(Boolean);
            return (
              <button
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                className="rounded-lg border border-slate-200 p-3 text-left hover:border-indigo-400 dark:border-slate-800 dark:hover:border-indigo-500"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="truncate font-medium text-slate-900 dark:text-white">{p.name}</span>
                  {p.status !== 'active' && <span className="text-xs text-slate-400">{p.status === 'paused' ? 'Paused' : 'Finished'}</span>}
                </span>
                <span className="mt-1.5 block text-sm text-slate-500">
                  {mine.length ? `${open} open · ${done} done` : 'No cards yet'}
                  {review > 0 && <span className="text-amber-600 dark:text-amber-400"> · {review} to review</span>}
                </span>
                {busy.length > 0 && <span className="mt-1 block truncate text-sm text-indigo-600 dark:text-indigo-400">Working now: {busy.join(', ')}</span>}
                {mine.length > 0 && (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round((done / mine.length) * 100)}%`, backgroundColor: p.color }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <button onClick={() => onOpen('projects')} className="flex items-center gap-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          <Plus className="h-4 w-4" /> Create your first project
        </button>
      ),
    },
    team: {
      title: 'Your team',
      count: agents.length,
      wide: true,
      action: 'Edit team',
      onAction: () => onOpen('my-ai'),
      body: (
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => onTalkTo(a)}
              title={`Talk to ${a.name}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 py-1.5 pl-1.5 pr-3 text-left hover:border-indigo-400 dark:border-slate-800 dark:hover:border-indigo-500"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: a.color }}>
                {a.avatar || a.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-white">{a.name}</span>
                <span className="block text-xs text-slate-500">{a.role.split('(')[0].trim()}</span>
              </span>
            </button>
          ))}
        </div>
      ),
    },
    ai: {
      title: 'Your AI today',
      action: 'Connect',
      onAction: () => onOpen('settings'),
      body: (
        <div className="space-y-4">
          {usage.map((u) => (
            <UsageBar key={u.provider} u={u} />
          ))}
          {!usage.length && <p className="text-sm text-slate-500">Loading…</p>}
        </div>
      ),
    },
    workflows: {
      title: 'Workflows',
      count: pipelines.length,
      action: 'Open',
      onAction: () => onOpen('pipelines'),
      body: pipelines.length ? (
        <ul className="space-y-2">
          {pipelines.slice(0, 4).map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <GitBranch className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No workflows yet.</p>
      ),
    },
    files: {
      title: 'Recent files',
      count: files.length,
      action: 'Open',
      onAction: () => onOpen('files'),
      body: recentFiles.length ? (
        <ul className="space-y-2">
          {recentFiles.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Nothing saved yet. Import a GitHub repository or save a chat answer.</p>
      ),
    },
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      {/* Ask box */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">What are we working on{ownerName ? `, ${ownerName.split(' ')[0]}` : ''}?</h1>
        <div className="mt-4 rounded-xl border border-slate-300 bg-white p-3 focus-within:border-indigo-500 dark:border-slate-700 dark:bg-slate-900">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder="Ask Chief anything, or use @name to bring in someone from your team"
            className="w-full resize-none bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none dark:text-slate-100"
          />
          <div className="flex flex-wrap items-center gap-2">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                onClick={() => setText(s.text)}
                className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-indigo-400"
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="ml-auto flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
        </div>
      </div>

      {/* Panels: collapse with the arrow, drag by the grip to rearrange (or focus the grip and use arrow keys) */}
      <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-4 md:grid-cols-2">
        {order.map((id) => {
          const p = panels[id];
          const isCollapsed = !!collapsed[id];
          return (
            <section
              key={id}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                if (dragging !== id) moveTo(dragging, id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
              }}
              className={`rounded-xl border bg-white p-5 transition-shadow dark:bg-slate-900 ${p.wide ? 'md:col-span-2' : ''} ${
                dragging === id ? 'border-indigo-500 opacity-60 shadow-lg' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className={`flex items-center gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragging(id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      nudge(id, -1);
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      nudge(id, 1);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Move ${p.title}. Drag, or use the arrow keys.`}
                  title="Drag to rearrange"
                  className="-ml-2 cursor-grab rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <button onClick={() => toggle(id)} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  <h2 className="truncate font-semibold text-slate-900 dark:text-white">{p.title}</h2>
                  {p.count !== undefined && <span className="text-sm text-slate-500">{p.count}</span>}
                </button>
                <button onClick={p.onAction} className="flex shrink-0 items-center gap-1 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                  {p.action} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {!isCollapsed && p.body}
            </section>
          );
        })}
      </div>
    </div>
  );
};
