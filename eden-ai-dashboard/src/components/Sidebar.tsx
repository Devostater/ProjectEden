import React, { useCallback, useEffect, useState } from 'react';
import { Arrangeable, useArrangedOrder } from '../arrange.tsx';
import {
  LayoutDashboard,
  KanbanSquare,
  Network,
  MessagesSquare,
  Users,
  GitBranch,
  FolderGit2,
  Hexagon,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Wand2,
  Tablet,
  Wifi,
  RefreshCw,
  Download,
  ArrowUpDown,
  Lock,
  Globe,
} from 'lucide-react';
import { UsageBars } from './UsageBars.tsx';
import { PauseAI } from './PauseAI.tsx';
import type { ChatThreads } from '../chatThreads.ts';
import type { NexusRoomsApi } from '../nexusRooms.ts';
import type { ProjectsApi } from '../projectsStore.ts';
import { RoomList } from './NexusRooms.tsx';
import type { Agent, DAGPipeline } from '../types/index.ts';

export type AppTab = 'home' | 'projects' | 'nexus' | 'chat' | 'my-ai' | 'pipelines' | 'files' | 'updates' | 'repos' | 'devices' | 'remote' | 'settings';

// What the sidebar asks a page to open, e.g. "the new-project form" or "this teammate".
export type SidebarRequest =
  | { kind: 'new-project' }
  | { kind: 'new-azi-project'; name: string }
  | { kind: 'new-teammate' }
  | { kind: 'edit-teammate'; id: string }
  | { kind: 'open-workflow'; id: string };

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  chat: ChatThreads;
  rooms: NexusRoomsApi;
  projects: ProjectsApi;
  pipelines: DAGPipeline[];
  activePipelineId: string;
  agents: Agent[];
  onNewRoom: () => void;
  onRequest: (request: SidebarRequest) => void;
  profile: { name: string; studio: string };
  mobileOpen?: boolean; // phone: the sidebar is a drawer
  onCloseMobile?: () => void;
}

type GroupId = 'projects' | 'nexus' | 'chat' | 'team' | 'workflows' | 'github';
const GROUPS: GroupId[] = ['projects', 'nexus', 'chat', 'team', 'workflows', 'github'];

// The repos in C:\AZI (and GitHub repos not on this PC), refreshed every minute and after a sync.
interface AziRepo {
  name: string;
  folder?: string;
  repo?: string;
  url?: string;
  ahead: number;
  behind: number;
  dirty: number;
  state: 'synced' | 'changes' | 'no-remote' | 'not-on-pc' | 'error';
  detail?: string;
  private?: boolean;
  reason?: string; // why it is not in step with GitHub, e.g. 'uncommitted', 'behind', 'diverged', 'auth', 'forge-main'
  hint?: string; // one plain sentence about it
  projectId?: string; // the Eden project for this repo (needed for "Save to GitHub")
}
// Reasons where saving (commit + push) from here is the right fix. Never for Forge on main, logins, or merges.
const CAN_SAVE = ['uncommitted', 'unpushed'];
// What a sync found wrong with one project; for changed files it also lists the first few file names.
interface Problem {
  reason?: string;
  hint?: string;
  fileNames?: string[];
  moreFiles?: number;
}
const visibilityText = (r: AziRepo) => (r.private === true ? ' (private)' : r.private === false ? ' (public)' : '');
const REPO_DOT: Record<AziRepo['state'], string> = {
  synced: 'bg-emerald-500',
  changes: 'bg-amber-500',
  'no-remote': 'bg-slate-400',
  'not-on-pc': 'bg-sky-400',
  error: 'bg-red-500',
};
const repoTitle = (r: AziRepo) =>
  repoTitleBase(r) + visibilityText(r);
const repoTitleBase = (r: AziRepo) =>
  r.state === 'synced'
    ? `${r.repo}: matches GitHub`
    : r.state === 'changes'
      ? `${r.repo}: ${[r.ahead && `${r.ahead} to push`, r.behind && `${r.behind} to pull`, r.dirty && `${r.dirty} uncommitted`].filter(Boolean).join(', ') || r.detail || 'needs a sync'}`
      : r.state === 'no-remote'
        ? `${r.folder}: not on GitHub yet (Projects → New AZI project → use the existing folder)`
        : r.state === 'not-on-pc'
          ? `${r.repo}: on GitHub only. Click to copy it into C:\\AZI.`
          : r.detail || '';

function useAziRepos() {
  const [repos, setRepos] = useState<AziRepo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [problems, setProblems] = useState<Record<string, Problem>>({}); // from the last "Sync all", by folder name
  const load = useCallback(async (fetchRemote = false) => {
    try {
      const r = await fetch(`/api/azi/repos${fetchRemote ? '?fetch=1' : ''}`);
      if (r.ok) setRepos((await r.json()).repos || []);
    } catch {}
  }, []);
  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 60000);
    return () => clearInterval(t);
  }, [load]);
  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage('Syncing…');
    try {
      const r = await fetch('/api/azi/sync-all', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      const badOnes: (Problem & { name: string })[] = (d.results || []).filter((x: { ok: boolean }) => !x.ok);
      // Keep each project's reason (and changed files) so the list below can say what is wrong with it.
      setProblems(Object.fromEntries(badOnes.map((x) => [x.name, { reason: x.reason, hint: x.hint, fileNames: x.fileNames, moreFiles: x.moreFiles }])));
      setMessage(r.ok ? (badOnes.length ? `Check: ${badOnes.map((x) => x.hint || x.name).join('; ')}` : 'All synced ✓') : d.error || 'Sync failed.');
    } catch {
      setMessage('The hub did not answer.');
    } finally {
      setSyncing(false);
      load(true);
      setTimeout(() => setMessage(''), 8000);
    }
  };
  // "Save to GitHub": the project's existing sync route (commits what changed, then pulls and pushes). Forge on main is refused there.
  const save = async (r: AziRepo) => {
    if (!r.projectId) return;
    setMessage(`Saving ${r.name} to GitHub…`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(r.projectId)}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitMessage: 'Save from Eden' }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setProblems((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== r.name)));
        setMessage(`${r.name}: saved to GitHub ✓`);
      } else {
        setProblems((p) => ({ ...p, [r.name]: { reason: d.reason, hint: d.hint, fileNames: d.fileNames, moreFiles: d.moreFiles } }));
        setMessage(d.hint || d.error || `${r.name}: could not save to GitHub.`);
      }
    } catch {
      setMessage('The hub did not answer.');
    } finally {
      load(true);
      setTimeout(() => setMessage(''), 8000);
    }
  };
  const clone = async (repo: string) => {
    setMessage(`Copying ${repo}…`);
    try {
      const r = await fetch('/api/azi/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo }) });
      const d = await r.json().catch(() => ({}));
      setMessage(r.ok ? `Copied to ${d.folder}` : d.error || 'Copy failed.');
    } catch {
      setMessage('The hub did not answer.');
    } finally {
      load(false);
      setTimeout(() => setMessage(''), 8000);
    }
  };
  // Auto-sync: off / when Eden starts / once a day / both (saved on the hub).
  const [auto, setAuto] = useState<{ mode: string; lastRun?: string; lastResult?: string }>({ mode: 'off' });
  useEffect(() => {
    fetch('/api/azi/autosync')
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => a && setAuto(a))
      .catch(() => {});
  }, [syncing]);
  const setAutoMode = async (mode: string) => {
    try {
      const r = await fetch('/api/azi/autosync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAuto(d);
      else setMessage(d.error || 'Could not change auto-sync.');
    } catch {
      setMessage('The hub did not answer.');
    }
  };
  return { repos, syncing, message, syncAll, clone, save, problems, auto, setAutoMode };
}
// Code updates that are running or waiting in the queue. Stays 0 on a device that isn't allowed to use Code updates.
function useRunningUpdates() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let next = 3000;
      try {
        const res = await fetch('/api/updates');
        const d = await res.json();
        const n = res.ok && Array.isArray(d.jobs) ? d.jobs.filter((j: { status: string }) => ['queued', 'working', 'checking'].includes(j.status)).length : 0;
        if (alive) setCount(n);
        next = n > 0 ? 3000 : 10000;
      } catch {
        next = 10000;
      }
      if (alive) timer = setTimeout(tick, next);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return count;
}
const COLLAPSED_KEY = 'eden_sidebar_collapsed';
const GROUPS_KEY = 'eden_sidebar_groups';

const itemClass = (active: boolean, collapsed = false) =>
  `flex w-full items-center rounded-lg py-2.5 text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${
    active
      ? 'bg-indigo-600 font-medium text-white'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

const subItemClass = (current: boolean) =>
  `group flex items-center rounded-md text-sm ${
    current ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50'
  }`;

function loadOpenGroups(): Record<GroupId, boolean> {
  const all = Object.fromEntries(GROUPS.map((g) => [g, true])) as Record<GroupId, boolean>;
  try {
    return { ...all, ...JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}') };
  } catch {
    return all;
  }
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab: pick,
  chat,
  rooms,
  projects,
  pipelines,
  activePipelineId,
  agents,
  onNewRoom,
  onRequest,
  profile,
  mobileOpen = false,
  onCloseMobile,
}) => {
  // On a phone, choosing anything also closes the drawer.
  const setActiveTab = (t: AppTab) => {
    pick(t);
    onCloseMobile?.();
  };

  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>(loadOpenGroups);
  const saveGroups = (next: Record<GroupId, boolean>) => {
    setOpenGroups(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {}
  };
  const toggleGroup = (g: GroupId) => saveGroups({ ...openGroups, [g]: !openGroups[g] });
  const anyOpen = GROUPS.some((g) => openGroups[g]);
  const setAll = (open: boolean) => saveGroups(Object.fromEntries(GROUPS.map((g) => [g, open])) as Record<GroupId, boolean>);

  const [collapsedSetting, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const collapsed = collapsedSetting && !mobileOpen;
  const toggleCollapsed = () => {
    const next = !collapsedSetting;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {}
  };

  // An icon with the number of things running in that tab on its corner (nothing when none are running).
  const iconWithRunning = (Icon: React.ElementType, running: number) => (
    <span className="relative shrink-0" title={running > 0 ? `${running} running` : undefined}>
      <Icon className="h-4 w-4" />
      {running > 0 && (
        <span
          aria-label={`${running} running`}
          className="absolute -right-2 -top-2 min-w-4 rounded-full bg-emerald-500 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white ring-1 ring-white dark:ring-slate-900"
        >
          {running > 99 ? '99+' : running}
        </span>
      )}
    </span>
  );

  // A plain page link. Collapsed, the sidebar is a strip of icons; each keeps its name as a tooltip.
  const navButton = (id: AppTab, label: string, Icon: React.ElementType, badgeCount = 0, running = 0) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      aria-label={collapsed ? [label, badgeCount > 0 && `${badgeCount} waiting for your review`, running > 0 && `${running} running`].filter(Boolean).join(', ') : undefined}
      title={collapsed ? [label, badgeCount > 0 && `${badgeCount} waiting for your review`, running > 0 && `${running} running`].filter(Boolean).join(' · ') : undefined}
      className={`${itemClass(activeTab === id, collapsed)} ${collapsed && badgeCount > 0 ? 'relative' : ''}`}
    >
      {iconWithRunning(Icon, running)}
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && badgeCount > 0 && (
        <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white">{badgeCount > 99 ? '99+' : badgeCount}</span>
      )}
    </button>
  );

  // A page with a dropdown of its items underneath (projects, rooms, chats, teammates, workflows).
  const group = (
    g: GroupId,
    tab: AppTab,
    label: string,
    Icon: React.ElementType,
    count: number,
    newLabel: string,
    onNew: () => void,
    body: React.ReactNode,
    badge?: React.ReactNode,
    collapsedBadgeCount = 0,
    NewIcon: React.ElementType = Plus,
    running = 0
  ) => {
    if (collapsed) return navButton(tab, label, Icon, collapsedBadgeCount, running);
    const open = openGroups[g];
    return (
      <div key={g}>
        <div className={itemClass(activeTab === tab) + ' !p-0'}>
          <button onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left">
            {iconWithRunning(Icon, running)}
            <span className="truncate">{label}</span>
            {badge}
            {!open && count > 0 && <span className={`ml-auto text-xs tabular-nums ${activeTab === tab ? 'text-white/70' : 'text-slate-400'}`}>{count}</span>}
          </button>
          <button onClick={() => toggleGroup(g)} aria-expanded={open} aria-label={open ? `Hide ${label.toLowerCase()} list` : `Show ${label.toLowerCase()} list`} className="rounded-lg px-3 py-2.5">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        </div>
        {open && (
          <div className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-slate-200 pl-1 dark:border-slate-800">
            <button onClick={onNew} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-indigo-600 hover:bg-slate-100 dark:text-indigo-400 dark:hover:bg-slate-800">
              <NewIcon className="h-3.5 w-3.5" /> {newLabel}
            </button>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">{body}</div>
          </div>
        )}
      </div>
    );
  };

  const azi = useAziRepos();
  const needsSync = azi.repos.filter((r) => r.state === 'changes').length;

  const runningIn = (projectId: string) => projects.cards.some((c) => c.projectId === projectId && c.runState === 'running');
  const reviewIn = (projectId: string) => projects.cards.filter((c) => c.projectId === projectId && c.column === 'review').length;
  // Every card waiting for your review, across all projects. It drops as cards are approved or sent back.
  const totalReview = projects.cards.filter((c) => c.column === 'review').length;
  const busyAgents = new Set(projects.cards.filter((c) => c.runState === 'running').map((c) => c.assigneeId));

  // How many things are running in each tab, shown as a number on the tab's icon.
  const runningCards = projects.cards.filter((c) => c.runState === 'running').length;
  const runningRooms = rooms.rooms.filter((r) => r.running).length;
  const runningWorkflows = pipelines.filter((p) => p.lastStatus === 'running').length;
  const runningUpdates = useRunningUpdates();

  const displayName = profile.name || 'Account';
  const initial = (profile.name || profile.studio || 'A').trim().charAt(0).toUpperCase();

  // Re-arrange the pages in this bar (saved per device). Arrange mode shows Up/Down buttons on each entry.
  const navOrder = useArrangedOrder('eden_sidebar_order', ['home', 'projects', 'nexus', 'chat', 'team', 'workflows', 'files', 'updates', 'github', 'devices', 'remote']);
  const [arranging, setArranging] = useState(false);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onCloseMobile} aria-hidden="true" />}
      <aside
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-xl' : 'hidden'} md:sticky md:top-0 md:z-auto md:flex md:shadow-none h-[100dvh] shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-150 dark:border-slate-800 dark:bg-slate-900 ${
          collapsed && !mobileOpen ? 'w-14' : 'w-64 md:w-56'
        }`}
      >
        <div className={`flex items-center border-b border-slate-200 dark:border-slate-800 ${collapsed ? 'flex-col gap-2 px-2 py-3' : 'gap-1 py-3 pl-4 pr-2'}`}>
          <button onClick={() => setActiveTab('home')} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="Eden AI Hub, go to Dashboard">
            <div className="eden-logo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Hexagon className="h-4 w-4" />
            </div>
            {!collapsed && <span className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">Eden AI Hub</span>}
          </button>
          {!collapsed && (
            <button
              onClick={() => setArranging((v) => !v)}
              aria-pressed={arranging}
              aria-label="Arrange the pages in this bar"
              title="Arrange: move pages up or down"
              className={`rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${arranging ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          )}
          {!collapsed && (
            <button
              onClick={() => setAll(!anyOpen)}
              aria-label={anyOpen ? 'Collapse all lists' : 'Expand all lists'}
              title={anyOpen ? 'Collapse all' : 'Expand all'}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {anyOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto ${collapsed ? 'p-2' : 'p-3'}`}>
          {!collapsed && arranging && (
            <div style={{ order: -1 }} className="mb-1 rounded-lg border-2 border-indigo-400 bg-indigo-50 p-2 text-sm text-slate-800 dark:bg-indigo-950/40 dark:text-slate-100">
              Move pages with the arrows, or drag them. Saved on this device.
              <div className="mt-2 flex gap-2">
                <button onClick={() => setArranging(false)} className="min-h-10 flex-1 rounded-lg bg-indigo-600 px-3 font-semibold text-white hover:bg-indigo-500">Done</button>
                <button onClick={navOrder.reset} className="min-h-10 rounded-lg border-2 border-slate-300 px-3 font-medium dark:border-slate-600">Reset</button>
              </div>
            </div>
          )}
          <Arrangeable id="home" label="Dashboard" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {navButton('home', 'Dashboard', LayoutDashboard)}
          </Arrangeable>

          <Arrangeable id="projects" label="Projects" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'projects',
            'projects',
            'Projects',
            KanbanSquare,
            projects.projects.length,
            'New project',
            () => {
              setActiveTab('projects');
              onRequest({ kind: 'new-project' });
            },
            projects.projects.map((p) => {
              const current = activeTab === 'projects' && p.id === projects.activeId;
              const review = reviewIn(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    projects.setActiveId(p.id);
                    setActiveTab('projects');
                  }}
                  aria-current={current ? 'true' : undefined}
                  title={p.name}
                  className={`${subItemClass(current)} w-full gap-2 px-2 py-1.5 text-left`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${runningIn(p.id) ? 'animate-pulse' : ''}`} style={{ backgroundColor: p.color }} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {review > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold tabular-nums text-white" title={`${review} waiting for your review`}>
                      {review}
                    </span>
                  )}
                </button>
              );
            }),
            totalReview > 0 ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold tabular-nums text-white" title={`${totalReview} waiting for your review`} aria-label={`${totalReview} waiting for your review`}>
                {totalReview > 99 ? '99+' : totalReview}
              </span>
            ) : undefined,
            totalReview,
            Plus,
            runningCards
          )}
          </Arrangeable>

          <Arrangeable id="nexus" label="Nexus" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'nexus',
            'nexus',
            'Nexus',
            Network,
            rooms.rooms.length,
            'New room',
            () => {
              setActiveTab('nexus');
              onNewRoom();
            },
            <RoomList
              compact
              rooms={rooms.rooms}
              activeId={activeTab === 'nexus' ? rooms.activeId : ''}
              agents={agents}
              onOpen={(id) => {
                rooms.setActiveId(id);
                setActiveTab('nexus');
              }}
              onNew={onNewRoom}
              onChanged={rooms.refresh}
            />,
            rooms.rooms.some((r) => r.running) ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-label="A discussion is running" /> : undefined,
            0,
            Plus,
            runningRooms
          )}
          </Arrangeable>

          <Arrangeable id="chat" label="Chat" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'chat',
            'chat',
            'Chat',
            MessagesSquare,
            chat.threads.length,
            'New chat',
            () => {
              chat.newThread();
              setActiveTab('chat');
            },
            chat.threads.map((t) => {
              const current = activeTab === 'chat' && t.id === chat.thread.id;
              return (
                <div key={t.id} className={subItemClass(current)}>
                  <button
                    onClick={() => {
                      chat.setActiveId(t.id);
                      setActiveTab('chat');
                    }}
                    title={t.title}
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                  >
                    {t.title}
                  </button>
                  <button
                    onClick={() => chat.deleteThread(t.id)}
                    aria-label={`Delete chat: ${t.title}`}
                    className="px-1.5 text-slate-400 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
          </Arrangeable>

          <Arrangeable id="team" label="Team" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'team',
            'my-ai',
            'Team',
            Users,
            agents.length,
            'Add teammate',
            () => {
              setActiveTab('my-ai');
              onRequest({ kind: 'new-teammate' });
            },
            agents.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setActiveTab('my-ai');
                  onRequest({ kind: 'edit-teammate', id: a.id });
                }}
                title={`${a.name} · ${a.role}`}
                className={`${subItemClass(false)} w-full gap-2 px-2 py-1 text-left`}
              >
                <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-[8px] font-bold text-white" style={{ backgroundColor: a.color }}>
                  {a.avatar || a.name.slice(0, 2).toUpperCase()}
                  {busyAgents.has(a.id) && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-emerald-500 dark:border-slate-900" aria-label="working" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
              </button>
            )),
            undefined,
            0,
            Plus,
            busyAgents.size
          )}
          </Arrangeable>

          <Arrangeable id="workflows" label="Workflows" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'workflows',
            'pipelines',
            'Workflows',
            GitBranch,
            pipelines.length,
            'Open workflows',
            () => setActiveTab('pipelines'),
            pipelines.map((p) => {
              const current = activeTab === 'pipelines' && p.id === activePipelineId;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setActiveTab('pipelines');
                    onRequest({ kind: 'open-workflow', id: p.id });
                  }}
                  aria-current={current ? 'true' : undefined}
                  title={p.name}
                  className={`${subItemClass(current)} w-full gap-2 px-2 py-1.5 text-left`}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.lastStatus === 'running' && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-400" aria-label="running" />}
                  {p.lastStatus === 'error' && <span className="text-[10px] text-red-500">failed</span>}
                </button>
              );
            }),
            undefined,
            0,
            Plus,
            runningWorkflows
          )}
          </Arrangeable>

          <Arrangeable id="files" label="Files" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {navButton('files', 'Files', FolderGit2)}
          </Arrangeable>
          <Arrangeable id="updates" label="Code updates" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {navButton('updates', 'Code updates', Wand2, 0, runningUpdates)}
          </Arrangeable>
          <Arrangeable id="github" label="GitHub" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {group(
            'github',
            'repos',
            'GitHub',
            GitBranch,
            azi.repos.length,
            azi.syncing ? 'Syncing…' : 'Sync all',
            azi.syncAll,
            <>
              <label
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-500 dark:text-slate-400"
                title={`Pull and push every AZI repo by itself (never commits, never forces).${azi.auto.lastResult ? ` Last: ${azi.auto.lastResult}` : ''}${azi.auto.lastRun ? ` (${new Date(azi.auto.lastRun).toLocaleString()})` : ''}`}
              >
                Auto
                <select
                  value={azi.auto.mode}
                  onChange={(e) => azi.setAutoMode(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-transparent px-1 py-0.5 text-xs dark:border-slate-700"
                >
                  <option value="off">Off</option>
                  <option value="start">When Eden starts</option>
                  <option value="daily">Once a day</option>
                  <option value="both">Start + daily</option>
                </select>
              </label>
              {azi.message && <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">{azi.message}</p>}
              {azi.repos.map((r) => {
                const key = r.folder || r.repo || r.name;
                const label = r.name || r.repo?.split('/')[1] || '?';
                // What is wrong, in plain words: what the last "Sync all" found, else what git shows right now.
                const problem = r.state === 'changes' ? azi.problems[r.name] : undefined;
                const reason = problem?.reason || r.reason;
                const hint = problem?.hint || r.hint;
                const files = reason === 'uncommitted' ? problem?.fileNames || [] : [];
                const more = problem?.moreFiles || 0;
                return (
                  <div key={key}>
                  <button
                    title={repoTitle(r)}
                    onClick={() => {
                      if (r.state === 'not-on-pc' && r.repo) return azi.clone(r.repo);
                      if (r.url) window.open(r.url, '_blank', 'noopener');
                      else setActiveTab('repos');
                    }}
                    className={`${subItemClass(false)} w-full gap-2 px-2 py-1.5 text-left`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${REPO_DOT[r.state]}`} />
                    <span className={`min-w-0 flex-1 truncate ${r.state === 'not-on-pc' ? 'italic' : ''}`}>{label}</span>
                    {r.state === 'changes' && (r.ahead > 0 || r.behind > 0) && (
                      <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                        {r.ahead > 0 && `↑${r.ahead}`}
                        {r.behind > 0 && `↓${r.behind}`}
                      </span>
                    )}
                    {r.private === true && <Lock className="h-3 w-3 shrink-0 text-slate-400" aria-label="private" />}
                    {r.private === false && <Globe className="h-3 w-3 shrink-0 text-slate-400" aria-label="public" />}
                    {r.state === 'not-on-pc' && <Download className="h-3 w-3 shrink-0 text-sky-500" />}
                  </button>
                  {r.state === 'changes' && hint && (
                    <div className="px-2 pb-1.5 pl-6 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                      <p>{hint}</p>
                      {files.length > 0 && (
                        <ul className="mt-0.5 text-slate-600 dark:text-slate-400">
                          {files.map((f) => (
                            <li key={f} className="truncate" title={f}>
                              {f}
                            </li>
                          ))}
                          {more > 0 && <li>and {more} more</li>}
                        </ul>
                      )}
                      {reason && CAN_SAVE.includes(reason) && r.projectId && (
                        <button
                          onClick={() => azi.save(r)}
                          title="Saves your changes and sends them to GitHub"
                          className="mt-1 rounded bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-600"
                        >
                          {files.length > 0 ? 'Save and push these' : 'Save to GitHub'}
                        </button>
                      )}
                    </div>
                  )}
                  </div>
                );
              })}
            </>,
            needsSync > 0 ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold tabular-nums text-white" title={`${needsSync} repo(s) not in sync with GitHub`}>
                {needsSync}
              </span>
            ) : undefined,
            needsSync,
            RefreshCw,
            azi.syncing ? 1 : 0
          )}
          </Arrangeable>
          <Arrangeable id="devices" label="Devices" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {navButton('devices', 'Devices', Tablet)}
          </Arrangeable>
          <Arrangeable id="remote" label="Remote" arr={navOrder} arranging={arranging && !collapsed} className="flex flex-col">
          {navButton('remote', 'Remote', Wifi)}
          </Arrangeable>
        </nav>

        <div className={`border-t border-slate-200 dark:border-slate-800 ${collapsed ? 'p-2' : 'p-3'}`}>
          <PauseAI compact={collapsed} />
          {!collapsed && <UsageBars />}
          <button
            onClick={() => setActiveTab('settings')}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            aria-label={collapsed ? 'Account and settings' : undefined}
            title={collapsed ? 'Account and settings' : undefined}
            className={`${itemClass(activeTab === 'settings', collapsed)} ${collapsed ? '' : 'mt-2 !py-2'}`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                activeTab === 'settings' ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
              }`}
            >
              {initial}
            </span>
            {!collapsed && (
              <span className="min-w-0 text-left">
                <span className="block truncate leading-tight">{displayName}</span>
                <span className={`block truncate text-xs leading-tight ${activeTab === 'settings' ? 'text-white/70' : 'text-slate-400'}`}>{profile.studio || 'Account and settings'}</span>
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
};
