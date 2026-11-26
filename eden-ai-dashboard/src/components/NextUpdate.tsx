import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { DEFAULT_PROOF_MINUTES, notSignedIn, type CodeAI, type CodebaseSettings as Settings } from '../../codebaseSettings';
import type { PackageState } from '../../proof';
import { useFolded, FoldHeader } from './Foldable.tsx';
import { ui } from '../ui.ts';
import { Wand2, Loader2, ChevronDown, ListPlus, Lightbulb, RefreshCw, X, Pencil, AlertTriangle } from 'lucide-react';

// The "Update" card: everything for asking for the next change lives here, in small pieces.
// Each piece below does one job, so a later patch only has to touch the piece it is about:
//   CodebasePicker  – which codebase to change (and adding a new one)
//   CodebaseSettings – what the hub remembers about that codebase: which AI changes its code, and whether it is an Unreal project
//   RequestBox      – the box where you describe the change
//   UnsavedWarning  – the note when many files aren't saved to GitHub yet
//   StartRow        – "Next idea", "Run on this PC" and the Make this change button
//   SuggestedIdeas  – ideas the AI suggests for this codebase
//   NextUpdate      – puts the pieces together in one card

export interface CodebaseInfo {
  runners?: string[];
  id: string;
  name: string;
  dir: string;
  check: 'tsc' | 'node';
  restartHint: string;
  ok: boolean;
  unreal?: boolean;
  ai?: CodeAI;
  proof?: string;
  proofMinutes?: number;
  packageFiles?: string;
  packageFrom?: string;
  package?: PackageState;
  uncommitted?: number; // files changed here that are not saved to GitHub yet
}

const post = (url: string, body?: unknown) => api('POST', url, body ?? {});

// Piece: choose which codebase the change is for, or add another one.
export const CodebasePicker: React.FC<{
  codebases: CodebaseInfo[];
  target: string;
  onPick: (id: string) => void;
  canAdd: boolean;
  onAdded: (id: string) => Promise<void> | void;
  onError: (message: string) => void;
}> = ({ codebases, target, onPick, canAdd, onAdded, onError }) => {
  const [minimized, toggleMin] = useFolded('eden_update_picker_minimized');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDir, setNewDir] = useState('');

  const add = async () => {
    onError('');
    try {
      const d = await post('/api/codebases', { name: newName, dir: newDir });
      setAdding(false);
      setNewName('');
      setNewDir('');
      await onAdded(d.id);
    } catch (err: any) {
      onError(err.message);
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={toggleMin} aria-expanded={!minimized} title={minimized ? 'Show all codebases' : 'Minimize to just the chosen codebase'} className="flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${minimized ? '-rotate-90' : ''}`} />
          Change:
          <span className="sr-only">{minimized ? '(minimized, press to show all codebases)' : '(press to minimize)'}</span>
        </button>
        {minimized && (
          <span className="rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
            {codebases.find((c) => c.id === target)?.name ?? 'Pick a codebase'}
          </span>
        )}
        {!minimized && codebases.filter((c) => c.ok).map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            aria-pressed={target === c.id}
            title={c.dir}
            className={`rounded-lg border px-3 py-1.5 text-sm ${target === c.id ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-300 text-slate-600 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300'}`}
          >
            {c.name}
          </button>
        ))}
        {!minimized && canAdd && <button onClick={() => setAdding(!adding)} className="text-sm text-slate-500 hover:underline">+ Add a codebase</button>}
      </div>
      {adding && !minimized && (
        <div className="mb-3 flex flex-wrap gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. Project Nova" className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="Folder, e.g. C:\Users\you\Documents\GITHUB\Project-Nova" className="min-w-[16rem] flex-[2] rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
          <button onClick={add} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            Add
          </button>
          <p className="w-full text-xs text-slate-500">The folder must be inside a git repository, so every change can be reviewed and undone.</p>
        </div>
      )}
    </>
  );
};

export function PackageWarning({ codebase, applied }: { codebase?: CodebaseInfo; applied?: boolean }) {
  const info = codebase?.package;
  if (info?.state === 'older') return <p className={ui.empty}>The package <span className="break-all">{info.file?.replaceAll('/', '\\')}</span> is older than the source: <span className="break-all">{info.newer}</span> changed after it was made. Build it again before you upload it.</p>;
  if (info?.state === 'missing' && !applied) return <p className={ui.empty}>No package file matches <span className="break-all">{codebase?.packageFiles}</span> yet.</p>;
  return null;
}

type SettingsInput = Omit<Settings, 'proofMinutes'> & { proofMinutes?: number | '' };

function ProofSettings({ codebase, onSave }: { codebase: CodebaseInfo; onSave: (settings: SettingsInput) => void }) {
  const [proof, setProof] = useState(codebase.proof ?? '');
  const [minutes, setMinutes] = useState(String(codebase.proofMinutes ?? DEFAULT_PROOF_MINUTES));
  const [packageFiles, setPackageFiles] = useState(codebase.packageFiles ?? '');
  const [packageFrom, setPackageFrom] = useState(codebase.packageFrom ?? '');
  return (
    <div className="space-y-2">
      <label className={`${ui.label} flex-wrap`}>Proof command
        <input className={ui.field} value={proof} maxLength={500} onChange={(e) => setProof(e.target.value)} aria-describedby="proof-command-hint" />
      </label>
      <p id="proof-command-hint" className={ui.empty}>Run by the hub in the job's copy after the general checks. Apply waits until it passed.</p>
      <label className={`${ui.label} flex-wrap`}>Time limit (minutes)
        <input className={ui.field} type="number" min={1} max={240} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label className={`${ui.label} flex-wrap`}>Upload package
        <input className={ui.field} value={packageFiles} maxLength={200} onChange={(e) => setPackageFiles(e.target.value)} aria-describedby="proof-package-hint" />
      </label>
      <p id="proof-package-hint" className={ui.empty}>Optional. The hub warns when this file is older than the source.</p>
      <label className={`${ui.label} flex-wrap`}>Package is made from (folder)
        <input className={ui.field} value={packageFrom} maxLength={200} onChange={(e) => setPackageFrom(e.target.value)} aria-describedby="proof-package-from-hint" />
      </label>
      <p id="proof-package-from-hint" className={ui.empty}>Optional. Only files in this folder count as the source. Leave it empty to count every file in the project.</p>
      <PackageWarning codebase={codebase} />
      <button className={ui.btn} onClick={() => onSave({ proof, proofMinutes: minutes === '' ? '' : Number(minutes), packageFiles, packageFrom })}>Save</button>
    </div>
  );
}

const CodebaseSettings: React.FC<{
  codebase: CodebaseInfo;
  remote: boolean;
  saving: boolean;
  onSave: (settings: SettingsInput) => void;
}> = ({ codebase, remote, saving, onSave }) => {
  const [folded, toggle] = useFolded('eden_codebase_settings_folded', true);
  const ai = codebase.ai === 'codex' ? 'codex' : 'claude';
  return (
    <div className={`${ui.section} mb-3`}>
      <FoldHeader title={`Settings for ${codebase.name}${folded ? ':' : ''}`} folded={folded} onToggle={toggle} foldedHint={`${ai === 'codex' ? 'Codex' : 'Claude'}${codebase.unreal === true ? ', Unreal project' : ''}`} />
      {!folded && (remote ? (
        <div className="mt-2 space-y-2">
          <p className={ui.empty}>AI that changes the code: {ai === 'codex' ? 'Codex (ChatGPT)' : 'Claude'}. {codebase.unreal === true ? 'Unreal project.' : 'Unreal project setting is off.'} Change these settings on the hub computer.</p>
          {codebase.id === 'hub' ? <p className={ui.empty}>The hub uses its type check, tests and build as its proof.</p> : <PackageWarning codebase={codebase} />}
        </div>
      ) : (
        <fieldset disabled={saving} className="mt-2 space-y-2">
          <label className={`${ui.label} flex-wrap`}>AI that changes the code
            <select className={ui.field} value={ai} onChange={(e) => onSave({ ai: e.target.value === 'codex' ? 'codex' : 'claude' })}>
              <option value="claude">Claude</option>
              <option value="codex">Codex (ChatGPT)</option>
            </select>
          </label>
          <label className={`flex items-center gap-2 ${ui.empty}`}>
            <input type="checkbox" checked={codebase.unreal === true} onChange={(e) => onSave({ unreal: e.target.checked })} />
            This is an Unreal project
          </label>
          <p className={ui.empty}>Codex can then look at the open Unreal editor.</p>
          {codebase.id === 'hub'
            ? <p className={ui.empty}>The hub uses its type check, tests and build as its proof.</p>
            : <ProofSettings key={JSON.stringify([codebase.id, codebase.proof, codebase.proofMinutes, codebase.packageFiles, codebase.packageFrom])} codebase={codebase} onSave={onSave} />}
        </fieldset>
      ))}
    </div>
  );
};

// Piece: the box where you describe the change.
export const RequestBox: React.FC<{ codebaseName: string; value: string; onChange: (v: string) => void }> = ({ codebaseName, value, onChange }) => (
  <>
    <label htmlFor="upd-req" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">What should change in {codebaseName}?</label>
    <textarea
      id="upd-req"
      rows={4}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Describe it like you would to a developer: what you want, and where in the app."
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
    />
  </>
);

// Piece: a gentle note when any files aren't saved to GitHub yet. Shows nothing at zero. It never blocks an update.
// "Save to GitHub now" checks first (nothing is saved yet), asks you to confirm, then saves and pushes. The hub refuses
// anything that looks like a secret and never forces a push.
export const UnsavedWarning: React.FC<{ count?: number; codebaseId?: string }> = ({ count, codebaseId }) => {
  const [step, setStep] = useState<'idle' | 'checking' | 'confirm' | 'saving'>('idle');
  const [plan, setPlan] = useState<{ files: number; target: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setStep('idle');
    setPlan(null);
    setResult(null);
  }, [codebaseId]);

  const url = `/api/codebases/${encodeURIComponent(codebaseId || '')}/commit-push`;
  const check = async () => {
    setStep('checking');
    setResult(null);
    try {
      const d = await post(url, { dryRun: true });
      if (d.ok) {
        setPlan({ files: d.files || 0, target: d.remote && d.branch ? `${d.remote}/${d.branch}` : 'GitHub' });
        setStep('confirm');
      } else {
        setResult({ ok: false, text: d.message || 'Could not check these files.' });
        setStep('idle');
      }
    } catch (err: any) {
      setResult({ ok: false, text: err.message });
      setStep('idle');
    }
  };
  const save = async () => {
    setStep('saving');
    try {
      const d = await post(url, {});
      setResult({ ok: !!d.ok, text: d.ok ? `Saved ✓ ${d.message || ''}`.trim() : d.message || 'Could not save and push.' });
    } catch (err: any) {
      setResult({ ok: false, text: err.message });
    }
    setPlan(null);
    setStep('idle');
  };

  const unsaved = count !== undefined && count >= 1;
  if (!unsaved && !result) return null;
  return (
    <div role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {unsaved && (
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {count} {count === 1 ? 'file' : 'files'} changed here {count === 1 ? "isn't" : "aren't"} saved to GitHub yet. The AI's copy is made from your last saved version (HEAD), then your unsaved changes are added on top, so it starts from them as they are. Very large new files are left out. You can still make this change now.
          </span>
        </p>
      )}
      {unsaved && codebaseId && step !== 'confirm' && (
        <button onClick={check} disabled={step !== 'idle'} className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-950/60">
          {step === 'idle' ? <Wand2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {step === 'checking' ? 'Checking…' : step === 'saving' ? 'Saving…' : 'Save to GitHub now'}
        </button>
      )}
      {step === 'confirm' && plan && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>Save {plan.files} {plan.files === 1 ? 'file' : 'files'} and push {plan.files === 1 ? 'it' : 'them'} to {plan.target}?</span>
          <button onClick={save} className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500">Yes, save and push</button>
          <button onClick={() => { setPlan(null); setStep('idle'); }} className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-950/60">Cancel</button>
        </div>
      )}
      {result && <p role={result.ok ? 'status' : 'alert'} className={`mt-2 ${result.ok ? '' : 'text-red-700 dark:text-red-400'}`}>{result.text}</p>}
    </div>
  );
};

// Piece: "Run on this PC" and the button that starts the change.
export const StartRow: React.FC<{
  onThisPc: boolean;
  onOnThisPc?: (v: boolean) => void;
  busy: boolean;
  canStart: boolean;
  onStart: () => void;
  ideaCount: number; // how many suggested ideas there are to cycle through
  ideaPosition: number; // which one is in the box now (1-based), or 0 if none yet
  onNextIdea: () => void;
}> = ({ onThisPc, onOnThisPc, busy, canStart, onStart, ideaCount, ideaPosition, onNextIdea }) => (
  <>
    <button
      onClick={onNextIdea}
      disabled={ideaCount < 1}
      title={ideaCount < 1 ? 'No suggested ideas yet. Click "New ideas" below.' : 'Put the next suggested idea in the box above'}
      className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Lightbulb className="h-4 w-4 text-amber-500" /> Next idea{ideaCount > 0 && ideaPosition > 0 ? ` (${ideaPosition}/${ideaCount})` : ''}
    </button>
    {onOnThisPc && <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300" title="Claude Code runs on gpt-oss on this PC (like 'ollama launch claude'): free and works offline, but slower and less reliable than Claude.">
      <input type="checkbox" checked={onThisPc} onChange={(e) => onOnThisPc(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
      Run on this PC (free)
    </label>}
    <button onClick={onStart} disabled={!canStart} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
      {busy ? <ListPlus className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} {busy ? 'Add to the queue' : 'Make this change'}
    </button>
  </>
);

export interface Idea {
  title: string;
  why: string;
  request: string;
  size: 'small' | 'medium' | 'large';
}

// Piece – "Suggested for you": Claude reads the codebase (without changing it) plus recent errors and past
// updates, and suggests a few changes. One click queues an idea; the pencil puts it in the box to edit first.
export const SuggestedIdeas: React.FC<{ codebaseId: string; codebaseName: string; claudeReady: boolean; codex: boolean; updateReady: boolean; onEdit: (request: string) => void; onStarted: (jobId: string) => void; onIdeasChange?: (ideas: Idea[]) => void }> = ({
  codebaseId,
  codebaseName,
  claudeReady,
  codex,
  updateReady,
  onEdit,
  onStarted,
  onIdeasChange,
}) => {
  const [data, setData] = useState<{ ideas: Idea[]; at?: string; running?: boolean; error?: string } | null>(null);
  const [acting, setActing] = useState('');
  const [problem, setProblem] = useState('');
  const [skipped, setSkipped] = useState(''); // why the last "New ideas" click didn't start a search

  const load = async (auto = false) => {
    try {
      setData(await api('GET', `/api/updates/ideas?codebaseId=${encodeURIComponent(codebaseId)}${auto ? '&auto=1' : ''}`));
    } catch {}
  };
  useEffect(() => {
    setData(null);
    load(!codex);
  }, [codebaseId, codex]);
  // Tell the card which ideas are showing, so its "Next idea" button can cycle through them.
  useEffect(() => {
    onIdeasChange?.(data?.ideas ?? []);
  }, [data?.ideas]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => load(), 4000);
    return () => clearInterval(t);
  }, [data?.running, codebaseId]);

  const refresh = async (force = false) => {
    setProblem('');
    setSkipped('');
    try {
      const d = await post('/api/updates/ideas', { codebaseId, force });
      if (d?.skipped) setSkipped(d.skipped);
      await load();
    } catch (err: any) {
      setProblem(err.message);
    }
  };
  const startIdea = async (idea: Idea) => {
    setActing(idea.title);
    setProblem('');
    try {
      const d = await post('/api/updates/ideas/start', { codebaseId, title: idea.title });
      onStarted(d.job.id);
      await load();
    } catch (err: any) {
      setProblem(err.message);
    } finally {
      setActing('');
    }
  };
  const dismiss = async (idea: Idea) => {
    setData((d) => (d ? { ...d, ideas: d.ideas.filter((i) => i !== idea) } : d));
    await post('/api/updates/ideas/dismiss', { codebaseId, title: idea.title }).catch(() => {});
  };

  const sizeLabel = { small: 'Quick', medium: 'Medium', large: 'Bigger' };
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Lightbulb className="h-5 w-5 text-amber-500" /> Suggested for {codebaseName}</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Based on the code, recent errors and what you've already changed. {data?.at && `Updated ${new Date(data.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`}
          </p>
          {codex && <p className={ui.empty}>Claude looks for ideas only when you ask for them here.</p>}
        </div>
        <button onClick={() => refresh()} disabled={!claudeReady || !!data?.running} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {data?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {data?.running ? 'Thinking…' : 'New ideas'}
        </button>
      </div>
      {problem && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{problem}</p>}
      {skipped && !data?.running && (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <span>Didn't look for new ideas: {skipped}</span>
          <button onClick={() => refresh(true)} disabled={!claudeReady} className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-950/40">Find ideas anyway</button>
        </p>
      )}
      {data?.error && !data.running && <p className="mt-3 text-sm text-red-600 dark:text-red-400">Last try didn't work: {data.error}</p>}
      {data?.running && !data.ideas.length && <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Claude is reading the code. This takes a minute or two.</p>}
      {data && !data.running && !data.ideas.length && !data.error && <p className="mt-3 text-sm text-slate-500">No ideas yet. Click "New ideas".</p>}
      <div className="mt-3 space-y-2">
        {data?.ideas.map((idea) => (
          <div key={idea.title} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">{idea.title}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{sizeLabel[idea.size]}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{idea.why}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => startIdea(idea)} disabled={!updateReady || !!acting} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                  {acting === idea.title ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Do it
                </button>
                <button onClick={() => onEdit(idea.request)} aria-label={`Edit "${idea.title}" before starting`} title="Edit first" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => dismiss(idea)} aria-label={`Not interested in "${idea.title}"`} title="Not interested" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// The one "Update" card: the pieces above, in order. UpdatesView only has to hand it the state.
export const NextUpdate: React.FC<{
  codebases: CodebaseInfo[];
  target: string;
  onPickTarget: (id: string) => void;
  request: string;
  onRequestChange: (v: string) => void;
  onThisPc: boolean;
  onOnThisPc: (v: boolean) => void;
  busy: boolean;
  claudeReady: boolean;
  codexReady: boolean;
  remote: boolean;
  onStart: (allowUnrealChanges: boolean) => void;
  onSettingsChanged: () => Promise<void>;
  onAdded: (id: string) => Promise<void> | void;
  onError: (message: string) => void;
  onIdeaStarted: (jobId: string) => void;
}> = (p) => {
  const current = p.codebases.find((c) => c.id === p.target);
  const name = current?.name || 'the hub';
  const [folded, toggle] = useFolded('eden_update_panel_folded');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideaIndex, setIdeaIndex] = useState(-1); // which idea the "Next idea" button last put in the box
  const [savingSettings, setSavingSettings] = useState(false);
  const [allowUnrealChanges, setAllowUnrealChanges] = useState(false);
  const codex = current?.ai === 'codex';
  const codexUnreal = codex && current?.unreal === true;
  const updateReady = codex ? p.codexReady : p.claudeReady;
  useEffect(() => {
    setIdeaIndex(-1);
  }, [p.target]);
  useEffect(() => {
    setAllowUnrealChanges(false);
  }, [p.target, codexUnreal]);
  const saveSettings = async (settings: SettingsInput) => {
    if (!current || savingSettings) return;
    setSavingSettings(true);
    p.onError('');
    try {
      await post(`/api/codebases/${encodeURIComponent(current.id)}/settings`, settings);
      await p.onSettingsChanged();
    } catch (err: any) {
      p.onError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };
  // Keep the position valid when the list of ideas changes (new ideas, or one dismissed).
  useEffect(() => setIdeaIndex((i) => (i >= ideas.length ? -1 : i)), [ideas]);
  const nextIdea = () => {
    if (!ideas.length) return;
    const next = (ideaIndex + 1) % ideas.length;
    setIdeaIndex(next);
    p.onRequestChange(ideas[next].request);
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className={folded ? '' : 'mb-3'}>
        <FoldHeader title="Construction" folded={folded} onToggle={toggle} foldedHint={`Ask for a change to ${name}. Press to open.`} />
      </h2>
      {!folded && <>
      <CodebasePicker codebases={p.codebases} target={p.target} onPick={p.onPickTarget} canAdd={!p.remote} onAdded={p.onAdded} onError={p.onError} />
      {current && <CodebaseSettings codebase={current} remote={p.remote} saving={savingSettings} onSave={saveSettings} />}
      <RequestBox codebaseName={name} value={p.request} onChange={p.onRequestChange} />
      {codexUnreal && (
        <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowUnrealChanges} onChange={(e) => setAllowUnrealChanges(e.target.checked)} />
            Let the AI change the open Unreal project
          </label>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StartRow onThisPc={p.onThisPc} onOnThisPc={codex ? undefined : p.onOnThisPc} busy={p.busy} canStart={!savingSettings && !!p.request.trim() && (updateReady || (!codex && p.onThisPc))} onStart={() => {
          p.onStart(codexUnreal && allowUnrealChanges);
          setAllowUnrealChanges(false);
        }} ideaCount={ideas.length} ideaPosition={ideaIndex + 1} onNextIdea={nextIdea} />
      </div>
      {!updateReady && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{notSignedIn(codex ? 'codex' : 'claude')}</p>}
      <UnsavedWarning count={current?.uncommitted} codebaseId={p.remote ? undefined : p.target} />
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Uses your {codex ? 'ChatGPT' : 'Claude'} plan. A change usually takes a few minutes and several messages' worth of usage.
        {p.busy && ' One change runs at a time: anything you add now waits in the queue and starts by itself.'}
      </p>
      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <SuggestedIdeas
          codebaseId={p.target}
          codebaseName={name}
          claudeReady={p.claudeReady}
          codex={codex}
          updateReady={updateReady && !savingSettings}
          onEdit={(r) => {
            p.onRequestChange(r);
            document.getElementById('upd-req')?.focus();
          }}
          onStarted={p.onIdeaStarted}
          onIdeasChange={setIdeas}
        />
      </div>
      </>}
    </section>
  );
};
