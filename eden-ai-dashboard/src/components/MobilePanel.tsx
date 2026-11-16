// Phones don't show the bottom panel, so Review and Activity open here instead, as a full-screen sheet.
// Opened the same way as the panel's tabs (see panel.ts): the Dashboard's "Needs you" card, the top bar, voice.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Inbox, X } from 'lucide-react';
import { OPEN_PANEL_EVENT, isPhoneLayout, type PanelTarget } from '../panel.ts';
import { ReviewTab, type ReviewProps } from './ReviewTab.tsx';

interface Entry {
  id: number;
  at: string;
  kind: 'info' | 'work' | 'done' | 'error';
  text: string;
  hint?: { explain: string; action: string };
}

const KIND: Record<Entry['kind'], string> = {
  info: 'text-slate-500 dark:text-slate-400',
  work: 'text-indigo-600 dark:text-indigo-400',
  done: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
};

const ActivityList: React.FC = () => {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/activity')
        .then((r) => r.json())
        .then((d) => alive && Array.isArray(d.entries) && setEntries(d.entries))
        .catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!entries) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (!entries.length) return <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Nothing has happened since the hub started.</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {[...entries].reverse().map((e) => (
        <li key={e.id} className="px-4 py-2.5 text-sm">
          <span className={KIND[e.kind] || KIND.info}>{e.text}</span>
          {e.hint && <span className="mt-0.5 block text-slate-600 dark:text-slate-400">{e.hint.explain} {e.hint.action}</span>}
          <span className="mt-0.5 block text-xs text-slate-500">{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </li>
      ))}
    </ul>
  );
};

export const MobilePanel: React.FC<{ review: ReviewProps }> = ({ review }) => {
  const [tab, setTab] = useState<'review' | 'activity' | null>(null);

  useEffect(() => {
    const show = (e: Event) => {
      if (!isPhoneLayout()) return; // on bigger screens the bottom panel opens the tab itself
      const want = (e as CustomEvent<PanelTarget>).detail;
      if (want === 'review' || want === 'activity') setTab(want);
    };
    window.addEventListener(OPEN_PANEL_EVENT, show);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, show);
  }, []);
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTab(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  if (!tab) return null;
  const tabClass = (on: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${on ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tab === 'review' ? 'Review' : 'Activity'} className="fixed inset-0 z-[60] flex flex-col bg-white md:hidden dark:bg-slate-900" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
        <button onClick={() => setTab('review')} aria-pressed={tab === 'review'} className={tabClass(tab === 'review')}>
          <Inbox className="h-4 w-4" /> Review
          {review.cards.length > 0 && <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${tab === 'review' ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'}`}>{review.cards.length}</span>}
        </button>
        <button onClick={() => setTab('activity')} aria-pressed={tab === 'activity'} className={tabClass(tab === 'activity')}>
          <Activity className="h-4 w-4" /> Activity
        </button>
        <button onClick={() => setTab(null)} aria-label="Close" className="ml-auto rounded-lg p-2.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'review' ? (
          <ReviewTab
            {...review}
            onOpen={(card) => {
              setTab(null);
              review.onOpen(card);
            }}
          />
        ) : (
          <ActivityList />
        )}
      </div>
    </div>,
    document.body,
  );
};
