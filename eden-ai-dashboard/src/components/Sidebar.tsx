import React, { useState } from 'react';
import { LayoutDashboard, KanbanSquare, Network, MessagesSquare, Users, GitBranch, FolderGit2, Hexagon, ChevronDown, Plus, Trash2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { UsageBars } from './UsageBars.tsx';
import type { ChatThreads } from '../chatThreads.ts';

export type AppTab = 'home' | 'projects' | 'nexus' | 'chat' | 'my-ai' | 'pipelines' | 'files' | 'settings';

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  chat: ChatThreads;
  profile: { name: string; studio: string };
}

const NAV: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: KanbanSquare },
  { id: 'nexus', label: 'Nexus', icon: Network },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
  { id: 'my-ai', label: 'Team', icon: Users },
  { id: 'pipelines', label: 'Workflows', icon: GitBranch },
  { id: 'files', label: 'Files', icon: FolderGit2 },
];

const COLLAPSED_KEY = 'eden_sidebar_collapsed';

const itemClass = (active: boolean, collapsed = false) =>
  `flex w-full items-center rounded-lg py-2.5 text-sm transition-colors ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} ${
    active
      ? 'bg-indigo-600 font-medium text-white'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, chat, profile }) => {
  const [chatsOpen, setChatsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {}
  };

  // Collapsed, the sidebar is a strip of icons; each keeps its name as a tooltip and for screen readers.
  const navButton = ({ id, label, icon: Icon }: (typeof NAV)[number]) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={itemClass(activeTab === id, collapsed)}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  const onChat = activeTab === 'chat';
  const displayName = profile.name || 'Account';
  const initial = (profile.name || profile.studio || 'A').trim().charAt(0).toUpperCase();

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-150 dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      <div className={`flex items-center border-b border-slate-200 dark:border-slate-800 ${collapsed ? 'flex-col gap-2 px-2 py-3' : 'gap-2 py-3 pl-4 pr-2'}`}>
        <button onClick={() => setActiveTab('home')} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="Eden AI Hub, go to Dashboard">
          <div className="eden-logo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Hexagon className="h-4 w-4" />
          </div>
          {!collapsed && <span className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">Eden AI Hub</span>}
        </button>
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
        {navButton(NAV[0])}
        {navButton(NAV[1])}
        {navButton(NAV[2])}

        {collapsed ? (
          navButton(NAV[3])
        ) : (
          <>
            {/* Chat, with its conversations as a dropdown underneath */}
            <div className={itemClass(onChat) + ' !p-0'}>
              <button onClick={() => setActiveTab('chat')} aria-current={onChat ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left">
                <MessagesSquare className="h-4 w-4 shrink-0" />
                <span className="truncate">Chat</span>
              </button>
              <button onClick={() => setChatsOpen(!chatsOpen)} aria-expanded={chatsOpen} aria-label={chatsOpen ? 'Hide chats' : 'Show chats'} className="rounded-lg px-3 py-2.5">
                <ChevronDown className={`h-4 w-4 transition-transform ${chatsOpen ? '' : '-rotate-90'}`} />
              </button>
            </div>

            {chatsOpen && (
              <div className="mb-1 ml-5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">
                <button
                  onClick={() => {
                    chat.newThread();
                    setActiveTab('chat');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-indigo-600 hover:bg-slate-100 dark:text-indigo-400 dark:hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> New chat
                </button>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {chat.threads.map((t) => {
                    const current = onChat && t.id === chat.thread.id;
                    return (
                      <div
                        key={t.id}
                        className={`group flex items-center rounded-md text-sm ${
                          current ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50'
                        }`}
                      >
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
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {NAV.slice(4).map((item) => navButton(item))}
      </nav>

      <div className={`border-t border-slate-200 dark:border-slate-800 ${collapsed ? 'p-2' : 'p-3'}`}>
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
  );
};
