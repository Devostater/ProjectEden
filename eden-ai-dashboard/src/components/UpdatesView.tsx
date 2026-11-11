import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Wand2, Loader2, CheckCircle2, XCircle, RotateCcw, Check, Trash2, ChevronDown, AlertTriangle, FileCode, ListPlus, Lightbulb, RefreshCw, X, Pencil } from 'lucide-react';
import { Formatted } from './ChatView.tsx';

interface Job {
  id: string;
  request: string;
  status: 'queued' | 'working' | 'checking' | 'ready' | 'applied' | 'undone' | 'discarded' | 'failed';
  createdAt: string;
  finishedAt?: string;
  log: string[];
  summary?: string;
  files?: { path: string; added: number; removed: number }[];
  check?: { ok: boolean; output: string };
  needsRestart?: boolean;
  error?: string;
  hasDiff?: boolean;
  hasRestorePoint?: boolean;
  codebaseName?: string;
  codebaseId?: string;
}

interface CodebaseInfo {
  id: string;
  name: string;
  dir: string;
  check: 'tsc' | 'node';
  restartHint: string;
  ok: boolean;
}

const STATUS: Record<Job['status'], { label: string; tone: string }> = {
  queued: { label: 'Waiting in the queue', tone: 'text-slate-500 dark:text-slate-400' },
  working: { label: 'AI is working', tone: 'text-indigo-600 dark:text-indigo-400' },
  checking: { label: 'Checking', tone: 'text-indigo-600 dark:text-indigo-400' },
  ready: { label: 'Ready for your review', tone: 'text-amber-600 dark:text-amber-400' },
  applied: { label: 'Applied', tone: 'text-emerald-600 dark:text-emerald-400' },
  undone: { label: 'Undone', tone: 'text-slate-500' },
  discarded: { label: 'Discarded', tone: 'text-slate-500' },
  failed: { label: 'Failed', tone: 'text-red-600 dark:text-red-400' },
};

const IDEAS = [
  'Add a "Duplicate" button to cards on the board.',
  'Show the number of cards waiting for review in the browser tab title.',
  'Add a dark/light toggle to the phone tab bar.',
];

const post = (url: string, body?: unknown) => api('POST', url, body ?? {});

interface Idea {
  title: string;
  why: string;
  request: string;
  size: 'small' | 'medium' | 'large';
}

// "Suggested for you": Claude reads the codebase (without changing it) plus recent errors and past
// updates, and suggests a few changes. One click queues an idea; the pencil puts it in the box to edit first.
const SuggestedIdeas: React.FC<{ codebaseId: string; codebaseName: string; claudeReady: boolean; onEdit: (request: string) => void; onStarted: (jobId: string) => void }> = ({
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
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Lightbulb className="h-5 w-5 text-amber-500" /> Suggested for {codebaseName}</h2>
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
    </section>
  );
};

// The patch, shown file by file with added lines green and removed lines red.
const DiffView: React.FC<{ id: string }> = ({ id }) => {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/updates/${id}/diff`)
      .then((r) => r.json())
      .then((d) => setDiff(d.diff || ''))
      .catch(() => setDiff(''));
  }, [id]);
  if (diff === null) return <p className="text-sm text-slate-500">Loading the changes…</p>;
  const files = diff.split(/^diff --git /m).filter(Boolean);
  return (
    <div className="space-y-3">
      {files.map((chunk, i) => {
        const name = (chunk.match(/ b\/(\S+)/)?.[1] || 'file').split('/').slice(1).join('/');
        const lines = chunk.split('\n').filter((l) => !/^(a\/|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(l));
        return (
          <details key={i} open={files.length <= 3} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">{name}</summary>
            <pre className="max-h-96 overflow-auto text-xs leading-relaxed">
              {lines.slice(1).map((l, j) => (
                <div
                  key={j}
                  className={
                    l.startsWith('+')
                      ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                      : l.startsWith('-')
                        ? 'bg-red-500/10 text-red-800 dark:text-red-300'
                        : l.startsWith('@@')
                          ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-600 dark:text-slate-400'
                  }
                >
                  {' '}
                  {l}
                </div>
              ))}
            </pre>
          </details>
        );
      })}
    </div>
  );
};

export const UpdatesView: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [claudeReady, setClaudeReady] = useState(true);
  const [codebases, setCodebases] = useState<CodebaseInfo[]>([]);
  const [target, setTarget] = useState('hub');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDir, setNewDir] = useState('');
  const [request, setRequest] = useState('');
  const [onThisPc, setOnThisPc] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<Job | null>(null); // the applied update waiting for "Yes, undo it"
  const live = useRef(false);

  const load = async () => {
    try {
      const d = await fetch('/api/updates').then((r) => r.json());
      if (d.error) return setError(d.error);
      setJobs(d.jobs);
      setBusy(d.busy);
      setClaudeReady(d.claudeReady);
      setCodebases(d.codebases || []);
      live.current = d.busy;
    } catch {}
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await load();
      if (alive) timer = setTimeout(tick, live.current ? 2000 : 8000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const start = async () => {
    setError('');
    setNote('');
    try {
      const d = await post('/api/updates', { request, codebaseId: target, local: onThisPc });
      setRequest('');
      setOpenId(d.job.id);
      live.current = true;
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const act = async (job: Job, action: 'apply' | 'undo' | 'discard') => {
    setError('');
    setNote('');
    setActing(job.id);
    try {
      const d = await post(`/api/updates/${job.id}/${action}`);
      if (action !== 'discard') {
        setNote(
          d.needsRestart
            ? `${action === 'apply' ? 'Applied' : 'Undone'}. To finish: ${d.restartHint || 'restart the app'}.`
            : `${action === 'apply' ? 'Applied' : 'Undone'}. The page updates by itself in a moment.`
        );
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  };

  // Waiting updates in the order they will run (oldest first; the list above is newest first).
  const queue = jobs.filter((j) => j.status === 'queued').map((j) => j.id).reverse();

  const retry = async (job: Job) => {
    setError('');
    setNote('');
    setActing(job.id);
    try {
      const d = await post(`/api/updates/${job.id}/retry`);
      setOpenId(d.job.id);
      live.current = true;
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          <Wand2 className="h-6 w-6 text-indigo-500" /> Code updates
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Ask the AI to change the hub, LYRA, or another codebase. It works on a separate copy, the hub runs the checks, and you see every changed line before anything is applied.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Change:</span>
          {codebases.filter((c) => c.ok).map((c) => (
            <button
              key={c.id}
              onClick={() => setTarget(c.id)}
              aria-pressed={target === c.id}
              title={c.dir}
              className={`rounded-lg border px-3 py-1.5 text-sm ${target === c.id ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-slate-300 text-slate-600 hover:border-indigo-400 dark:border-slate-700 dark:text-slate-300'}`}
            >
              {c.name}
            </button>
          ))}
          <button onClick={() => setAdding(!adding)} className="text-sm text-slate-500 hover:underline">+ Add a codebase</button>
        </div>
        {adding && (
          <div className="mb-3 flex flex-wrap gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. Project Nova" className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <input value={newDir} onChange={(e) => setNewDir(e.target.value)} placeholder="Folder, e.g. C:\Users\you\Documents\GITHUB\Project-Nova" className="min-w-[16rem] flex-[2] rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            <button
              onClick={async () => {
                setError('');
                try {
                  const d = await post('/api/codebases', { name: newName, dir: newDir });
                  setAdding(false);
                  setNewName('');
                  setNewDir('');
                  setTarget(d.id);
                  await load();
                } catch (err: any) {
                  setError(err.message);
                }
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Add
            </button>
            <p className="w-full text-xs text-slate-500">The folder must be inside a git repository, so every change can be reviewed and undone.</p>
          </div>
        )}
        <label htmlFor="upd-req" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">What should change in {codebases.find((c) => c.id === target)?.name || 'the hub'}?</label>
        <textarea
          id="upd-req"
          rows={4}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe it like you would to a developer: what you want, and where in the app."
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {IDEAS.map((idea) => (
            <button key={idea} onClick={() => setRequest(idea)} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300">
              {idea}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300" title="Claude Code runs on gpt-oss on this PC (like 'ollama launch claude'): free and works offline, but slower and less reliable than Claude.">
            <input type="checkbox" checked={onThisPc} onChange={(e) => setOnThisPc(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            Run on this PC (free)
          </label>
          <button
            onClick={start}
            disabled={!request.trim() || (!claudeReady && !onThisPc)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? <ListPlus className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} {busy ? 'Add to the queue' : 'Make this change'}
          </button>
        </div>
        {!claudeReady && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">App updates use Claude Code. Sign in to Claude in Account → Connections first.</p>}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Uses your Claude plan. A change usually takes a few minutes and several messages' worth of usage.
          {busy && ' One change runs at a time: anything you add now waits in the queue and starts by itself.'}
        </p>
      </section>

      <SuggestedIdeas
        codebaseId={target}
        codebaseName={codebases.find((c) => c.id === target)?.name || 'the hub'}
        claudeReady={claudeReady}
        onEdit={(r) => {
          setRequest(r);
          document.getElementById('upd-req')?.focus();
        }}
        onStarted={(id) => {
          setOpenId(id);
          live.current = true;
          load();
        }}
      />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{note}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Updates</h2>
        {!jobs.length && <p className="text-sm text-slate-500 dark:text-slate-400">None yet.</p>}
        {jobs.map((job) => {
          const open = openId === job.id || job.status === 'queued' || job.status === 'working' || job.status === 'checking' || job.status === 'ready';
          const st = STATUS[job.status];
          return (
            <article key={job.id} className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => setOpenId(openId === job.id ? null : job.id)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">
                    {job.codebaseName && <span className="mr-2 rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">{job.codebaseName}</span>}
                    {job.request}
                  </span>
                  <span className={`mt-0.5 flex items-center gap-1.5 text-xs ${st.tone}`}>
                    {(job.status === 'working' || job.status === 'checking') && <Loader2 className="h-3 w-3 animate-spin" />}
                    {st.label}
                    {job.files && <span className="text-slate-500"> · {job.files.length} file{job.files.length === 1 ? '' : 's'}</span>}
                    <span className="text-slate-500"> · {new Date(job.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                </span>
              </button>

              {open && (
                <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                  {job.status === 'queued' && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Number {queue.indexOf(job.id) + 1} in the queue. It starts by itself when the one before it finishes.
                    </p>
                  )}

                  {(job.status === 'working' || job.status === 'checking') && (
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-300">
                      {job.log.slice(-40).map((l, i) => (
                        <li key={i}>· {l}</li>
                      ))}
                    </ul>
                  )}

                  {job.error && <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>}

                  {job.summary && (
                    <div className="rounded-lg bg-slate-50 p-3 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
                      <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">What the AI says it did</div>
                      <Formatted text={job.summary} />
                    </div>
                  )}

                  {job.files && (
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Changed files</div>
                      <ul className="space-y-0.5 text-sm">
                        {job.files.map((f) => (
                          <li key={f.path} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                            <span className="text-xs tabular-nums text-emerald-600">+{f.added}</span>
                            <span className="text-xs tabular-nums text-red-600">−{f.removed}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {job.check && (
                    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${job.check.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'}`}>
                      {job.check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        {job.check.ok ? 'Checks passed.' : 'Checks failed: applying this would likely break it.'}
                        {job.check.ok && job.check.output && <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">{job.check.output}</pre>}
                        {!job.check.ok && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{job.check.output}</pre>}
                      </div>
                    </div>
                  )}

                  {job.needsRestart && job.status === 'ready' && (
                    <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> This changes the server part, so after applying: {codebases.find((c) => c.id === job.codebaseId)?.restartHint || 'restart the app'}.
                    </p>
                  )}

                  {job.hasDiff && (
                    <div>
                      <button onClick={() => setShowDiff(showDiff === job.id ? null : job.id)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                        {showDiff === job.id ? 'Hide the changes' : 'See every changed line'}
                      </button>
                      {showDiff === job.id && (
                        <div className="mt-2">
                          <DiffView id={job.id} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {(job.status === 'ready' || job.status === 'undone') && job.hasDiff && (
                      <button
                        onClick={() => act(job, 'apply')}
                        disabled={acting === job.id}
                        className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${job.check?.ok === false ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                      >
                        <Check className="h-4 w-4" /> {job.check?.ok === false ? 'Apply anyway' : 'Apply to the app'}
                      </button>
                    )}
                    {job.status === 'applied' && (
                      <button onClick={() => setConfirmUndo(job)} disabled={acting === job.id} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <RotateCcw className="h-4 w-4" /> Undo
                      </button>
                    )}
                    {job.status === 'failed' && (
                      <button
                        onClick={() => retry(job)}
                        disabled={acting === job.id || !claudeReady}
                        title={busy ? 'Another update is in progress, so this one will wait in the queue' : undefined}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        <RotateCcw className="h-4 w-4" /> Try again
                      </button>
                    )}
                    {(job.status === 'queued' || job.status === 'ready' || job.status === 'undone' || job.status === 'failed') && (
                      <button onClick={() => act(job, 'discard')} disabled={acting === job.id} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
                        <Trash2 className="h-4 w-4" /> {job.status === 'queued' ? 'Take out of the queue' : 'Discard'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {confirmUndo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmUndo(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="undo-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirmUndo(null)}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900"
          >
            <h2 id="undo-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <RotateCcw className="h-5 w-5 text-amber-500" /> Undo this update?
            </h2>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">“{confirmUndo.request.length > 140 ? `${confirmUndo.request.slice(0, 140)}…` : confirmUndo.request}”</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {confirmUndo.files?.length || 'The'} changed file{confirmUndo.files?.length === 1 ? ' goes' : 's go'} back to how {confirmUndo.files?.length === 1 ? 'it was' : 'they were'} just before you applied it.
              {confirmUndo.hasRestorePoint
                ? ' If you edited those files since, those edits will no longer be in the app. A copy of the files as they are now is kept in git first, so a developer can still recover them.'
                : ' This update was applied before restore points existed, so it is undone by reversing its change, and it can only be undone if nothing else has changed those lines.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirmUndo(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Keep it
              </button>
              <button
                onClick={() => {
                  const job = confirmUndo;
                  setConfirmUndo(null);
                  act(job, 'undo');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
              >
                <RotateCcw className="h-4 w-4" /> Yes, undo it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
