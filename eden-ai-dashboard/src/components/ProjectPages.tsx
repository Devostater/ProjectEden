import React from 'react';
import { ui } from '../ui.ts';
import { Play, Pause, Flag, Loader2, Inbox, AlertTriangle, ArrowRight, ChevronUp, ChevronDown } from 'lucide-react';
import type { PanelProject } from './BottomPanel.tsx';
import { FlowTab, ProgressTab, WorkloadTab } from './ProjectVisuals.tsx';
import { Roadmap, roadmapProgress } from './Roadmap.tsx';
import { WorkTrail } from './WorkTrail.tsx';

// Mission: the project at a glance. What it's for, what the AI is doing, what's next, what waits on you,
// and the controls that decide how far the AI may go on its own (Continue/Pause and checkpoints).

export const MissionView: React.FC<PanelProject> = ({ project, cards, onOpenCard, onSaveProject }) => {
  const mine = cards.filter((c) => c.projectId === project.id);
  const now = mine.filter((c) => c.runState === 'running');
  const next = mine.filter((c) => c.column === 'ready' && c.runState !== 'running').sort((a, b) => a.order - b.order).slice(0, 3);
  const review = mine.filter((c) => c.column === 'review');
  const failed = mine.filter((c) => c.runState === 'failed');
  const running = project.autoRun !== false;
  const checkpoints = project.checkpoints !== false;
  const rm = roadmapProgress(project.roadmap);
  const nextBlock = project.roadmap?.flatMap((g) => g.blocks).find((b) => b.state !== 'done');

  const list = (items: typeof mine, empty: string) =>
    items.length ? (
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.id}>
            <button onClick={() => onOpenCard(c.id)} className="w-full truncate rounded px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">{c.title}</button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-2 text-sm text-slate-500 dark:text-slate-400">{empty}</p>
    );

  return (
    <div className="space-y-3">
      <div className={ui.section}>
        <div className={ui.label}><Flag className="h-3.5 w-3.5" /> Mission</div>
        <p className="text-sm text-slate-800 dark:text-slate-100">{project.goal || 'No goal yet. Add one in the project settings so the AI knows what "finished" means.'}</p>
        {rm && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Roadmap {rm.pct}% · {rm.done}/{rm.total} blocks done{nextBlock ? ` · next block: ${nextBlock.title}` : ''}</p>}
      </div>

      <div className={`${ui.section} flex flex-wrap items-center gap-3`}>
        <button
          onClick={() => onSaveProject({ autoRun: !running })}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${running ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
        >
          {running ? <><Pause className="h-4 w-4" /> Pause the AI</> : <><Play className="h-4 w-4" /> Continue</>}
        </button>
        <span className="text-sm text-slate-600 dark:text-slate-300">{running ? 'The AI picks up Ready cards on its own.' : 'Paused: the AI takes no new cards.'}</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200" title="When a roadmap block is marked done, the AI pauses until you press Continue.">
          <input type="checkbox" checked={checkpoints} onChange={(e) => onSaveProject({ checkpoints: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
          Stop at each finished block
        </label>
      </div>

      <div className="grid gap-3 @lg:grid-cols-2">
        <div className={ui.section}>
          <div className={ui.label}><Loader2 className={`h-3.5 w-3.5 ${now.length ? 'animate-spin' : ''}`} /> Working now</div>
          {list(now, 'Nothing running right now.')}
        </div>
        <div className={ui.section}>
          <div className={ui.label}><ArrowRight className="h-3.5 w-3.5" /> Up next</div>
          {list(next, 'No cards in Ready.')}
        </div>
        <div className={ui.section}>
          <div className={ui.label}><Inbox className="h-3.5 w-3.5" /> Waiting on you</div>
          {list(review, 'Nothing to review.')}
        </div>
        <div className={ui.section}>
          <div className={ui.label}><AlertTriangle className="h-3.5 w-3.5" /> Needs a fix</div>
          {list(failed, 'No failed cards.')}
        </div>
      </div>
    </div>
  );
};

// Journey: roadmap, progress, card map and trail in one scroll, so the whole story of the project reads top to bottom.
// Each part has small up/down arrows in its title so you can reorder them; the order is remembered on this computer.
const JOURNEY_ORDER_KEY = 'eden_journey_order';
const JOURNEY_PARTS = ['progress', 'roadmap', 'cardmap', 'trail'] as const;
type JourneyPart = (typeof JOURNEY_PARTS)[number];

const loadJourneyOrder = (): JourneyPart[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(JOURNEY_ORDER_KEY) || '[]');
    if (Array.isArray(saved)) {
      const known = saved.filter((id): id is JourneyPart => JOURNEY_PARTS.includes(id));
      // Keep the saved order, and add any part that is missing at the end.
      return [...new Set([...known, ...JOURNEY_PARTS])];
    }
  } catch {
    /* fall back to the default order */
  }
  return [...JOURNEY_PARTS];
};

export const JourneyView: React.FC<PanelProject> = (p) => {
  const [order, setOrder] = React.useState<JourneyPart[]>(loadJourneyOrder);

  const move = (id: JourneyPart, by: -1 | 1) => {
    setOrder((cur) => {
      const from = cur.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      [next[from], next[to]] = [next[to], next[from]];
      try {
        localStorage.setItem(JOURNEY_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* order just won't be remembered */
      }
      return next;
    });
  };

  const arrow = 'rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';
  const header = (id: JourneyPart, title: string) => {
    const i = order.indexOf(id);
    return (
      <div className={ui.label}>
        <span className="flex-1">{title}</span>
        <button type="button" onClick={() => move(id, -1)} disabled={i <= 0} title="Move this part up" aria-label={`Move ${title} up`} className={arrow}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => move(id, 1)} disabled={i >= order.length - 1} title="Move this part down" aria-label={`Move ${title} down`} className={arrow}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const parts: Record<JourneyPart, React.ReactNode> = {
    progress: (
      <section key="progress">
        {header('progress', 'Progress')}
        <ProgressTab {...p} />
      </section>
    ),
    roadmap: (
      <section key="roadmap" className="@container">
        {header('roadmap', 'Roadmap')}
        <Roadmap key={p.project.id} project={p.project} onSave={p.onSaveRoadmap} embedded />
      </section>
    ),
    cardmap: (
      <section key="cardmap">
        {header('cardmap', 'Card map')}
        <div className="h-[380px] rounded-xl border border-slate-200 dark:border-slate-800"><FlowTab {...p} zoom="fit" /></div>
      </section>
    ),
    trail: (
      <section key="trail">
        {header('trail', 'Trail: latest work')}
        <WorkTrail key={p.project.id} project={p.project} cards={p.cards} agents={p.agents} onOpenCard={p.onOpenCard} />
      </section>
    ),
  };

  return <div className="space-y-5">{order.map((id) => parts[id])}</div>;
};

// Insights under the board: swipe sideways through pages of numbers and charts.
export const BoardInsights: React.FC<PanelProject> = (p) => {
  const pages: [string, React.ReactNode][] = [
    ['Progress', <ProgressTab {...p} />],
    ['Who is working', <WorkloadTab {...p} />],
    ['Latest work', <WorkTrail key={p.project.id} project={p.project} cards={p.cards} agents={p.agents} onOpenCard={p.onOpenCard} />],
  ];
  return (
    <section aria-label="Project insights" className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
      {pages.map(([title, body]) => (
        <div key={title} className="w-[min(36rem,85%)] shrink-0 snap-start rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className={ui.label}>{title}</div>
          <div className="max-h-[22rem] overflow-y-auto">{body}</div>
        </div>
      ))}
    </section>
  );
};
