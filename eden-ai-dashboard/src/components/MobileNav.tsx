// Phone layout: a tab bar along the bottom with the four main pages, and "More", which slides the
// full sidebar in from the left. Shown only on narrow screens; desktop keeps the normal sidebar.
import React from 'react';
import { LayoutDashboard, KanbanSquare, Network, MessagesSquare, Menu } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';

const TABS: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: KanbanSquare },
  { id: 'nexus', label: 'Nexus', icon: Network },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
];

export const MobileNav: React.FC<{ activeTab: AppTab; setActiveTab: (t: AppTab) => void; onMore: () => void; reviewCount?: number }> = ({ activeTab, setActiveTab, onMore, reviewCount = 0 }) => {
  const inMore = !TABS.some((t) => t.id === activeTab);
  const item = (active: boolean) =>
    `flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`;
  return (
    <nav
      aria-label="Main"
      className="relative z-20 flex shrink-0 border-t border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          aria-current={activeTab === id ? 'page' : undefined}
          aria-label={id === 'projects' && reviewCount > 0 ? `${label}, ${reviewCount} waiting for your review` : undefined}
          className={item(activeTab === id)}
        >
          <span className="relative">
            <Icon className="h-5 w-5" />
            {id === 'projects' && reviewCount > 0 && (
              <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white">{reviewCount > 99 ? '99+' : reviewCount}</span>
            )}
          </span>
          {label}
        </button>
      ))}
      <button onClick={onMore} className={item(inMore)} aria-label="More pages and settings">
        <Menu className="h-5 w-5" />
        More
      </button>
    </nav>
  );
};
