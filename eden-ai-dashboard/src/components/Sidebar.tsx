import React, { useState } from 'react';
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
} from 'lucide-react';
import { UsageBars } from './UsageBars.tsx';
import { PauseAI } from './PauseAI.tsx';
import type { ChatThreads } from '../chatThreads.ts';
import type { NexusRoomsApi } from '../nexusRooms.ts';
import type { ProjectsApi } from '../projectsStore.ts';
import { RoomList } from './NexusRooms.tsx';
import type { Agent, DAGPipeline } from '../types/index.ts';

export type AppTab = 'home' | 'projects' | 'nexus' | 'chat' | 'my-ai' | 'pipelines' | 'files' | 'updates' | 'devices' | 'remote' | 'settings';

// What the sidebar asks a page to open, e.g. "the new-project form" or "this teammate".
export type SidebarRequest =
  | { kind: 'new-project' }
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

type GroupId = 'projects' | 'nexus' | 'chat' | 'team' | 'workflows';
const GROUPS: GroupId[] = ['projects', 'nexus', 'chat', 'team', 'workflows'];
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

  // A plain page link. Collapsed, the sidebar is a strip of icons; each keeps its name as a tooltip.
  const navButton = (id: AppTab, label: string, Icon: React.ElementType, badgeCount = 0) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      aria-label={collapsed ? (badgeCount > 0 ? `${label}, ${badgeCount} waiting for your review` : label) : undefined}
      title={collapsed ? (badgeCount > 0 ? `${label} · ${badgeCount} waiting for your review` : label) : undefined}
      className={`${itemClass(activeTab === id, collapsed)} ${collapsed && badgeCount > 0 ? 'relative' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
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
    collapsedBadgeCount = 0
  ) => {
    if (collapsed) return navButton(tab, label, Icon, collapsedBadgeCount);
    const open = openGroups[g];
    return (
      <div key={g}>
        <div className={itemClass(activeTab === tab) + ' !p-0'}>
          <button onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left">
            <Icon className="h-4 w-4 shrink-0" />
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
              <Plus className="h-3.5 w-3.5" /> {newLabel}
            </button>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">{body}</div>
          </div>
        )}
      </div>
    );
  };

  const runningIn = (projectId: string) => projects.cards.some((c) => c.projectId === projectId && c.runState === 'running');
  const reviewIn = (projectId: string) => projects.cards.filter((c) => c.projectId === projectId && c.column === 'review').length;
  // Every card waiting for your review, across all projects. It drops as cards are approved or sent back.
  const totalReview = projects.cards.filter((c) => c.column === 'review').length;
  const busyAgents = new Set(projects.cards.filter((c) => c.runState === 'running').map((c) => c.assigneeId));

  const displayName = profile.name || 'Account';
  const initial = (profile.name || profile.studio || 'A').trim().charAt(0).toUpperCase();

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onCloseMobile} aria-hidden="true" />}
      <aside
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-xl' : 'hidden'} md:sticky md:top-0 md:z-auto md:flex md:shadow-none h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-150 dark:border-slate-800 dark:bg-slate-900 ${
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
          {navButton('home', 'Dashboard', LayoutDashboard)}

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
            totalReview
          )}

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
            rooms.rooms.some((r) => r.running) ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-label="A discussion is running" /> : undefined
          )}

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
            ))
          )}

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
            })
          )}

          {navButton('files', 'Files', FolderGit2)}
          {navButton('updates', 'Code updates', Wand2)}
          {navButton('devices', 'Devices', Tablet)}
          {navButton('remote', 'Remote', Wifi)}
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
