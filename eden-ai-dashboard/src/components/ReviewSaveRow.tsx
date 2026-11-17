import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Save } from 'lucide-react';

// One repo from the hub's list of project folders (/api/azi/repos). Every field can be missing if the hub is older.
export interface SaveRepo {
  name?: string;
  state?: string;
  reason?: string;
  hint?: string;
  projectId?: string;
  files?: number;
  fileNames?: string[];
  moreFiles?: number;
}

// "Sidebar.tsx, newproject.ts and 3 more": just the file names, not the folders they sit in.
export const plainFileList = (names: string[] = [], more = 0) => {
  const bare = names.map((n) => String(n).split(/[\\/]/).filter(Boolean).pop() || String(n));
  const rest = more + Math.max(0, bare.length - 4);
  const shown = bare.slice(0, 4);
  if (!shown.length) return '';
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')}${rest ? ', ' : ' and '}${shown[shown.length - 1]}` : shown[0];
  return rest ? `${list} and ${rest} more` : list;
};

// Repeated identical notices become one line with a count ("... ×3").
export const collapseNotices = (texts: string[]) => {
  const counts = new Map<string, number>();
  for (const t of texts) if (t) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].map(([text, count]) => ({ text, count }));
};

// The project folders that are not in step with GitHub. Checks once a minute, and only while the page is showing.
export function useReposToReview() {
  const [repos, setRepos] = useState<SaveRepo[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/azi/repos');
      const d = r.ok ? await r.json() : null;
      if (d && Array.isArray(d.repos)) setRepos(d.repos.filter((x: SaveRepo) => x && x.state === 'changes'));
    } catch {
      /* the hub did not answer: keep what we had */
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    return () => clearInterval(t);
  }, [load]);
  return { repos, reload: load };
}

const small = 'shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

// "Review & save": one row per project with unsaved files. It lists them in plain words; "Save to GitHub" first checks
// the project (nothing is saved yet), then asks you to confirm with a message already filled in, and only then saves and pushes.
// It uses the hub's existing commit-push route, the same as the sidebar's "Save and push".
export const ReviewSaveRow: React.FC<{ repo: SaveRepo; onDone: () => void }> = ({ repo, onDone }) => {
  const name = repo.name || 'This project';
  const count = Math.max(0, Number(repo.files) || 0);
  const [step, setStep] = useState<'idle' | 'checking' | 'confirm' | 'saving'>('idle');
  const [plan, setPlan] = useState<{ names: string[]; more: number; files: number; target: string } | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const id = encodeURIComponent(repo.projectId || '');
  const post = async (body: unknown) => {
    const res = await fetch(`/api/projects/${id}/commit-push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { res, d: await res.json().catch(() => ({})) };
  };

  const check = async () => {
    setStep('checking');
    setResult(null);
    try {
      const { res, d } = await post({ dryRun: true });
      if (res.ok && d.ok) {
        const files = Number(d.files) || count;
        setPlan({ names: Array.isArray(d.fileNames) ? d.fileNames : [], more: Number(d.moreFiles) || 0, files, target: d.remote && d.branch ? `${d.remote}/${d.branch}` : 'GitHub' });
        setNote(`Save ${files} changed ${files === 1 ? 'file' : 'files'} in ${name}`);
        setStep('confirm');
      } else {
        setResult({ ok: false, text: d.message || d.error || 'Could not check this project.' });
        setStep('idle');
      }
    } catch {
      setResult({ ok: false, text: 'The hub did not answer.' });
      setStep('idle');
    }
  };
  const save = async () => {
    setStep('saving');
    try {
      const { res, d } = await post({ message: note });
      const ok = res.ok && d.ok === true;
      setResult({ ok, text: ok ? `Saved and pushed ✓ ${d.message || ''}`.trim() : d.message || d.error || 'Could not save and push.' });
      setPlan(null);
      if (ok) onDone();
    } catch {
      setResult({ ok: false, text: 'The hub did not answer.' });
    }
    setStep('idle');
  };

  const files = plainFileList(plan?.names ?? repo.fileNames, plan?.more ?? repo.moreFiles);
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0"><FileText className="h-4 w-4 text-amber-500" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-900 dark:text-white">
            Review & save: {name}{count > 0 ? ` (${count} ${count === 1 ? 'file' : 'files'} changed)` : ''}
          </span>
          {files && <span className="block break-words text-xs text-slate-500 dark:text-slate-400">{files}</span>}
        </span>
        {step === 'idle' && <button onClick={check} className={small}>Save to GitHub</button>}
        {(step === 'checking' || step === 'saving') && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {step === 'checking' ? 'Checking…' : 'Saving…'}</span>
        )}
      </div>
      {step === 'confirm' && plan && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60">
          <p className="text-xs text-slate-700 dark:text-slate-200">{plan.files} {plan.files === 1 ? 'file' : 'files'} will be saved and sent to {plan.target}. Nothing is sent until you say yes.</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Message for saving ${name}`} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950" />
          <div className="flex gap-2">
            <button type="submit" className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"><Save className="h-3.5 w-3.5" /> Yes, save and push</button>
            <button type="button" onClick={() => { setStep('idle'); setPlan(null); }} className={small}>Not now</button>
          </div>
        </form>
      )}
      {result && <p role="status" className={`mt-1 text-xs ${result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{result.text}</p>}
    </li>
  );
};
