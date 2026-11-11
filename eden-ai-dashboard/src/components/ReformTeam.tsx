import React, { useState } from 'react';
import { Shuffle, Loader2, ArrowRight, X } from 'lucide-react';
import { api } from '../api.ts';

interface Change {
  agentId: string;
  name: string;
  role: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  reason: string;
}

// "Reform team": shows which AI each teammate would move to (based on which AIs have room today and the
// free models found), then applies it when you say so. You can untick any change you don't want.
export const ReformTeam: React.FC<{ onApplied: () => void | Promise<void> }> = ({ onApplied }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<{ changes: Change[]; summary: string } | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [note, setNote] = useState('');

  const preview = async () => {
    setOpen(true);
    setLoading(true);
    setNote('');
    setSkip([]);
    try {
      setPlan(await api('GET', '/api/team/reform'));
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      const changes = plan.changes.filter((c) => !skip.includes(c.agentId)).map((c) => ({ agentId: c.agentId, to: c.to }));
      const r = await api<{ changed: number }>('POST', '/api/team/reform', { changes });
      await onApplied();
      setOpen(false);
      setNote(`${r.changed} teammate${r.changed === 1 ? '' : 's'} moved.`);
      setTimeout(() => setNote(''), 5000);
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setApplying(false);
    }
  };

  const chosen = plan ? plan.changes.length - skip.length : 0;
  return (
    <>
      <button onClick={preview} className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" title="Move teammates to the AIs that have room today, including free models">
        <Shuffle className="h-4 w-4" /> Reform team
      </button>
      {note && !open && <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{note}</span>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !applying && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reform-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="reform-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white"><Shuffle className="h-5 w-5 text-indigo-500" /> Reform team</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Moves teammates to the AIs that have room today. Heavy thinking stays on Claude; the rest spread across free models, each with its own limit.</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>

            {loading ? (
              <p className="mt-6 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Checking which AIs have room…</p>
            ) : plan ? (
              <>
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">{plan.summary}</p>
                {!plan.changes.length ? (
                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Everyone is already on a good AI for today. Nothing to change.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {plan.changes.map((c) => {
                      const on = !skip.includes(c.agentId);
                      return (
                        <li key={c.agentId}>
                          <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20' : 'border-slate-200 opacity-60 dark:border-slate-800'}`}>
                            <input type="checkbox" checked={on} onChange={() => setSkip((s) => (on ? [...s, c.agentId] : s.filter((x) => x !== c.agentId)))} className="mt-1 h-4 w-4 accent-indigo-600" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium text-slate-900 dark:text-white">{c.name} <span className="font-normal text-slate-500">· {c.role}</span></span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                                <span className="text-slate-500 line-through decoration-slate-400">{c.fromLabel}</span>
                                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                                <span className="font-medium text-indigo-700 dark:text-indigo-300">{c.toLabel}</span>
                              </span>
                              <span className="block text-xs text-slate-500 dark:text-slate-400">{c.reason}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {note && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{note}</p>}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                  <button onClick={apply} disabled={!chosen || applying} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                    {applying && <Loader2 className="h-4 w-4 animate-spin" />} Move {chosen} teammate{chosen === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            ) : (
              note && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{note}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
