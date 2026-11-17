import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Wrench, Loader2, CheckCircle2, HelpCircle, RotateCcw, AlertTriangle } from 'lucide-react';

// "Fix all failed": every code update that never got applied, sorted three ways before anything runs:
//   - redone: all of them together, as ONE combined update (each part tried by Claude, then Codex, then Gemini)
//   - already done: the AI found the code already does it, so it is closed
//   - needs your answer: the AI couldn't tell what was meant; answer here and it joins the combined update

interface Group {
  key: string;
  request: string;
  ids: string[];
  attempts: number;
  lastError?: string;
  said?: string;
}
interface Preview {
  retry: Group[];
  already: Group[];
  questions: Group[];
  agents: { id: string; name: string; ok: boolean; why?: string }[];
  chain: string[];
}

const short = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n)}…` : t);

export const FixAllFailed: React.FC<{ codebaseId: string; onClose: () => void; onStarted: (id: string | null, note: string) => void }> = ({ codebaseId, onClose, onStarted }) => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [skip, setSkip] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api<Preview>('GET', `/api/updates/fix-all?codebaseId=${encodeURIComponent(codebaseId)}`)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [codebaseId]);

  const toggle = (key: string) => setSkip((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const answered = preview ? preview.questions.filter((q) => (answers[q.key] || '').trim()).length : 0;
  const redo = preview ? preview.retry.filter((g) => !skip.includes(g.key)).length + answered : 0;

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const d = await api<{ job?: { id: string }; closed: number; unanswered: number; started: number }>('POST', '/api/updates/fix-all', { codebaseId, skip, answers });
      const parts = [];
      if (d.started) parts.push(`${d.started} request${d.started === 1 ? '' : 's'} are being redone as one update`);
      if (d.closed) parts.push(`${d.closed} closed as already done`);
      if (d.unanswered) parts.push(`${d.unanswered} still need${d.unanswered === 1 ? 's' : ''} your answer`);
      onStarted(d.job?.id || null, parts.length ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : 'Nothing to fix.');
    } catch (err: any) {
      setError(err.message);
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-failed-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl dark:bg-slate-900"
      >
        <div className="border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 id="fix-failed-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <Wrench className="h-5 w-5 text-indigo-500" /> Fix all failed updates
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Everything that never got applied is redone together as one update. Each part must pass the checks to stay in, then a second AI reviews the whole thing. Nothing changes in your app until you press Apply.
          </p>
          {preview && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {preview.chain.length ? <>Tried in this order: <b>{preview.chain.join(' → ')}</b>.</> : <span className="text-red-600 dark:text-red-400">No AI is ready to do code updates.</span>}
              {preview.agents.filter((a) => !a.ok).map((a) => ` ${a.name} is skipped: ${a.why}.`)}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          {!preview && !error && (
            <p className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking through the failed updates…
            </p>
          )}
          {preview && !preview.retry.length && !preview.already.length && !preview.questions.length && <p className="text-slate-600 dark:text-slate-300">Nothing has failed. All clear.</p>}

          {preview && preview.retry.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                <RotateCcw className="h-4 w-4 text-indigo-500" /> Redo ({preview.retry.length})
              </h3>
              <ul className="space-y-1.5">
                {preview.retry.map((g) => (
                  <li key={g.key}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <input type="checkbox" checked={!skip.includes(g.key)} onChange={() => toggle(g.key)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                      <span className="min-w-0">
                        <span className="block text-slate-800 dark:text-slate-100">{short(g.request)}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Failed {g.attempts} time{g.attempts === 1 ? '' : 's'}
                          {g.lastError && `: ${short(g.lastError, 120)}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview && preview.questions.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                <HelpCircle className="h-4 w-4 text-amber-500" /> Needs your answer ({preview.questions.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">The AI couldn't tell what these meant. Answer to include them; leave blank to skip for now.</p>
              <ul className="space-y-2">
                {preview.questions.map((g) => (
                  <li key={g.key} className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
                    <span className="block font-medium text-slate-800 dark:text-slate-100">“{short(g.request)}”</span>
                    {g.said && <span className="mt-0.5 block text-xs text-amber-900 dark:text-amber-200">The AI asked: {short(g.said, 300)}</span>}
                    <textarea
                      value={answers[g.key] || ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [g.key]: e.target.value }))}
                      rows={2}
                      aria-label={`Your answer for: ${short(g.request, 60)}`}
                      placeholder="What you meant, e.g. which screen or button"
                      className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm dark:border-amber-800 dark:bg-slate-950"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview && preview.already.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Already done ({preview.already.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">The AI found the code already does these, so they are closed instead of redone.</p>
              <ul className="space-y-1.5">
                {preview.already.map((g) => (
                  <li key={g.key} className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
                    <span className="block text-slate-800 dark:text-slate-100">{short(g.request)}</span>
                    {g.said && <span className="block text-xs text-emerald-900 dark:text-emerald-200">{short(g.said, 220)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
          <button autoFocus onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Not yet
          </button>
          <button
            onClick={start}
            disabled={!preview || starting || (redo === 0 && !preview.already.length) || (redo > 0 && !preview.chain.length)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            {redo ? `Redo ${redo} as one update` : 'Close the ones already done'}
          </button>
        </div>
      </div>
    </div>
  );
};
