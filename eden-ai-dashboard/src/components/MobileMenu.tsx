// Phone: "More" opens this full-screen menu. Text size first (so it can be found without reading small text),
// then every page as a big tile, the panels, a project switcher, and the theme. The old sidebar drawer (chats,
// rooms, teammates, pause) is still one tap away at the bottom.
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Sun, Moon, Menu, Inbox, Activity } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';
import { PageTiles, tileClass } from '../pages.tsx';
import { TextSizePicker } from './TextSizePicker.tsx';
import { openPanel } from '../panel.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  activeTab: AppTab;
  go: (t: AppTab) => void;
  reviewCount: number;
  projects: { id: string; name: string }[];
  activeProjectId: string;
  onPickProject: (id: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  onOpenDrawer: () => void;
  // Extra panels (the project tabs) when a project is open; added in step 6.
  extraPanels?: { id: string; label: string; icon: React.ElementType; open: () => void }[];
}

const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="px-4 pb-2 pt-5 text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{children}</h3>;

export const MobileMenu: React.FC<Props> = ({ open, onClose, activeTab, go, reviewCount, projects, activeProjectId, onPickProject, darkMode, setDarkMode, onOpenDrawer, extraPanels = [] }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All pages"
      className="fixed inset-0 z-[55] flex flex-col overflow-y-auto bg-white md:hidden dark:bg-slate-900"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">All pages</h2>
        <button onClick={onClose} className="flex min-h-12 items-center gap-2 rounded-lg px-3 text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5" /> Close
        </button>
      </div>

      <H3>Text size</H3>
      <div className="px-4">
        <TextSizePicker />
      </div>

      <H3>Pages</H3>
      <div className="px-4">
        <PageTiles current={[activeTab]} reviewCount={reviewCount} onPick={(t) => then(() => go(t))()} />
      </div>

      <H3>Panels</H3>
      <div className="grid gap-2 px-4 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
        <button onClick={then(() => openPanel('review'))} className={tileClass(false)}>
          <Inbox className="h-6 w-6 shrink-0" /> <span className="min-w-0 break-words leading-tight">Review</span>
          {reviewCount > 0 && <span className="ml-auto min-w-6 rounded-full bg-amber-500 px-1.5 text-center text-sm font-bold text-slate-950">{reviewCount}</span>}
        </button>
        <button onClick={then(() => openPanel('activity'))} className={tileClass(false)}>
          <Activity className="h-6 w-6 shrink-0" /> <span className="min-w-0 break-words leading-tight">Activity</span>
        </button>
        {extraPanels.map((p) => (
          <button key={p.id} onClick={then(p.open)} className={tileClass(false)}>
            <p.icon className="h-6 w-6 shrink-0" /> <span className="min-w-0 break-words leading-tight">{p.label}</span>
          </button>
        ))}
      </div>

      {projects.length > 1 && (
        <>
          <H3>Projects</H3>
          <div className="grid gap-2 px-4">
            {projects.map((p) => {
              const on = p.id === activeProjectId;
              return (
                <button
                  key={p.id}
                  onClick={then(() => onPickProject(p.id))}
                  aria-current={on ? 'true' : undefined}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 text-left text-base font-medium ${on ? 'border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white' : 'border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-100'}`}
                >
                  <span className="min-w-0 flex-1 break-words">{p.name}</span>
                  {on && <Check className="h-5 w-5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="grid gap-2 px-4 pb-6 pt-6">
        <button onClick={() => setDarkMode(!darkMode)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-slate-300 px-4 text-base text-slate-800 dark:border-slate-600 dark:text-slate-100">
          {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />} {darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        </button>
        <button onClick={then(onOpenDrawer)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border-2 border-slate-300 px-4 text-left text-base text-slate-800 dark:border-slate-600 dark:text-slate-100">
          <Menu className="h-5 w-5 shrink-0" /> Chats, rooms, teammates, pause AI (full menu)
        </button>
      </div>
    </div>,
    document.body,
  );
};
