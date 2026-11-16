import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Wand2, Loader2, ListPlus, Lightbulb, RefreshCw, X, Pencil, AlertTriangle } from 'lucide-react';

// The "Update" card: everything for asking for the next change lives here, in small pieces.
// Each piece below does one job, so a later patch only has to touch the piece it is about:
//   CodebasePicker  – which codebase to change (and adding a new one)
//   RequestBox      – the box where you describe the change
//   IdeaChips       – the quick example sentences under the box
//   UnsavedWarning  – the note when many files aren't saved to GitHub yet
//   StartRow        – "Run on this PC" and the Make this change button
//   SuggestedIdeas  – ideas the AI suggests for this codebase
//   NextUpdate      – puts the pieces together in one card

export interface CodebaseInfo {
  id: string;
  name: string;
  dir: string;
  check: 'tsc' | 'node';
  restartHint: string;
  ok: boolean;
  uncommitted?: number; // files changed here that are not saved to GitHub yet
}

const IDEAS = [
  'Add a "Duplicate" button to cards on the board.',
  'Show the number of cards waiting for review in the browser tab title.',
  'Add a dark/light toggle to the phone tab bar.',
];

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
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Change:</span>
        {codebases.filter((c) => c.ok).map((c) => (
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
        {canAdd && <button onClick={() => setAdding(!adding)} className="text-sm text-slate-500 hover:underline">+ Add a codebase</button>}
      </div>
      {adding && (
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

// Piece: quick example sentences that fill the box when clicked.
export const IdeaChips: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => (
  <>
    {IDEAS.map((idea) => (
      <button key={idea} onClick={() => onPick(idea)} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300">
        {idea}
      </button>
    ))}
  </>
);

// Piece: a gentle note when any files aren't saved to GitHub yet. Shows nothing at zero. It never blocks an update.
export const UnsavedWarning: React.FC<{ count?: number }> = ({ count }) => {
  if (count === undefined || count < 1) return null;
  return (
    <p role="status" className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {count} {count === 1 ? 'file' : 'files'} changed here {count === 1 ? "isn't" : "aren't"} saved to GitHub yet. The AI's copy is made from your last saved version (HEAD), then your unsaved changes are added on top, so it starts from them as they are. Very large new files are left out. You can still make this change now.
      </span>
    </p>
  );
};

// Piece: "Run on this PC" and the button that starts the change.
export const StartRow: React.FC<{
  onThisPc: boolean;
  onOnThisPc: (v: boolean) => void;
  busy: boolean;
  canStart: boolean;
  onStart: () => void;
}> = ({ onThisPc, onOnThisPc, busy, canStart, onStart }) => (
  <>
    <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300" title="Claude Code runs on gpt-oss on this PC (like 'ollama launch claude'): free and works offline, but slower and less reliable than Claude.">
      <input type="checkbox" checked={onThisPc} onChange={(e) => onOnThisPc(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
      Run on this PC (free)
    </label>
    <button onClick={onStart} disabled={!canStart} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
      {busy ? <ListPlus className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} {busy ? 'Add to the queue' : 'Make this change'}
    </button>
  </>
);

interface Idea {
  title: string;
  why: string;
  request: string;
  size: 'small' | 'medium' | 'large';
}

// Piece – "Suggested for you": Claude reads the codebase (without changing it) plus recent errors and past
// updates, and suggests a few changes. One click queues an idea; the pencil puts it in the box to edit first.
export const SuggestedIdeas: React.FC<{ codebaseId: string; codebaseName: string; claudeReady: boolean; onEdit: (request: string) => void; onStarted: (jobId: string) => void }> = ({
  codebaseId,
  codebaseName,
  claudeReady,
  onEdit,
  onStarted,
}) => {
  const [data, setData] = useState<{ ideas: Idea[]; at?: string; running?: boolean; error?: string } | null>(null);
  const [acting, setActing] = useState('');
  const [problem, setProblem] = useState('');

  const load = async (auto = false) => {
    try {
      setData(await api('GET', `/api/updates/ideas?codebaseId=${encodeURIComponent(codebaseId)}${auto ? '&auto=1' : ''}`));
    } catch {}
  };
  useEffect(() => {
    setData(null);
    load(true);
  }, [codebaseId]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => load(), 4000);
    return () => clearInterval(t);
  }, [data?.running, codebaseId]);

  const refresh = async () => {
    setProblem('');
    try {
      await post('/api/updates/ideas', { codebaseId });
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
        </div>
        <button onClick={refresh} disabled={!claudeReady || !!data?.running} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {data?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {data?.running ? 'Thinking…' : 'New ideas'}
        </button>
      </div>
      {problem && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{problem}</p>}
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
                <button onClick={() => startIdea(idea)} disabled={!claudeReady || !!acting} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
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
  remote: boolean;
  onStart: () => void;
  onAdded: (id: string) => Promise<void> | void;
  onError: (message: string) => void;
  onIdeaStarted: (jobId: string) => void;
}> = (p) => {
  const current = p.codebases.find((c) => c.id === p.target);
  const name = current?.name || 'the hub';
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Update</h2>
      <CodebasePicker codebases={p.codebases} target={p.target} onPick={p.onPickTarget} canAdd={!p.remote} onAdded={p.onAdded} onError={p.onError} />
      <RequestBox codebaseName={name} value={p.request} onChange={p.onRequestChange} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <IdeaChips onPick={p.onRequestChange} />
        <StartRow onThisPc={p.onThisPc} onOnThisPc={p.onOnThisPc} busy={p.busy} canStart={!!p.request.trim() && (p.claudeReady || p.onThisPc)} onStart={p.onStart} />
      </div>
      {!p.claudeReady && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">App updates use Claude Code. Sign in to Claude in Account → Connections first.</p>}
      <UnsavedWarning count={current?.uncommitted} />
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Uses your Claude plan. A change usually takes a few minutes and several messages' worth of usage.
        {p.busy && ' One change runs at a time: anything you add now waits in the queue and starts by itself.'}
      </p>
      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <SuggestedIdeas
          codebaseId={p.target}
          codebaseName={name}
          claudeReady={p.claudeReady}
          onEdit={(r) => {
            p.onRequestChange(r);
            document.getElementById('upd-req')?.focus();
          }}
          onStarted={p.onIdeaStarted}
        />
      </div>
    </section>
  );
};
