// Phone layout: a tab bar along the bottom with the four main pages, and "More", which opens the full-screen
// "All pages" menu (MobileMenu.tsx). Shown only on narrow screens; desktop keeps the normal sidebar.
// Big icons, bold label and a filled pill mark where you are (not colour alone).
import React from 'react';
import { LayoutDashboard, KanbanSquare, Network, MessagesSquare, Menu } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';

const TABS: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: KanbanSquare },
  { id: 'nexus', label: 'Nexus', icon: Network },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
];

export const MobileNav: React.FC<{ activeTab: AppTab; setActiveTab: (t: AppTab) => void; onMore: () => void; moreOpen?: boolean; reviewCount?: number }> = ({ activeTab, setActiveTab, onMore, moreOpen = false, reviewCount = 0 }) => {
  const inMore = moreOpen || !TABS.some((t) => t.id === activeTab);
  const item = (active: boolean) =>
    `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 leading-tight text-[length:min(0.8125rem,15px)] ${
      active ? 'font-bold text-indigo-700 dark:text-indigo-200' : 'font-medium text-slate-700 dark:text-slate-200'
    }`;
  const pill = (active: boolean) => `relative flex h-8 w-14 items-center justify-center rounded-full ${active ? 'bg-indigo-600 text-white' : ''}`;
  return (
    <nav
      aria-label="Main"
      className="relative z-20 flex min-h-16 shrink-0 border-t border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = !moreOpen && activeTab === id;
        return (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            aria-current={activeTab === id ? 'page' : undefined}
            aria-label={id === 'projects' && reviewCount > 0 ? `${label}, ${reviewCount} waiting for your review` : undefined}
            className={item(active)}
          >
            <span className={pill(active)}>
              <Icon className="h-6 w-6" />
              {id === 'projects' && reviewCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-500 px-1 text-center text-xs font-bold leading-5 tabular-nums text-slate-950">{reviewCount > 99 ? '99+' : reviewCount}</span>
              )}
            </span>
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
      <button onClick={onMore} className={item(inMore)} aria-label="All pages and settings" aria-expanded={moreOpen}>
        <span className={pill(inMore)}>
          <Menu className="h-6 w-6" />
        </span>
        <span className="max-w-full truncate">More</span>
      </button>
    </nav>
  );
};
