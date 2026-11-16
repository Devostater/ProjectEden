// Every page of the app, in sidebar order, with its icon. Used by the phone's "All pages" menu, the two-pages view
// and anywhere a page is picked from a list. Big tiles that stay readable at every text size.
import React from 'react';
import { LayoutDashboard, KanbanSquare, Network, MessagesSquare, Users, GitBranch, FolderGit2, Wand2, GitFork, Tablet, Wifi, Settings, type LucideIcon } from 'lucide-react';
import type { AppTab } from './components/Sidebar.tsx';

export const PAGES: { id: AppTab; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: KanbanSquare },
  { id: 'nexus', label: 'Nexus', icon: Network },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
  { id: 'my-ai', label: 'Team', icon: Users },
  { id: 'pipelines', label: 'Workflows', icon: GitBranch },
  { id: 'files', label: 'Files', icon: FolderGit2 },
  { id: 'updates', label: 'Code updates', icon: Wand2 },
  { id: 'repos', label: 'GitHub', icon: GitFork },
  { id: 'devices', label: 'Devices', icon: Tablet },
  { id: 'remote', label: 'Remote', icon: Wifi },
  { id: 'settings', label: 'Account', icon: Settings },
];
export const PAGE_IDS = PAGES.map((p) => p.id);
export const pageLabel = (id: AppTab) => PAGES.find((p) => p.id === id)?.label || id;

export const tileClass = (current: boolean) =>
  `flex min-h-16 items-center gap-3 rounded-xl border-2 px-4 py-2 text-left text-base font-semibold ${
    current ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-900 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white'
  }`;

export const PageTiles: React.FC<{ current?: AppTab[]; onPick: (t: AppTab) => void; reviewCount?: number; exclude?: AppTab[] }> = ({ current = [], onPick, reviewCount = 0, exclude = [] }) => (
  <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
    {PAGES.filter((p) => !exclude.includes(p.id)).map(({ id, label, icon: Icon }) => {
      const on = current.includes(id);
      return (
        <button key={id} onClick={() => onPick(id)} aria-current={on ? 'page' : undefined} className={tileClass(on)}>
          <Icon className="h-6 w-6 shrink-0" />
          <span className="min-w-0 break-words leading-tight">{label}</span>
          {id === 'projects' && reviewCount > 0 && <span className="ml-auto min-w-6 rounded-full bg-amber-500 px-1.5 text-center text-sm font-bold text-slate-950">{reviewCount}</span>}
        </button>
      );
    })}
  </div>
);
