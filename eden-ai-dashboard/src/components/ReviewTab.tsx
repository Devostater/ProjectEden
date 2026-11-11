// Review: every card waiting for you, across all projects, with Approve right there.
import React, { useState } from 'react';
import { Check, ExternalLink, ChevronDown } from 'lucide-react';
import type { Agent, Card, Project } from '../types/index.ts';
import { Formatted } from './ChatView.tsx';

export interface ReviewProps {
  cards: Card[]; // cards in Review
  projects: Project[];
  agents: Agent[];
  onApprove: (id: string) => Promise<unknown>;
  onOpen: (card: Card) => void; // open the card on its board (to send it back with a note)
}

export const ReviewTab: React.FC<ReviewProps> = ({ cards, projects, agents, onApprove, onOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...cards].sort((a, b) => (a.reviewAt || '').localeCompare(b.reviewAt || ''));

  if (!sorted.length) return <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Nothing waiting for your review.</p>;

  return (
    <ul className="h-full divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
      {sorted.map((card) => {
        const project = projects.find((p) => p.id === card.projectId);
        const branch = project?.branches?.find((b) => b.id === card.branchId);
        const who = agents.find((a) => a.id === card.assigneeId);
        const result = [...card.notes].reverse().find((n) => n.kind === 'result');
        const open = expanded === card.id;
        return (
          <li key={card.id} className="px-3 py-2.5">
            <div className="flex items-start gap-3">
              <button onClick={() => setExpanded(open ? null : card.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{card.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                    {project && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                        {project.name}
                        {branch && (project.branches || []).length > 1 ? ` · ${branch.name}` : ''}
                      </span>
                    )}
                    {who && <span>by {who.name}</span>}
                  </span>
                  {!open && result && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{result.text.replace(/[#*`>-]/g, '').replace(/\s+/g, ' ').slice(0, 160)}</span>}
                </span>
              </button>
              <button onClick={() => onOpen(card)} title="Open the card, to read it all or send it back with a note" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </button>
              <button
                onClick={async () => {
                  setBusy(card.id);
                  await onApprove(card.id);
                  setBusy(null);
                }}
                disabled={busy === card.id}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Approve
              </button>
            </div>
            {open && (
              <div className="ml-6 mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {result ? <Formatted text={result.text} /> : <p className="text-sm text-slate-500">No written result on this card.</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
