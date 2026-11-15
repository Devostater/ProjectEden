// Review: every card waiting for you, across all projects, with Approve, Send back, Copy and Download right there.
import React, { useState } from 'react';
import { Check, CheckCheck, ExternalLink, ChevronDown, X } from 'lucide-react';
import type { Agent, Card, Project } from '../types/index.ts';
import type { ApproveResult } from '../projectsStore.ts';
import { Formatted } from './ChatView.tsx';
import { ResultActions } from './ResultActions.tsx';
import { SendBackBox } from './SendBackBox.tsx';

export interface ReviewProps {
  cards: Card[]; // cards in Review
  projects: Project[];
  agents: Agent[];
  onApprove: (ids: string[]) => Promise<ApproveResult | undefined>; // approving also saves each result to its Deliverables folder
  onSendBack: (cardId: string, note: string) => Promise<unknown>; // back to the same teammate, with your feedback
  onOpen: (card: Card) => void; // open the card on its board
}

export const ReviewTab: React.FC<ReviewProps> = ({ cards, projects, agents, onApprove, onSendBack, onOpen }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // a card id, or 'all'
  const [confirmAll, setConfirmAll] = useState(false);
  const [outcome, setOutcome] = useState<ApproveResult | null>(null);
  const sorted = [...cards].sort((a, b) => (a.reviewAt || '').localeCompare(b.reviewAt || ''));

  const approve = async (ids: string[], key: string) => {
    setBusy(key);
    setConfirmAll(false);
    const result = await onApprove(ids);
    setBusy(null);
    if (result) setOutcome(result);
  };

  // Tells the owner where the files went, and what was left in Review and why.
  const notice = outcome && (outcome.approved.length > 0 || outcome.skipped.length > 0) && (
    <div role="status" className="relative border-b border-slate-100 bg-emerald-50 px-3 py-2 pr-9 text-xs text-emerald-900 dark:border-slate-800 dark:bg-emerald-950/30 dark:text-emerald-200">
      <button onClick={() => setOutcome(null)} aria-label="Dismiss" className="absolute right-2 top-2 rounded p-0.5 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/40">
        <X className="h-3.5 w-3.5" />
      </button>
      {outcome.approved.length > 0 && <p className="font-medium">Approved {outcome.approved.length === 1 ? '1 item' : `${outcome.approved.length} items`}.</p>}
      {outcome.approved.filter((a) => a.path).map((a) => (
        <p key={a.id} className="break-all">
          Saved “{a.title}” to <span className="font-mono">{a.path}</span>
        </p>
      ))}
      {outcome.approved.some((a) => !a.path) && <p>{outcome.approved.every((a) => !a.path) ? 'There was no written result to save as a file.' : 'Some approved items had no written result, so no file was saved for them.'}</p>}
      {outcome.skipped.map((s) => (
        <p key={s.id} className="text-red-700 dark:text-red-300">
          “{s.title}”: {s.reason}
        </p>
      ))}
    </div>
  );

  if (!sorted.length) {
    return (
      <div className="h-full overflow-y-auto">
        {notice}
        <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Nothing waiting for your review.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {notice}
      {sorted.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
          {confirmAll ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">Approve all {sorted.length} and save their results?</span>
              <button onClick={() => approve(sorted.map((c) => c.id), 'all')} disabled={busy !== null} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                Yes, approve all
              </button>
              <button onClick={() => setConfirmAll(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmAll(true)} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
              <CheckCheck className="h-4 w-4" /> Approve all ({sorted.length})
            </button>
          )}
        </div>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {sorted.map((card) => {
          const project = projects.find((p) => p.id === card.projectId);
          const branch = project?.branches?.find((b) => b.id === card.branchId);
          const who = agents.find((a) => a.id === card.assigneeId);
          const result = [...card.notes].reverse().find((n) => n.kind === 'result');
          const open = expanded === card.id;
          return (
            <li key={card.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <button onClick={() => setExpanded(open ? null : card.id)} aria-expanded={open} className="flex min-w-[12rem] flex-1 items-start gap-2 text-left">
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
                      {result?.web && <span className="rounded-full bg-sky-100 px-1.5 font-medium text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">used the web</span>}
                    </span>
                    {!open && result && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{result.text.replace(/[#*`>-]/g, '').replace(/\s+/g, ' ').slice(0, 160)}</span>}
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <button onClick={() => onOpen(card)} title="Open the card on its board" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </button>
                  <button
                    onClick={() => approve([card.id], card.id)}
                    disabled={busy !== null}
                    title="Approve, and save the result as a file in the project's Deliverables folder"
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> Approve
                  </button>
                </div>
              </div>
              {open && (
                <div className="mt-2 space-y-2 sm:ml-6">
                  {result && <ResultActions title={card.title} text={result.text} meta={[project?.name, who ? `by ${who.name}` : result.author].filter(Boolean).join(' · ')} />}
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                    {result ? <Formatted text={result.text} /> : <p className="text-sm text-slate-500">No written result on this card.</p>}
                  </div>
                  <SendBackBox card={card} assignee={who} onSendBack={onSendBack} onSent={() => setExpanded(null)} compact />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
