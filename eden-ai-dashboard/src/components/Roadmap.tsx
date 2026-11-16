// A project's roadmap: long-term goals (Product, Store page, Website…) made of building blocks that go
// planned -> building -> done. This is planning, not AI work: nothing here runs by itself. Progress is worked out
// from the blocks: done counts fully, building counts half.
import React, { useState } from 'react';
import { Plus, X, ChevronDown, Hammer } from 'lucide-react';
import type { BlockState, Project, RoadmapBlock, RoadmapGoal } from '../types/index.ts';

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NEXT: Record<BlockState, BlockState> = { planned: 'building', building: 'done', done: 'planned' };
const STATE_STYLE: Record<BlockState, string> = {
  planned: 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
  building: 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300',
  done: 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-300',
};
const STATE_LABEL: Record<BlockState, string> = { planned: 'Planned', building: 'Building', done: 'Done' };

// 0-100. Done blocks count fully, ones being built count half.
export function progressOf(blocks: RoadmapBlock[]): number {
  if (!blocks.length) return 0;
  const score = blocks.reduce((n, b) => n + (b.state === 'done' ? 1 : b.state === 'building' ? 0.5 : 0), 0);
  return Math.round((score / blocks.length) * 100);
}
export function roadmapProgress(roadmap?: RoadmapGoal[]): { pct: number; done: number; building: number; total: number } | null {
  const blocks = (roadmap || []).flatMap((g) => g.blocks);
  if (!blocks.length) return null;
  return { pct: progressOf(blocks), done: blocks.filter((b) => b.state === 'done').length, building: blocks.filter((b) => b.state === 'building').length, total: blocks.length };
}

// A starting point for taking a product all the way to release.
export function releaseTemplate(): RoadmapGoal[] {
  const goal = (icon: string, title: string, blocks: string[]): RoadmapGoal => ({ id: newId('goal'), icon, title, blocks: blocks.map((t) => ({ id: newId('block'), title: t, state: 'planned' })) });
  return [
    goal('🧱', 'Product', ['Core features', 'Onboarding for new users', 'Stability and error reporting', 'Installer / download', 'Beta testers', 'Version 1.0']),
    goal('🛒', 'Store page', ['Name, logo and tagline', 'Screenshots and trailer', 'Description and feature list', 'Pricing', 'Privacy policy and terms', 'Store page live']),
    goal('📝', 'Devblog', ['Pick where it lives', 'First post: what it is and why', 'Regular posting rhythm', 'Progress posts from the roadmap', 'Community links']),
    goal('🌐', 'Website', ['Domain', 'Landing page', 'Download / buy page', 'Docs and guides', 'Blog on the site']),
    goal('🛟', 'Support', ['Help and FAQ', 'Bug report and feedback form', 'Contact email', 'Release notes', 'Update plan']),
  ];
}

// For a feature or tool inside a bigger product: from idea to shipped.
export function featureTemplate(): RoadmapGoal[] {
  const goal = (icon: string, title: string, blocks: string[]): RoadmapGoal => ({ id: newId('goal'), icon, title, blocks: blocks.map((t) => ({ id: newId('block'), title: t, state: 'planned' })) });
  return [
    goal('💡', 'Design', ['What it is for', 'How it looks and works', 'Edge cases']),
    goal('🔧', 'Build', ['First working version', 'Polish']),
    goal('🧪', 'Test', ['Tried for real', 'Fixes from testing']),
    goal('📖', 'Docs', ['How-to written', 'Handoff notes']),
    goal('🚀', 'Ship', ['Released', 'Feedback collected']),
  ];
}

export function blankTemplate(): RoadmapGoal[] {
  return [{ id: newId('goal'), icon: '🎯', title: 'First goal', blocks: [] }];
}

const Bar: React.FC<{ pct: number; className?: string }> = ({ pct, className = 'h-2' }) => (
  <div className={`${className} w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
  </div>
);

// embedded: shown inside the bottom panel (always open, no frame of its own).
export const Roadmap: React.FC<{ project: Project; onSave: (roadmap: RoadmapGoal[]) => Promise<void>; embedded?: boolean }> = ({ project, onSave, embedded = false }) => {
  const roadmap = project.roadmap || [];
  const [openState, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`eden-roadmap-open-${project.id}`) !== '0';
    } catch {
      return true;
    }
  });
  const open = embedded || openState;
  const [adding, setAdding] = useState<string | null>(null); // goal id getting a new block
  const [blockTitle, setBlockTitle] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [confirmGoal, setConfirmGoal] = useState<string | null>(null);
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(`eden-roadmap-open-${project.id}`, v ? '0' : '1');
      } catch {}
      return !v;
    });
  };
  const change = (fn: (goals: RoadmapGoal[]) => RoadmapGoal[]) => onSave(fn(roadmap.map((g) => ({ ...g, blocks: [...g.blocks] }))));
  const overall = roadmapProgress(roadmap);

  if (!roadmap.length) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <Hammer className="h-4 w-4" /> No roadmap yet: plan the building blocks toward this project's long-term goals. Start from:
        <button onClick={() => onSave(releaseTemplate())} title="Product, Store page, Devblog, Website, Support" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
          🚀 Release
        </button>
        <button onClick={() => onSave(featureTemplate())} title="Design, Build, Test, Docs, Ship" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
          🔧 Feature
        </button>
        <button onClick={() => onSave(blankTemplate())} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
          Blank
        </button>
      </div>
    );
  }

  return (
    <section className={embedded ? "" : "mt-3 rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60"}>
      <button onClick={embedded ? undefined : toggle} aria-expanded={open} disabled={embedded} className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default">
        <Hammer className="h-4 w-4 text-amber-500" />
        <span className="font-semibold text-slate-900 dark:text-white">Under construction</span>
        {overall && (
          <>
            <span className="hidden w-48 sm:block">
              <Bar pct={overall.pct} />
            </span>
            <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
              {overall.pct}% · {overall.done}/{overall.total} done{overall.building ? ` · ${overall.building} building` : ''}
            </span>
          </>
        )}
        {!embedded && <ChevronDown className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />}
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-800">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Click a block to move it along: Planned → Building → Done. These are your building blocks, not AI tasks.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {roadmap.map((g) => {
              const pct = progressOf(g.blocks);
              const done = g.blocks.filter((b) => b.state === 'done').length;
              return (
                <div key={g.id} className="flex flex-col rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-lg" aria-hidden>{g.icon}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">{g.title}</span>
                    <span className="text-xs tabular-nums text-slate-500">{done}/{g.blocks.length}</span>
                    {confirmGoal === g.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <button onClick={() => change((gs) => gs.filter((x) => x.id !== g.id)).then(() => setConfirmGoal(null))} className="rounded bg-red-600 px-1.5 py-0.5 text-white">Remove</button>
                        <button onClick={() => setConfirmGoal(null)} className="px-1 text-slate-500">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmGoal(g.id)} aria-label={`Remove goal ${g.title}`} className="rounded p-0.5 text-slate-300 hover:text-red-500 dark:text-slate-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <Bar pct={pct} className="h-1.5" />
                  </div>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {g.blocks.map((b) => (
                      <li key={b.id} className="group flex items-center gap-2">
                        <button
                          onClick={() => change((gs) => gs.map((x) => (x.id === g.id ? { ...x, blocks: x.blocks.map((y) => (y.id === b.id ? { ...y, state: NEXT[y.state] } : y)) } : x)))}
                          title={`${STATE_LABEL[b.state]}: click for ${STATE_LABEL[NEXT[b.state]]}`}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1 text-left text-sm ${STATE_STYLE[b.state]}`}
                        >
                          <span aria-hidden>{b.state === 'done' ? '✅' : b.state === 'building' ? '🔨' : '⬜'}</span>
                          <span className={`min-w-0 flex-1 truncate ${b.state === 'done' ? 'line-through decoration-emerald-500/50' : ''}`}>{b.title}</span>
                          <span className="sr-only">{STATE_LABEL[b.state]}</span>
                        </button>
                        <button
                          onClick={() => change((gs) => gs.map((x) => (x.id === g.id ? { ...x, blocks: x.blocks.filter((y) => y.id !== b.id) } : x)))}
                          aria-label={`Remove ${b.title}`}
                          className="rounded p-0.5 text-slate-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {adding === g.id ? (
                    <form
                      className="mt-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const t = blockTitle.trim();
                        setBlockTitle('');
                        setAdding(null);
                        if (t) change((gs) => gs.map((x) => (x.id === g.id ? { ...x, blocks: [...x.blocks, { id: newId('block'), title: t, state: 'planned' }] } : x)));
                      }}
                    >
                      <input autoFocus value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} onBlur={() => !blockTitle.trim() && setAdding(null)} placeholder="New building block" className="w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700" />
                    </form>
                  ) : (
                    <button onClick={() => setAdding(g.id)} className="mt-2 flex items-center gap-1 self-start text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                      <Plus className="h-3.5 w-3.5" /> Add a block
                    </button>
                  )}
                </div>
              );
            })}
            <form
              className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700"
              onSubmit={(e) => {
                e.preventDefault();
                const t = newGoal.trim();
                setNewGoal('');
                if (t) change((gs) => [...gs, { id: newId('goal'), title: t, icon: '🎯', blocks: [] }]);
              }}
            >
              <Plus className="h-4 w-4 text-slate-400" />
              <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="Add a goal (e.g. Marketing)" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
