import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, GitBranch, FileText, GripVertical, Plus, Send, SlidersHorizontal, Eye, EyeOff } from 'lucide-react';
import type { Agent, Card, DAGPipeline, HostedFile, Project } from '../types/index.ts';
import { newlineOnCtrlEnter } from '../textbox.ts';
import { UsageBar, useProviderUsage, RefreshUsageButton } from './UsageBars.tsx';
import { openPanel } from '../panel.ts';
import { roadmapProgress, progressOf } from './Roadmap.tsx';
import { diagnose, applyFix, canFix, limitStillOn, type FixableJob } from '../updateFixes.ts';
import { useFolded, FoldHeader } from './Foldable.tsx';

// A JSON POST to the hub that throws with the hub's own message when it says no.
const postJson = async (url: string, body?: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `The hub said no (${r.status}).`);
  return d;
};

// An [error] line from the activity log (see activity.ts).
interface HomeError {
  id: number;
  at: string;
  kind: string;
  text: string;
  hint?: { explain: string; action: string };
  retry?: { kind: 'card' | 'update' | 'lyra'; id: string }; // what "Try again" runs
}

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
  onRetryCard: (id: string) => Promise<boolean>; // sends a failed card back to Ready
  onOpen: (tab: 'projects' | 'my-ai' | 'pipelines' | 'files' | 'updates' | 'settings') => void;
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

type PanelId = 'roadmaps' | 'projects' | 'team' | 'lyra' | 'ai' | 'workflows' | 'files';
const DEFAULT_ORDER: PanelId[] = ['roadmaps', 'projects', 'team', 'lyra', 'ai', 'workflows', 'files'];
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

export const HomeView: React.FC<HomeViewProps> = ({ agents, pipelines, files, projects, cards, onOpenProject, ownerName, onAsk, onTalkTo, onOpen, onRetryCard }) => {
  const [text, setText] = useState('');
  const [order, setOrder] = useState<PanelId[]>(loadOrder);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => load(COLLAPSED_KEY, {}));
  const [dragging, setDragging] = useState<PanelId | null>(null);
  // Your dashboard layout (saved on this device): which panels show, how many columns, how tall, and the top cards.
  const [prefs, setPrefsState] = useState(() => load('eden_dashboard_prefs', { hidden: [] as string[], cols: 2, height: 'md', needsYou: true, ask: true }));
  const setPrefs = (patch: Partial<typeof prefs>) => setPrefsState((p) => { const next = { ...p, ...patch }; save('eden_dashboard_prefs', next); return next; });
  const [customizing, setCustomizing] = useState(false);
  const HEIGHTS: Record<string, string> = { sm: 'h-60', md: 'h-80', lg: 'h-[28rem]' };
  const COLS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-2 xl:grid-cols-3' };
  const usage = useProviderUsage();
  // What needs the owner: finished tasks in Review, code updates ready to apply, and errors from the last day.
  const reviewCount = cards.filter((c) => c.column === 'review').length;
  const [readyUpdates, setReadyUpdates] = useState(0);
  const [errors, setErrors] = useState<HomeError[]>([]);
  const [lyra, setLyra] = useState<{ connected: boolean; build?: { name: string } | null; tasks?: { id: string; label: string; status: string; needsOk: boolean; step: string }[] } | null>(null);
  const [lyraEdits, setLyraEdits] = useState(0);
  const [checked, setChecked] = useState(false); // the card waits for the first answer, so it never flashes "All clear"
  useEffect(() => {
    let alive = true;
    // The first look always happens; after that, only while the page is on screen.
    const load = async (first = false) => {
      if (!first && document.visibilityState !== 'visible') return;
      try {
        const d = await fetch('/api/activity').then((r) => r.json());
        if (alive && Array.isArray(d.entries)) setErrors(d.entries.filter((e: HomeError) => e.kind === 'error'));
      } catch {}
      try {
        // Only available on this computer; elsewhere there is simply nothing to show.
        const d = await fetch('/api/updates').then((r) => r.json());
        if (alive) setReadyUpdates(Array.isArray(d.jobs) ? d.jobs.filter((j: { status: string }) => j.status === 'ready').length : 0);
      } catch {}
      try {
        // LYRA (your local AI on this PC): what she's doing and how many of her edits wait for your OK
        const [o, e] = await Promise.all([fetch('/api/lyra/overview').then((r) => r.json()), fetch('/api/lyra/edits').then((r) => r.json())]);
        if (alive) { setLyra(o); setLyraEdits(Array.isArray(e.items) ? e.items.length : 0); }
      } catch {}
      if (alive) setChecked(true);
    };
    load(true);
    const timer = setInterval(() => load(), 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  // "Mark all seen" hides problems up to now (saved on this device); new ones still show.
  const [seenAt, setSeenAt] = useState(() => { try { return Number(localStorage.getItem('eden_errors_seen_at')) || 0; } catch { return 0; } });
  const markSeen = () => { const now = Date.now(); setSeenAt(now); try { localStorage.setItem('eden_errors_seen_at', String(now)); } catch {} };
  const dayAgo = Math.max(Date.now() - 24 * 60 * 60 * 1000, seenAt);
  // "PC busy" and "AI paused" are states with their own banner and button, not problems to list here.
  const recentErrors = errors.filter((e) => new Date(e.at).getTime() >= dayAgo && !/^(PC busy|AI paused)/.test(e.text));
  const allClear = reviewCount === 0 && readyUpdates === 0 && recentErrors.length === 0 && lyraEdits === 0;
  // "Fix all errors": try again what can be tried again, and ask Claude (as one Code update) to fix the rest.
  const [fixing, setFixing] = useState(false);
  const [fixNote, setFixNote] = useState('');
  const [fixedIds, setFixedIds] = useState<number[]>([]);
  const [needsFolded, toggleNeeds] = useFolded('eden_needs_you_folded');
  const toFix = recentErrors.filter((e) => !fixedIds.includes(e.id));
  const fixAll = async () => {
    if (fixing || toFix.length === 0) return;
    setFixing(true);
    setFixNote('');
    let cards = 0, updates = 0, skipped = 0, cleared = 0, chats = 0;
    const seen = new Set<string>();
    const rest: string[] = [];
    let limited = 0;
    const keep = new Set<number>(); // errors not fixed this time: they stay listed so the button can try again
    const refusals: string[] = []; // what the hub said when it refused, shown so you know what to do
    let updates_: { jobs: FixableJob[]; claudeReady: boolean } | null = null; // read once, only if a code update needs fixing
    for (const e of toFix) {
      // Out of AI usage: trying again now only fails again, so these wait for the limit to reset.
      if (limitStillOn(e.text, e.at)) {
        limited++;
        keep.add(e.id);
        continue;
      }
      if (e.retry) {
        const key = e.retry.kind + ':' + e.retry.id;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          if (e.retry.kind === 'card') {
            if (await onRetryCard(e.retry.id)) cards++; else skipped++;
          } else if (e.retry.kind === 'lyra') {
            // A message LYRA didn't answer: send it again. If LYRA still isn't running it stays listed.
            const r = await fetch('/api/lyra/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.retry.id }) });
            if (r.ok) chats++;
            else if (r.status === 404 || r.status === 409) skipped++;
            else {
              const d = await r.json().catch(() => ({}));
              throw new Error(d.error || 'LYRA is not answering. Press Start LYRA first.');
            }
          } else {
            // Code updates get the same easy fix as in Code updates: run again, with Claude, with what failed, or clear a twin.
            if (!updates_) {
              updates_ = await fetch('/api/updates')
                .then((r) => r.json())
                .then((d) => ({ jobs: Array.isArray(d.jobs) ? d.jobs : [], claudeReady: d.claudeReady !== false }))
                .catch(() => ({ jobs: [], claudeReady: false }));
            }
            const { jobs, claudeReady } = updates_!;
            const job = jobs.find((j) => j.id === e.retry!.id);
            const fix = job ? diagnose(job, jobs) : null;
            if (!job || !fix) skipped++; // already tried again or cleared
            else if (fix.action === 'wait') {
              limited++;
              keep.add(e.id);
            } else if (!canFix(job, fix, claudeReady)) {
              keep.add(e.id);
              if (!refusals.includes('Sign in to Claude in Account → Connections first.')) refusals.push('Sign in to Claude in Account → Connections first.');
            } else if (await applyFix(job, fix, postJson)) updates++;
            else cleared++;
          }
        } catch (err: any) {
          keep.add(e.id);
          const msg = String(err?.message || "The hub didn't answer.");
          if (!refusals.includes(msg)) refusals.push(msg);
        }
      } else if (!rest.includes(e.text)) {
        rest.push(e.text);
      }
    }
    let asked = 0;
    if (rest.length > 0) {
      const request = "Fix the causes of these errors from Eden's activity log (last 24 hours). For each one, find why it happens and change the code so it stops. If an error is outside the code (a missing key, the PC was offline), make the message say clearly what the owner should do instead.\n\n" + rest.map((t) => '- ' + t).join('\n');
      try {
        const r = await fetch('/api/updates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: request.slice(0, 4000), codebaseId: 'hub' }) });
        if (r.ok) asked = rest.length;
        else { const d = await r.json().catch(() => ({})); setFixNote(d.error || "Couldn't start the fix. Check the hub is running."); }
      } catch { setFixNote("Couldn't start the fix. Check the hub is running."); }
    }
    const parts: string[] = [];
    if (cards) parts.push(`sent ${cards} ${cards === 1 ? 'task' : 'tasks'} back to the team`);
    if (chats) parts.push(`sent ${chats} ${chats === 1 ? 'message' : 'messages'} to LYRA again`);
    if (updates) parts.push(`started ${updates} code ${updates === 1 ? 'update' : 'updates'} again`);
    if (asked) parts.push(`asked Claude to fix ${asked} ${asked === 1 ? 'problem' : 'problems'} (see Code updates)`);
    if (cleared) parts.push(`cleared ${cleared} ${cleared === 1 ? 'update' : 'updates'} that ${cleared === 1 ? "wasn't" : "weren't"} needed`);
    if (skipped) parts.push(`${skipped} already handled`);
    if (limited) parts.push(`${limited} hit the AI usage limit, so press again after it resets`);
    if (refusals.length) parts.push(`${keep.size - limited} not fixed: ${refusals.join(' ')}`);
    if (parts.length) setFixNote(parts.join(', ').replace(/^./, (c) => c.toUpperCase()).replace(/([^.])$/, '$1.'));
    // Errors that weren't fixed (usage limit, refused) stay listed so the button can try them again.
    setFixedIds((ids) => [...ids, ...toFix.filter((e) => !keep.has(e.id)).map((e) => e.id)]);
    setFixing(false);
  };
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

  // Every project's roadmap side by side, and how far along you are overall (building blocks, not AI tasks).
  const withRoadmap = projects.filter((p) => roadmapProgress(p.roadmap));
  const allBlocks = withRoadmap.flatMap((p) => (p.roadmap || []).flatMap((g) => g.blocks));
  const overallPct = progressOf(allBlocks);
  const panels: Record<PanelId, { title: string; count?: number; action: string; onAction: () => void; body: React.ReactNode }> = {
    roadmaps: {
      title: '🏗️ Under construction',
      count: withRoadmap.length,
      action: 'Open boards',
      onAction: () => onOpen('projects'),
      body: (
        <div className="space-y-3">
          {withRoadmap.length > 0 && (
            <div>
              <div className="flex items-baseline gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium">All projects</span>
                <b className="text-lg tabular-nums text-slate-900 dark:text-white">{overallPct}%</b>
                <span className="text-xs tabular-nums text-slate-500">
                  {allBlocks.filter((b) => b.state === 'done').length}/{allBlocks.length} blocks done · {allBlocks.filter((b) => b.state === 'building').length} building
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${overallPct}%` }} />
              </div>
            </div>
          )}
          {projects.map((p) => {
            const rm = roadmapProgress(p.roadmap);
            return (
              <button key={p.id} onClick={() => onOpenProject(p.id)} className="block w-full rounded-lg border border-slate-200 p-3 text-left hover:border-indigo-400 dark:border-slate-800 dark:hover:border-indigo-500">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">{p.name}</span>
                  {rm ? <b className="tabular-nums text-slate-700 dark:text-slate-200">{rm.pct}%</b> : <span className="text-xs text-indigo-600 dark:text-indigo-400">Plan a roadmap →</span>}
                </span>
                {rm && (
                  <span className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min((p.roadmap || []).length, 5)}, minmax(0, 1fr))` }}>
                    {(p.roadmap || []).map((g) => {
                      const pct = progressOf(g.blocks);
                      return (
                        <span key={g.id} title={`${g.title}: ${pct}% (${g.blocks.filter((b) => b.state === 'done').length}/${g.blocks.length} done)`} className="min-w-0">
                          <span className="flex items-center gap-1 truncate text-xs tabular-nums text-slate-500 dark:text-slate-400">
                            <span aria-hidden>{g.icon}</span> {pct}%<span className="sr-only"> {g.title}</span>
                          </span>
                          <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ),
    },
    projects: {
      title: 'Projects',
      count: projects.length,
      action: 'Open boards',
      onAction: () => onOpen('projects'),
      body: projects.length ? (
        <div className="grid gap-2">
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
                {(() => {
                  // The project's roadmap (building blocks toward its long-term goals), when it has one.
                  const rm = roadmapProgress(p.roadmap);
                  if (!rm) return null;
                  return (
                    <span className="mt-2 block">
                      <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        🏗️ Roadmap <b className="tabular-nums text-slate-700 dark:text-slate-200">{rm.pct}%</b>
                        <span className="tabular-nums">· {rm.done}/{rm.total} blocks done</span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <span className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${rm.pct}%` }} />
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {(p.roadmap || []).map((g) => (
                          <span key={g.id} title={g.title} className="tabular-nums">
                            {g.icon} {progressOf(g.blocks)}%
                          </span>
                        ))}
                      </span>
                    </span>
                  );
                })()}
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
    lyra: {
      title: 'LYRA',
      count: lyra?.connected ? (lyra.tasks || []).filter((t) => t.status === 'running' || t.status === 'queued').length : undefined,
      action: 'Open',
      onAction: () => openPanel('lyra'),
      body: !lyra ? (
        <p className="text-sm text-slate-500">Checking…</p>
      ) : !lyra.connected ? (
        <p className="text-sm text-slate-500">LYRA isn't running. Open the LYRA panel to start her.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-slate-500">
            Your local AI{lyra.build ? ` · build ${lyra.build.name}` : ''}
            {lyraEdits > 0 && <span className="text-amber-600 dark:text-amber-400"> · {lyraEdits} edit{lyraEdits === 1 ? '' : 's'} to approve</span>}
          </p>
          <ul className="space-y-1.5">
            {(lyra.tasks || []).slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="w-4 shrink-0 text-center">{t.needsOk ? '⏸' : t.status === 'running' ? '⚙' : t.status === 'queued' ? '⏳' : t.status === 'done' ? '✓' : '⚠'}</span>
                <span className="truncate">{t.label.replace(/^(🎙|🤖)\s*/, '')}</span>
              </li>
            ))}
            {!(lyra.tasks || []).length && <li className="text-slate-500">No tasks yet. Give her one from the LYRA panel.</li>}
          </ul>
        </div>
      ),
    },
    ai: {
      title: 'Your AI',
      action: 'Connect',
      onAction: () => onOpen('settings'),
      body: (
        <div className="space-y-4">
          <div className="-mt-2 flex justify-end">
            <RefreshUsageButton label />
          </div>
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
    <div className={`mx-auto ${prefs.cols === 3 ? 'max-w-7xl' : 'max-w-4xl'} space-y-6 p-4 sm:p-8`}>
      {/* Needs you: finished tasks to review, code updates to apply, recent errors */}
      {checked && prefs.needsYou && <section aria-label="Needs you" className={`rounded-xl border p-5 ${allClear ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'}`}>
        {allClear ? (
          <p className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> All clear
            <span className="text-sm font-normal text-emerald-700 dark:text-emerald-300">Nothing is waiting for you.</span>
          </p>
        ) : (
          <div className="space-y-3">
            <h2>
              <FoldHeader
                title="Needs you"
                folded={needsFolded}
                onToggle={toggleNeeds}
                foldedHint={[reviewCount && `${reviewCount} to review`, readyUpdates && `${readyUpdates} ${readyUpdates === 1 ? 'update' : 'updates'} ready`, recentErrors.length && `${recentErrors.length} ${recentErrors.length === 1 ? 'problem' : 'problems'}`, lyraEdits && `${lyraEdits} LYRA ${lyraEdits === 1 ? 'edit' : 'edits'}`].filter(Boolean).join(' · ')}
              />
            </h2>
            {!needsFolded && <>
            {reviewCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                <span className="min-w-0 flex-1">
                  <b>{reviewCount}</b> finished {reviewCount === 1 ? 'task is' : 'tasks are'} waiting in Review.
                </span>
                <button onClick={() => openPanel('review')} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">
                  Open Review
                </button>
              </div>
            )}
            {lyraEdits > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                <span className="min-w-0 flex-1">
                  <b>{lyraEdits}</b> LYRA {lyraEdits === 1 ? 'edit is' : 'edits are'} waiting for your ✓.
                </span>
                <button onClick={() => openPanel('lyra')} className="rounded-lg bg-fuchsia-600 px-3 py-1.5 font-medium text-white hover:bg-fuchsia-500">
                  Open LYRA
                </button>
              </div>
            )}
            {readyUpdates > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                <span className="min-w-0 flex-1">
                  <b>{readyUpdates}</b> code {readyUpdates === 1 ? 'update is' : 'updates are'} ready to apply.
                </span>
                <button onClick={() => onOpen('updates')} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">
                  Open Code updates
                </button>
              </div>
            )}
            {recentErrors.length > 0 && (
              <div className="text-sm text-slate-800 dark:text-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1">
                    <b>{recentErrors.length}</b> {recentErrors.length === 1 ? 'problem' : 'problems'} in the last 24 hours:
                  </p>
                  <button onClick={markSeen} title="Hide these (they stay in Activity). New problems still show here." className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                    Mark all seen
                  </button>
                  <button
                    onClick={fixAll}
                    disabled={fixing || toFix.length === 0}
                    title="Tries again every task and code update that failed, and asks Claude to fix the rest as one Code update"
                    className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {fixing ? 'Fixing…' : toFix.length === 0 ? 'Fix started' : 'Fix all errors'}
                  </button>
                </div>
                {fixNote && <p role="status" className="mt-1 text-slate-700 dark:text-slate-300">{fixNote}</p>}
                <ul className="mt-1 space-y-1">
                  {recentErrors.slice(-3).reverse().map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-red-700 dark:text-red-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        {e.text}
                        {e.hint && <span className="block text-slate-600 dark:text-slate-400">{e.hint.explain} {e.hint.action}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {recentErrors.length > 3 && (
                  <button onClick={() => openPanel('activity')} className="mt-1 text-slate-600 underline dark:text-slate-300">
                    …and {recentErrors.length - 3} more. Open Activity
                  </button>
                )}
              </div>
            )}
            </>}
          </div>
        )}
      </section>}

      {/* Ask box */}
      {prefs.ask && <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">What are we working on{ownerName ? `, ${ownerName.split(' ')[0]}` : ''}?</h1>
        <div className="mt-4 rounded-xl border border-slate-300 bg-white p-3 focus-within:border-indigo-500 dark:border-slate-700 dark:bg-slate-900">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (newlineOnCtrlEnter(e, setText)) return;
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
      </div>}

      {/* Panels: collapse with the arrow, drag by the grip to rearrange (or focus the grip and use arrow keys) */}
      <div className="flex justify-end">
        <button onClick={() => setCustomizing((v) => !v)} aria-expanded={customizing} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${customizing ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
          <SlidersHorizontal className="h-4 w-4" /> {customizing ? 'Done' : 'Customize'}
        </button>
      </div>
      {customizing && (
        <section aria-label="Customize the dashboard" className="space-y-4 rounded-xl border border-indigo-300 bg-white p-4 text-sm dark:border-indigo-700 dark:bg-slate-900">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Show</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {([['needsYou', 'Needs you'], ['ask', 'Ask box']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setPrefs({ [k]: !prefs[k] } as any)} aria-pressed={prefs[k]} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${prefs[k] ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300' : 'border-slate-300 text-slate-400 dark:border-slate-700'}`}>
                  {prefs[k] ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {label}
                </button>
              ))}
              {order.map((id) => {
                const on = !prefs.hidden.includes(id);
                return (
                  <button key={id} onClick={() => setPrefs({ hidden: on ? [...prefs.hidden, id] : prefs.hidden.filter((x) => x !== id) })} aria-pressed={on} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${on ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300' : 'border-slate-300 text-slate-400 dark:border-slate-700'}`}>
                    {on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {panels[id].title}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Columns</h3>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3].map((n) => <button key={n} onClick={() => setPrefs({ cols: n })} aria-pressed={prefs.cols === n} className={`h-9 w-9 rounded-lg border-2 font-semibold ${prefs.cols === n ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700'}`}>{n}</button>)}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Panel height</h3>
              <div className="mt-2 flex gap-1">
                {([['sm', 'Short'], ['md', 'Medium'], ['lg', 'Tall']] as const).map(([k, label]) => <button key={k} onClick={() => setPrefs({ height: k })} aria-pressed={prefs.height === k} className={`rounded-lg border-2 px-3 py-1.5 ${prefs.height === k ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700'}`}>{label}</button>)}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Drag a panel by its grip to move it. Saved on this device.</p>
        </section>
      )}
      <div className={`grid grid-cols-1 items-start gap-4 ${COLS[prefs.cols] || COLS[2]}`}>
        {order.filter((id) => !prefs.hidden.includes(id)).map((id) => {
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
              className={`flex flex-col rounded-xl border bg-white p-5 transition-shadow dark:bg-slate-900 ${isCollapsed ? '' : HEIGHTS[prefs.height] || 'h-80'} ${
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
              {!isCollapsed && <div className="min-h-0 flex-1 overflow-y-auto">{p.body}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
};
