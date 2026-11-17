// Phones don't show the bottom panel, so its tabs open here as a full-screen sheet: Review and Activity, and when a
// project exists, its tools (Trail, Roadmap, Toolbox, Preview, Flow, Workload, Progress). Opened the same way as the
// panel's tabs (see panel.ts): the project page's buttons, More, the top bar, voice. Text one step larger (eden-read).
// LYRA and the Terminal stay on bigger screens.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { OPEN_PANEL_EVENT, isPhoneLayout, type PanelTarget, type ProjectPanelTarget } from '../panel.ts';
import { PROJECT_PANELS, GENERAL_PANELS } from '../panelMeta.ts';
import { ReviewTab, type ReviewProps } from './ReviewTab.tsx';
import type { PanelProject } from './BottomPanel.tsx';
import { FlowTab, WorkloadTab, ProgressTab } from './ProjectVisuals.tsx';
import { WorkTrail } from './WorkTrail.tsx';
import { Roadmap } from './Roadmap.tsx';
import { Toolbox } from './Toolbox.tsx';
import { PreviewTab } from './PreviewTab.tsx';

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

type SheetTab = 'review' | 'activity' | ProjectPanelTarget;
const isProjectTab = (t: SheetTab) => PROJECT_PANELS.some((p) => p.id === t);

export const MobilePanel: React.FC<{ review: ReviewProps; project?: PanelProject | null; onGoProjects?: () => void }> = ({ review, project = null, onGoProjects }) => {
  const [tab, setTab] = useState<SheetTab | null>(null);
  const [zoom, setZoom] = useState(1); // Flow graph: starts at 100% (fit would shrink it to unreadable on a phone)
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = (e: Event) => {
      if (!isPhoneLayout()) return; // on bigger screens the bottom panel opens the tab itself
      const want = (e as CustomEvent<PanelTarget | ProjectPanelTarget>).detail;
      if (want === 'lyra' || want === 'terminal') return;
      setTab(want as SheetTab);
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
  // Keep the chosen chip in view when the tab changes.
  useEffect(() => {
    chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);

  if (!tab) return null;
  const projectTab = isProjectTab(tab);
  const chips = projectTab ? PROJECT_PANELS : GENERAL_PANELS;
  const meta = [...PROJECT_PANELS, ...GENERAL_PANELS].find((p) => p.id === tab);
  const openCard = (id: string) => {
    setTab(null);
    project?.onOpenCard(id);
    onGoProjects?.();
  };
  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  let body: React.ReactNode;
  if (tab === 'review')
    body = (
      <ReviewTab
        {...review}
        onOpen={(card) => {
          setTab(null);
          review.onOpen(card);
        }}
        onOpenUpdates={() => {
          setTab(null);
          review.onOpenUpdates?.();
        }}
      />
    );
  else if (tab === 'activity') body = <ActivityList />;
  else if (!project) body = <p className="p-4 text-base text-slate-700 dark:text-slate-200">Create a project first.</p>;
  else {
    const key = project.project.id;
    const visual = { ...project, onOpenCard: openCard };
    body =
      tab === 'flow' ? <FlowTab key={key} {...visual} zoom={zoom} />
      : tab === 'workload' ? <WorkloadTab key={key} {...visual} />
      : tab === 'progress' ? <ProgressTab key={key} {...visual} />
      : tab === 'trail' ? <WorkTrail key={key} project={project.project} cards={project.cards} agents={project.agents} onOpenCard={openCard} />
      : tab === 'roadmap' ? <Roadmap key={key} project={project.project} onSave={project.onSaveRoadmap} embedded />
      : tab === 'toolbox' ? <Toolbox key={key} project={project.project} embedded />
      : <PreviewTab key={key} project={project.project} />;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={meta?.label || 'Panel'}
      className="eden-read fixed inset-0 z-[60] flex flex-col bg-white md:hidden dark:bg-slate-900"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{meta?.label}</h2>
          {projectTab && project && <p className="truncate text-sm text-slate-600 dark:text-slate-300">{project.project.name}</p>}
        </div>
        {tab === 'flow' && (
          <>
            <button onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} aria-label="Zoom out" className={iconBtn}>
              <ZoomOut className="h-5 w-5" />
            </button>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))} aria-label="Zoom in" className={iconBtn}>
              <ZoomIn className="h-5 w-5" />
            </button>
          </>
        )}
        <button onClick={() => setTab(null)} className="flex min-h-12 items-center gap-2 rounded-lg px-3 text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5" /> Close
        </button>
      </div>
      <div ref={chipsRef} className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        {chips.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium ${tab === id ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-100'}`}
          >
            <Icon className="h-5 w-5" /> {label}
            {id === 'review' && review.cards.length > 0 && <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${tab === 'review' ? 'bg-white/25 text-white' : 'bg-amber-500 text-slate-950'}`}>{review.cards.length}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>,
    document.body,
  );
};
