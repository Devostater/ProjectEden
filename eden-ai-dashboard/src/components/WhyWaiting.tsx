// A strip above the board that says, in plain words, why cards aren't moving, with a fix for each.
import React, { useEffect, useState } from 'react';
import { Pause, Gauge, UserX, Hand, Play, Clock } from 'lucide-react';
import type { Card } from '../types/index.ts';

export function usePauseState() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch('/api/ai/pause')
        .then((r) => r.json())
        .then((d) => setPaused(!!d.paused))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  const resume = async () => {
    const d = await fetch('/api/ai/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: false }) }).then((r) => r.json());
    setPaused(!!d.paused);
  };
  return { paused, resume };
}

export const WhyWaiting: React.FC<{
  cards: Card[];
  autoRun: boolean;
  onTurnOnAutoRun: () => void;
  onHandToAI: (ids: string[]) => void;
  onOpenBudgets: () => void;
}> = ({ cards, autoRun, onTurnOnAutoRun, onHandToAI, onOpenBudgets }) => {
  const { paused, resume } = usePauseState();
  const ready = cards.filter((c) => c.column === 'ready');
  const budget = ready.filter((c) => c.runState === 'waiting' && /budget/i.test(c.runMessage || ''));
  const nobody = ready.filter((c) => !c.assigneeId);
  const queued = ready.filter((c) => c.startAfter && Date.parse(c.startAfter) > Date.now());
  const idle = cards.filter((c) => c.column === 'doing' && c.runState !== 'running' && c.assigneeId);

  const rows: { key: string; icon: React.ElementType; tone: string; text: string; action?: { label: string; run: () => void; icon?: React.ElementType } }[] = [];
  if (paused && (ready.length || idle.length)) {
    rows.push({ key: 'paused', icon: Pause, tone: 'amber', text: `The AI is paused, so ${ready.length} card${ready.length === 1 ? '' : 's'} in Ready won't start.`, action: { label: 'Resume AI', run: resume, icon: Play } });
  } else if (!autoRun && ready.length) {
    rows.push({ key: 'autorun', icon: Pause, tone: 'amber', text: `"AI works Ready cards" is off for this project, so ${ready.length} card${ready.length === 1 ? '' : 's'} won't start.`, action: { label: 'Turn it on', run: onTurnOnAutoRun, icon: Play } });
  }
  if (!paused && autoRun && budget.length) {
    rows.push({ key: 'budget', icon: Gauge, tone: 'amber', text: `${budget.length} card${budget.length === 1 ? ' is' : 's are'} waiting because today's AI message budget is used up. They start tomorrow, or when you raise the budget.`, action: { label: 'Change budgets', run: onOpenBudgets } });
  }
  if (queued.length) {
    const next = queued.map((c) => Date.parse(c.startAfter!)).sort((a, b) => a - b)[0];
    rows.push({
      key: 'queued',
      icon: Clock,
      tone: 'slate',
      text: `${queued.length} card${queued.length === 1 ? ' is' : 's are'} queued for later. The next starts ${new Date(next).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`,
    });
  }
  if (nobody.length) {
    rows.push({ key: 'nobody', icon: UserX, tone: 'slate', text: `${nobody.length} card${nobody.length === 1 ? '' : 's'} in Ready ${nobody.length === 1 ? 'has' : 'have'} nobody assigned. Open ${nobody.length === 1 ? 'it' : 'them'} and pick a teammate, or add the workstream's team.` });
  }
  if (idle.length) {
    rows.push({
      key: 'idle',
      icon: Hand,
      tone: 'slate',
      text: `${idle.length} card${idle.length === 1 ? ' is' : 's are'} in "In progress" but nobody is working on ${idle.length === 1 ? 'it' : 'them'}. The AI only picks up cards from Ready.`,
      action: { label: 'Hand to the AI', run: () => onHandToAI(idle.map((c) => c.id)) },
    });
  }
  if (!rows.length) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {rows.map(({ key, icon: Icon, tone, text, action }) => (
        <div
          key={key}
          role="status"
          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm ${
            tone === 'amber'
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100'
              : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{text}</span>
          {action && (
            <button onClick={action.run} className="flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500">
              {action.icon && <action.icon className="h-3.5 w-3.5" />}
              {action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
