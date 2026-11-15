// Shown on a card in Review: write what should change and send it back. The same teammate gets the card
// again with your note and their earlier result, and the earlier result is marked "Revised".
import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Agent, Card } from '../types/index.ts';

export const SendBackBox: React.FC<{
  card: Card;
  assignee?: Agent;
  onSendBack: (cardId: string, note: string) => Promise<unknown>;
  onSent: () => void;
  compact?: boolean; // in the Review list: fewer rows, no explanation line
}> = ({ card, assignee, onSendBack, onSent, compact }) => {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const who = assignee ? assignee.name.split(' ')[0] : 'the teammate';

  const submit = async () => {
    if (!feedback.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSendBack(card.id, feedback.trim());
      setFeedback('');
      onSent();
    } catch (err: any) {
      setError(err.message || 'Could not send it back.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <label htmlFor={`sb-${card.id}`} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Send back with feedback</label>
      <textarea
        id={`sb-${card.id}`}
        rows={compact ? 2 : 3}
        maxLength={4000}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={`What should ${who} change? They get your note and their earlier result.`}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      />
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {!compact && <p className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">The card goes back to Ready for {who}, and this result is marked Revised.</p>}
        <button
          type="button"
          onClick={submit}
          disabled={!feedback.trim() || busy}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-4 w-4" /> {busy ? 'Sending…' : 'Send back with feedback'}
        </button>
      </div>
    </div>
  );
};
