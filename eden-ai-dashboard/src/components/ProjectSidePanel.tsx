import React, { useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import type { PanelProject } from './BottomPanel.tsx';
import { FlowTab, WorkloadTab, ProgressTab } from './ProjectVisuals.tsx';
import { Roadmap, roadmapProgress } from './Roadmap.tsx';
import { Toolbox } from './Toolbox.tsx';
import { WorkTrail } from './WorkTrail.tsx';
import { PROJECT_PANELS } from '../panelMeta.ts';

// The Projects page's right-hand panel, shown when only one page is open on a wide screen.
// A health summary on top (like a dashboard's side card), then the project tools as tabs.
type SideTab = 'roadmap' | 'progress' | 'workload' | 'trail' | 'flow' | 'toolbox';
const SIDE_TABS = PROJECT_PANELS.filter((p) => p.id !== 'preview') as { id: SideTab; label: string; icon: React.ElementType }[];
const ORDER: SideTab[] = ['roadmap', 'progress', 'workload', 'trail', 'flow', 'toolbox'];

const read = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
    <span className="h-3 w-0.5 rounded-full bg-indigo-500" /> {children}
  </h3>
);

export const ProjectSidePanel: React.FC<{ project: PanelProject }> = ({ project }) => {
  const [tab, setTabState] = useState<SideTab>(() => (ORDER.includes(read('eden_side_tab', 'roadmap') as SideTab) ? (read('eden_side_tab', 'roadmap') as SideTab) : 'roadmap'));
  const [closed, setClosed] = useState(() => read('eden_side_closed', '') === '1');
  const setTab = (t: SideTab) => { setTabState(t); write('eden_side_tab', t); };
  const toggle = () => { setClosed((c) => { write('eden_side_closed', c ? '' : '1'); return !c; }); };

  if (closed) {
    return (
      <button onClick={toggle} title="Show the project panel" aria-label="Show the project panel" style={{ order: 3 }} className="hidden w-8 shrink-0 items-start justify-center border-l border-slate-200 pt-4 text-slate-500 hover:bg-slate-50 hover:text-slate-800 xl:flex dark:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200">
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  const cards = project.cards.filter((c) => c.projectId === project.project.id);
  const done = cards.filter((c) => c.column === 'done').length;
  const running = cards.filter((c) => c.runState === 'running').length;
  const failed = cards.filter((c) => c.runState === 'failed').length;
  const review = cards.filter((c) => c.column === 'review').length;
  const rm = roadmapProgress(project.project.roadmap);
  const pct = rm ? rm.pct : cards.length ? Math.round((done / cards.length) * 100) : 0;
  const r = 34, circ = 2 * Math.PI * r;

  return (
    <aside aria-label="Project panel" style={{ order: 3 }} className="hidden w-[360px] shrink-0 flex-col gap-3 overflow-hidden border-l border-slate-200 bg-slate-50 p-3 xl:flex dark:border-slate-800 dark:bg-slate-950">
      <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <Label>Project health</Label>
          <button onClick={toggle} title="Hide the project panel" aria-label="Hide the project panel" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0" role="img" aria-label={`${pct}% ${rm ? 'of the roadmap' : 'of cards'} done`}>
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-800" />
            <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-emerald-500" strokeDasharray={`${(pct / 100) * circ} ${circ}`} transform="rotate(-90 40 40)" />
            <text x="40" y="44" textAnchor="middle" className="fill-slate-900 text-[15px] font-bold dark:fill-white">{pct}%</text>
          </svg>
          <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {[['Cards', cards.length], ['Done', done], ['Working', running], ['To review', review], ['Failed', failed], ['Blocks', rm ? `${rm.done}/${rm.total}` : '–']].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className={`font-semibold tabular-nums ${k === 'Failed' && failed ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div role="tablist" aria-label="Project tools" className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-800">
          {ORDER.map((id) => {
            const t = SIDE_TABS.find((x) => x.id === id)!;
            const Icon = t.icon;
            return (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} title={t.label}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${tab === id ? 'bg-indigo-600 font-medium text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {tab === 'roadmap' && <Roadmap key={project.project.id} project={project.project} onSave={project.onSaveRoadmap} embedded />}
          {tab === 'progress' && <ProgressTab {...project} />}
          {tab === 'workload' && <WorkloadTab {...project} />}
          {tab === 'trail' && <WorkTrail key={project.project.id} project={project.project} cards={project.cards} agents={project.agents} onOpenCard={project.onOpenCard} />}
          {tab === 'flow' && <FlowTab {...project} zoom="fit" />}
          {tab === 'toolbox' && <Toolbox key={project.project.id} project={project.project} embedded />}
        </div>
      </section>
    </aside>
  );
};
