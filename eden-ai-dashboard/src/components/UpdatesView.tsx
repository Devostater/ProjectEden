import React, { useEffect, useRef, useState } from 'react';
import { Wand2, Loader2, CheckCircle2, XCircle, RotateCcw, Check, Trash2, ChevronDown, AlertTriangle, FileCode } from 'lucide-react';
import { Formatted } from './ChatView.tsx';

interface Job {
  id: string;
  request: string;
  status: 'working' | 'checking' | 'ready' | 'applied' | 'undone' | 'discarded' | 'failed';
  createdAt: string;
  finishedAt?: string;
  log: string[];
  summary?: string;
  files?: { path: string; added: number; removed: number }[];
  check?: { ok: boolean; output: string };
  needsRestart?: boolean;
  error?: string;
  hasDiff?: boolean;
}

const STATUS: Record<Job['status'], { label: string; tone: string }> = {
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

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

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
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const live = useRef(false);

  const load = async () => {
    try {
      const d = await fetch('/api/updates').then((r) => r.json());
      if (d.error) return setError(d.error);
      setJobs(d.jobs);
      setBusy(d.busy);
      setClaudeReady(d.claudeReady);
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
      const d = await post('/api/updates', { request });
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
            ? `${action === 'apply' ? 'Applied' : 'Undone'}. This change affects the server: close and reopen "Start Eden" to finish.`
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          <Wand2 className="h-6 w-6 text-indigo-500" /> Improve the hub
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Ask the AI to change this app. It works on a separate copy, the hub checks it, and you see every changed line before anything is applied.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label htmlFor="upd-req" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">What should change?</label>
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
          <button
            onClick={start}
            disabled={!request.trim() || busy || !claudeReady}
            className="ml-auto flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {busy ? 'An update is in progress' : 'Make this change'}
          </button>
        </div>
        {!claudeReady && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">App updates use Claude Code. Sign in to Claude in Account → Connections first.</p>}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Uses your Claude plan. A change usually takes a few minutes and several messages' worth of usage.</p>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{note}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900 dark:text-white">Updates</h2>
        {!jobs.length && <p className="text-sm text-slate-500 dark:text-slate-400">None yet.</p>}
        {jobs.map((job) => {
          const open = openId === job.id || job.status === 'working' || job.status === 'checking' || job.status === 'ready';
          const st = STATUS[job.status];
          return (
            <article key={job.id} className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => setOpenId(openId === job.id ? null : job.id)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">{job.request}</span>
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
                        {job.check.ok ? 'Type check passed.' : 'Type check failed: applying this would likely break the app.'}
                        {!job.check.ok && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{job.check.output}</pre>}
                      </div>
                    </div>
                  )}

                  {job.needsRestart && job.status === 'ready' && (
                    <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> This changes the server, so the hub needs restarting after you apply it.
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
                      <button onClick={() => act(job, 'undo')} disabled={acting === job.id} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <RotateCcw className="h-4 w-4" /> Undo
                      </button>
                    )}
                    {(job.status === 'ready' || job.status === 'undone' || job.status === 'failed') && (
                      <button onClick={() => act(job, 'discard')} disabled={acting === job.id} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
                        <Trash2 className="h-4 w-4" /> Discard
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
};
