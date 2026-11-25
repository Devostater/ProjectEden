import RunnersPanel from './RunnersPanel';
import React, { useEffect, useRef, useState } from 'react';
import { picksAsText, clearPicks } from '../picker.ts';
import { api } from '../api.ts';
import { Wand2, Loader2, CheckCircle2, XCircle, RotateCcw, Check, Trash2, ChevronDown, AlertTriangle, FileCode, RefreshCw, Lock, Wrench, ArrowUp, ArrowDown, ChevronsUp, RotateCw } from 'lucide-react';
import { Formatted } from './ChatView.tsx';
import { NextUpdate, type CodebaseInfo } from './NextUpdate.tsx';
import type { UnrealToolsStatus } from '../../unrealUpdate';

const unrealToolsLabel: Record<UnrealToolsStatus, string> = {
  look: 'on (look only)',
  change: 'on (can change)',
  closed: 'off (editor closed)',
  missing: 'off',
};
import { diagnose, applyFix, canFix, planFixAll, type Fix } from '../updateFixes.ts';
import { markUpdatesSeen, refreshUpdatesFeed } from '../readyUpdates.ts';
import { updateCheckIssue, type UpdateCheck } from '../../updateReleaseGate.ts';

interface Job {
  id: string;
  request: string;
  status: 'queued' | 'working' | 'checking' | 'ready' | 'answered' | 'applied' | 'undone' | 'discarded' | 'failed';
  createdAt: string;
  startedAt?: string; // when the AI began working on it
  finishedAt?: string;
  log: string[];
  summary?: string;
  lastAiMessage?: string; // the last thing the AI said in words (already included in the error text when nothing changed)
  files?: { path: string; added: number; removed: number }[];
  check?: UpdateCheck;
  needsRestart?: boolean;
  error?: string;
  hasDiff?: boolean;
  unrealTools?: UnrealToolsStatus;
  codex?: boolean;
  hasRestorePoint?: boolean;
  codebaseName?: string;
  codebaseId?: string;
  interrupted?: boolean; // stopped because the hub restarted while it ran
  uncommitted?: number; // files not yet saved to GitHub when this update was based on the code
  stale?: boolean; // the code changed since this update was made, so it no longer fits
  olderBase?: string; // still fits, but the code changed after this one's checks ran (another update was applied or undone)
  olderBaseSameFiles?: boolean; // and that update changed a file this one changes too
  retryOf?: string; // started by "Try again" from this earlier update
  retriedAs?: string; // "Try again" was pressed: the newer update that took its place
  autoRetry?: boolean; // the hub re-made it by itself because the earlier one no longer fit (only done once)
  local?: boolean; // ran on an AI on this PC instead of your Claude plan
}

const unsavedNote = (n: number) => `Based on your current files, including ${n} not yet saved to GitHub`;

const STATUS: Record<Job['status'], { label: string; tone: string }> = {
  queued: { label: 'Waiting in the queue', tone: 'text-slate-500 dark:text-slate-400' },
  working: { label: 'AI is working', tone: 'text-indigo-600 dark:text-indigo-400' },
  checking: { label: 'Checking', tone: 'text-indigo-600 dark:text-indigo-400' },
  ready: { label: 'Ready for your review', tone: 'text-amber-600 dark:text-amber-400' },
  answered: { label: 'Answered', tone: 'text-emerald-600 dark:text-emerald-400' },
  applied: { label: 'Applied', tone: 'text-emerald-600 dark:text-emerald-400' },
  undone: { label: 'Undone', tone: 'text-slate-500' },
  discarded: { label: 'Discarded', tone: 'text-slate-500' },
  failed: { label: 'Failed', tone: 'text-red-600 dark:text-red-400' },
};

// The Updates list is split into three tabs. "Active" includes updates waiting for your review.
type UpdatesTab = 'construction' | 'active' | 'error' | 'finished';
const TAB_OF: Record<Job['status'], UpdatesTab> = {
  queued: 'active',
  working: 'active',
  checking: 'active',
  ready: 'active',
  failed: 'error',
  answered: 'finished',
  applied: 'finished',
  undone: 'finished',
  discarded: 'finished',
};
const TABS: { id: UpdatesTab; label: string; empty: string }[] = [
  { id: 'construction', label: 'Construction', empty: '' },
  { id: 'active', label: 'Active', empty: 'Nothing is running or waiting for you right now.' },
  { id: 'error', label: 'Error', empty: 'Nothing has failed.' },
  { id: 'finished', label: 'Finished', empty: 'Nothing finished yet.' },
];

const post = (url: string, body?: unknown) => api('POST', url, body ?? {});

// "3 min 05 s" / "42 s" / "1 h 02 min"
const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

// How far along an update is, read from its log steps: queued 0%, copy made 15%, AI working 50%, checking 85%.
const progressOf = (job: Job) => {
  if (job.status === 'queued') return 0;
  const restart = job.log.lastIndexOf('Back in the queue: it starts again from the beginning by itself');
  let p = 5;
  for (const l of job.log.slice(restart + 1)) {
    if (l.startsWith('Making a separate copy')) p = Math.max(p, 15);
    else if (l === 'Claude is working on the copy' || l.startsWith('Running on this PC')) p = Math.max(p, 50);
    else if (l === 'Running the type check' || l === 'Checking the code and running the tests') p = Math.max(p, 85);
  }
  return job.status === 'checking' ? Math.max(p, 85) : p;
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
  const [codexReady, setCodexReady] = useState(false);
  const [codebases, setCodebases] = useState<CodebaseInfo[]>([]);
  const [target, setTarget] = useState('hub');
  const [request, setRequest] = useState('');
  const [onThisPc, setOnThisPc] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<Job | null>(null); // the applied update waiting for "Yes, undo it"
  const [confirmApply, setConfirmApply] = useState<Job | null>(null); // on a phone or tablet: "Yes, apply it"
  const [locked, setLocked] = useState(''); // this device isn't allowed to use Code updates (the reason)
  const [remote, setRemote] = useState(false); // this is a paired phone or tablet, not the PC
  const [confirmAll, setConfirmAll] = useState(false); // "Apply all": waiting for "Yes, apply them all"
  const [applyingAll, setApplyingAll] = useState(false);
  const [restartPending, setRestartPending] = useState(false); // an applied update needs the hub restarted
  const [restarting, setRestarting] = useState(false);
  // Opened from the picker after starting an update: show it running (Active).
  const [tab, setTab] = useState<UpdatesTab>(() => { try { if (sessionStorage.getItem('eden_updates_open') === 'active') { sessionStorage.removeItem('eden_updates_open'); return 'active'; } } catch {} return 'construction'; });
  const [checking, setChecking] = useState(false); // "Check for fixes" is reloading everything
  const [confirmFixAll, setConfirmFixAll] = useState(false); // "Fix all": waiting for "Yes, fix them"
  const [fixingAll, setFixingAll] = useState(false);
  const [estimateMs, setEstimateMs] = useState(8 * 60 * 1000); // how long an update usually takes
  const [clock, setClock] = useState(Date.now()); // ticks every second while something runs, so elapsed time counts up
  const [readyOpen, setReadyOpen] = useState(false); // the one "ready for your review" group in Active is unfolded
  const live = useRef(false);

  const load = async () => {
    try {
      const res = await fetch('/api/updates');
      const d = await res.json();
      if (res.status === 403) return setLocked(d.error || 'Code updates are kept to the computer running the hub.');
      if (d.error) return setError(d.error);
      setLocked('');
      setJobs(d.jobs);
      setBusy(d.busy);
      setClaudeReady(d.claudeReady);
      setCodexReady(d.codexReady === true);
      setCodebases(d.codebases || []);
      if (typeof d.estimateMs === 'number' && d.estimateMs > 0) setEstimateMs(d.estimateMs);
      setRemote(!!d.remote);
      setRestartPending(!!d.restartPending);
      live.current = d.busy;
      // You are looking at the page, so finished and failed updates are no longer news in the top bar.
      markUpdatesSeen();
      refreshUpdatesFeed();
    } catch {}
  };

  // "Check for updates & fixes": reloads every update and says what needs you.
  const checkAll = async () => {
    setChecking(true); setError(''); setNote('');
    try {
      const res = await fetch('/api/updates', { cache: 'no-store' });
      const d = await res.json();
      await load();
      const list = d.jobs || [];
      const plan = planFixAll(list, Date.now(), !!d.claudeReady, !!d.codexReady);
      const ready = list.filter((j: Job) => j.status === 'ready').length;
      const failed = list.filter((j: Job) => j.status === 'failed').length;
      const parts = [];
      if (ready) parts.push(ready + ' ready to apply');
      if (failed) parts.push(failed + ' failed (' + plan.run + ' can be fixed with Fix all)');
      setNote(parts.length ? 'Checked: ' + parts.join(', ') + '.' : 'Checked: everything is up to date.');
      if (failed) setTab('error'); else if (ready) setTab('active');
    } catch (e: any) { setError("Could not reach the hub: " + e.message); }
    setChecking(false);
  };

  // Asks the hub to restart, waits for it to stop and come back, then reloads the page.
  const restartHub = async () => {
    setError('');
    setRestarting(true);
    try {
      const res = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(data.interrupted) && data.interrupted.length) {
        // Work is still going: show what a restart would cut off, and only go ahead if the owner says so.
        if (!window.confirm(`Restarting now would interrupt this work:\n\n- ${data.interrupted.join('\n- ')}\n\nRestart anyway?`)) {
          setRestarting(false);
          return;
        }
        const again = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) });
        if (!again.ok) throw new Error((await again.json().catch(() => ({}))).error || 'Could not restart the hub.');
      } else if (!res.ok) {
        throw new Error(data.error || 'Could not restart the hub.');
      }
    } catch (err: any) {
      setError(err.message);
      setRestarting(false);
      return;
    }
    await new Promise((r) => setTimeout(r, 2500)); // give the old copy time to close
    const until = Date.now() + 2 * 60 * 1000;
    while (Date.now() < until) {
      try {
        const r = await fetch('/api/models', { cache: 'no-store' });
        if (r.status < 500) return window.location.reload();
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    setRestarting(false);
    setError("The hub didn't come back after two minutes. Close and reopen Start Eden on the PC to bring it back.");
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

  const running = jobs.some((j) => j.status === 'queued' || j.status === 'working' || j.status === 'checking');
  useEffect(() => {
    if (!running) return;
    setClock(Date.now());
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const start = async (codex: boolean, allowUnrealChanges: boolean) => {
    setError('');
    setNote('');
    try {
      const d = await post('/api/updates', { request: request + picksAsText(), codebaseId: target, local: !codex && onThisPc, codex, allowUnrealChanges });
      setRequest('');
      clearPicks();
      setOpenId(d.job.id);
      setTab('active');
      live.current = true;
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const act = async (job: Job, action: 'apply' | 'undo' | 'discard', overrideChecks = false) => {
    setError('');
    setNote('');
    setActing(job.id);
    try {
      const d = await post(`/api/updates/${job.id}/${action}`, overrideChecks ? { overrideChecks: true } : undefined);
      if (action !== 'discard') {
        const hub = (job.codebaseId || 'hub') === 'hub';
        setNote(
          d.needsRestart
            ? hub
              ? `${action === 'apply' ? 'Applied' : 'Undone'}. Press "Restart Eden now" above to finish.`
              : `${action === 'apply' ? 'Applied' : 'Undone'}. To finish: ${d.restartHint || 'restart the app'}.`
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

  const readyWithDiff = jobs.filter((j) => j.status === 'ready' && j.hasDiff);
  const applyable = readyWithDiff.filter((j) => !updateCheckIssue(j.codebaseId || 'hub', j.check)).reverse();
  const skippedChecks = readyWithDiff.length - applyable.length;
  const confirmOverride = !!confirmApply && !!updateCheckIssue(confirmApply.codebaseId || 'hub', confirmApply.check);

  // Applies them one at a time through the same safe route as the single button (each saves its own restore point).
  const applyAll = async () => {
    setConfirmAll(false);
    setError('');
    setNote('');
    setApplyingAll(true);
    let done = 0;
    let needsRestart = false;
    const problems: string[] = [];
    for (const job of applyable) {
      setActing(job.id);
      try {
        const d = await post(`/api/updates/${job.id}/apply`);
        done++;
        if (d.needsRestart) needsRestart = true;
      } catch (err: any) {
        problems.push(`"${job.request.length > 60 ? `${job.request.slice(0, 60)}…` : job.request}": ${err.message}`);
      }
    }
    setActing(null);
    setApplyingAll(false);
    if (done > 0) {
      setNote(
        `Applied ${done} update${done === 1 ? '' : 's'}.${needsRestart ? ' Some change the server part, so press "Restart Eden now" above (or restart the app) to finish.' : ' The page updates by itself in a moment.'}`
      );
    }
    if (problems.length) setError(`${problems.length} update${problems.length === 1 ? ' was' : 's were'} not applied, and nothing was changed for ${problems.length === 1 ? 'it' : 'them'}. ${problems.join(' ')}`);
    await load();
  };

  // Waiting updates in the order they will run (oldest first; the list above is newest first).
  const queue =jobs.filter((j) => j.status === 'queued').map((j) => j.id).reverse();

  // Change a waiting update's place in the queue.
  const move = async (job: Job, to: 'up' | 'down' | 'first') => {
    setError('');
    setActing(job.id);
    try {
      await post(`/api/updates/${job.id}/move`, { to });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  };

  const retry = async (job: Job) => {
    setError('');
    setNote('');
    setActing(job.id);
    try {
      const d = await post(`/api/updates/${job.id}/retry`);
      setOpenId(d.job.id);
      setTab('active');
      live.current = true;
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  };

  // One easy fix (see updateFixes.ts). Throws on failure so "Fix all" can count it; returns the new update's id, if any.
  const doFix = (job: Job, fix: Fix) => applyFix(job, fix, post);

  const fixOne = async (job: Job, fix: Fix) => {
    setError('');
    setNote('');
    setActing(job.id);
    try {
      const id = await doFix(job, fix);
      if (id) {
        setOpenId(id);
        setTab('active');
        live.current = true;
        setNote(busy ? 'Started again. It waits in the queue and runs by itself.' : 'Started again.');
      } else {
        setNote('Cleared.');
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActing(null);
    }
  };

  const fixPlan = planFixAll(jobs, Date.now(), claudeReady, codexReady);
  const fixAll = async () => {
    setConfirmFixAll(false);
    setError('');
    setNote('');
    setFixingAll(true);
    let started = 0;
    let cleared = 0;
    const problems: string[] = [];
    // Clear the extra copies first, so the run-again step never trips over a twin still in the list.
    const ordered = [
      ...fixPlan.plan.filter((p) => p.fix.action === 'discard'),
      ...fixPlan.plan.filter((p) => p.fix.action !== 'discard' && p.fix.action !== 'wait' && !p.blocked).reverse(),
    ];
    for (const { job, fix } of ordered) {
      setActing(job.id);
      try {
        if (await doFix(job as Job, fix)) started++;
        else cleared++;
      } catch (err: any) {
        problems.push(`"${job.request.length > 50 ? `${job.request.slice(0, 50)}…` : job.request}": ${err.message}`);
      }
    }
    setActing(null);
    setFixingAll(false);
    const parts: string[] = [];
    if (started) parts.push(`started ${started} again (they run one at a time)`);
    if (cleared) parts.push(`cleared ${cleared} that ${cleared === 1 ? "wasn't" : "weren't"} needed`);
    if (fixPlan.waiting) parts.push(`left ${fixPlan.waiting} waiting for usage limits to reset`);
    if (fixPlan.blocked) parts.push(`left ${fixPlan.blocked} that need you to sign in under Account → Connections`);
    if (parts.length) setNote(parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.');
    if (problems.length) setError(`${problems.length} couldn't be fixed: ${problems.join(' ')}`);
    if (started) {
      setTab('active');
      live.current = true;
    }
    await load();
  };

  if (locked) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          <Wand2 className="h-6 w-6 text-indigo-500" /> Code updates
        </h1>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 shrink-0" /> Not switched on for this device</p>
          <p className="mt-2">Code updates let the AI change the code on your PC, so a phone or tablet on Wi-Fi can't use them until you allow it. Two ways to use them here:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><b>On the PC:</b> open Devices, find this device under "Connected over Wi-Fi", and switch on <b>Code updates</b>. This page then works by itself.</li>
            <li><b>Or plug this device into the PC with USB</b> and open the hub from Devices → "Open the hub on it".</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Wand2 className="h-6 w-6 text-indigo-500" /> Code updates
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Ask the AI for a change. Nothing is applied until you press Apply.
          </p>
        </div>
        <button
          onClick={() => { if (window.confirm('Restart the hub now? It takes a few seconds, and this page reloads by itself.')) restartHub(); }}
          disabled={restarting}
          aria-label="Restart the hub"
          title="Restart the hub"
          className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RotateCw className={`h-5 w-5 ${restarting ? 'animate-spin' : ''}`} />
        </button>
      </div>


      {(restartPending || restarting) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{restarting ? 'Reconnecting…' : 'Restart needed'}</div>
            <div className="text-xs opacity-90">
              {restarting ? 'The hub is restarting. This page reloads by itself as soon as it answers.' : 'An update changed the server part of the hub, so it only takes effect after a restart. It takes a few seconds.'}
            </div>
          </div>
          <button onClick={restartHub} disabled={restarting} className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60">
            {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {restarting ? 'Reconnecting…' : 'Restart Eden now'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {note && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{note}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-900 dark:text-white">Updates</h2>
          <button onClick={checkAll} disabled={checking} title="Reload every update and look for easy fixes" className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking…' : 'Check for updates & fixes'}
          </button>
        </div>
        <div role="tablist" aria-label="Updates" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {TABS.map((t) => {
            const count = t.id === 'construction' ? -1 : jobs.filter((j) => TAB_OF[j.status] === t.id).length;
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${selected ? 'border-indigo-500 font-medium text-indigo-600 dark:text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {t.label}
                {count >= 0 && <span className={`rounded-full px-1.5 text-xs tabular-nums ${t.id === 'error' && count > 0 ? 'bg-red-500 text-white' : t.id === 'active' && jobs.some((j) => j.status === 'ready') ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{count}</span>}
              </button>
            );
          })}
        </div>
        {tab === 'active' && applyable.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <span className="min-w-0 flex-1">
              {applyable.length} updates are ready to apply.
              {skippedChecks > 0 && ` ${skippedChecks} with check issues need individual review.`}
            </span>
            <button
              onClick={() => setConfirmAll(true)}
              disabled={applyingAll || !!acting}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {applyingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {applyingAll ? 'Applying…' : 'Apply all'}
            </button>
          </div>
        )}
        {(tab === 'error' || (tab === 'active' && fixPlan.plan.some((p) => p.job.status === 'ready'))) && fixPlan.plan.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100">
            <Wrench className="h-5 w-5 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1">
              {fixPlan.run > 0 && <>{fixPlan.run} can run again{fixPlan.fixChecks > 0 && ` (${fixPlan.fixChecks} with what went wrong)`}. </>}
              {fixPlan.clear > 0 && <>{fixPlan.clear} {fixPlan.clear === 1 ? "isn't" : "aren't"} needed and can be cleared. </>}
              {fixPlan.waiting > 0 && <>{fixPlan.waiting} must wait for usage limits to reset. </>}
              {fixPlan.blocked > 0 && <>{fixPlan.blocked} need you to sign in first.</>}
            </span>
            <button
              onClick={() => setConfirmFixAll(true)}
              disabled={fixingAll || !!acting || fixPlan.run + fixPlan.clear === 0}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {fixingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />} {fixingAll ? 'Fixing…' : 'Fix all'}
            </button>
          </div>
        )}
        {tab === 'construction' && (
      <NextUpdate
        codebases={codebases}
        target={target}
        onPickTarget={setTarget}
        request={request}
        onRequestChange={setRequest}
        onThisPc={onThisPc}
        onOnThisPc={setOnThisPc}
        busy={busy}
        claudeReady={claudeReady}
        codexReady={codexReady}
        remote={remote}
        onStart={start}
        onAdded={async (id) => {
          setTarget(id);
          await load();
        }}
        onError={setError}
        onIdeaStarted={(id) => {
          setOpenId(id);
          setTab('active');
          live.current = true;
          load();
        }}
      />
        )}
        {tab === 'construction' && !remote && <RunnersPanel />}
        {tab !== 'construction' && !jobs.some((j) => TAB_OF[j.status] === tab) && <p className="text-sm text-slate-500 dark:text-slate-400">{TABS.find((t) => t.id === tab)?.empty}</p>}
        {jobs.filter((j) => TAB_OF[j.status] === tab).map((job) => {
          // Every card starts folded. Press its title to open it, and again to close it.
          const open = openId === job.id;
          const st = STATUS[job.status];
          // Time and progress for an update the AI is working on (the bar is an estimate from earlier updates).
          // A queued update has not started yet, so its clock counts the wait from when it was asked for.
          const runningNow = job.status === 'queued' || ((job.status === 'working' || job.status === 'checking') && !!job.startedAt);
          const since = job.status === 'queued' ? job.createdAt : job.startedAt;
          const elapsed = runningNow ? Math.max(0, clock - new Date(since!).getTime()) : 0;
          const percent = progressOf(job);
          const overdue = job.status !== 'queued' && elapsed > estimateMs;
          const fix = diagnose(job, jobs);
          const canApply = (job.status === 'ready' || job.status === 'undone') && job.hasDiff;
          const checkIssue = canApply ? updateCheckIssue(job.codebaseId || 'hub', job.check) : undefined;
          // Two or more updates waiting for review share one row in Active. Press it to see them one by one.
          const readyJobs = jobs.filter((j) => j.status === 'ready');
          const grouped = tab === 'active' && job.status === 'ready' && readyJobs.length > 1;
          const groupHead = grouped && readyJobs[0].id === job.id && (
            <button
              key={`ready-group-${job.id}`}
              onClick={() => setReadyOpen(!readyOpen)}
              aria-expanded={readyOpen}
              className="flex w-full items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left dark:border-amber-800 dark:bg-amber-950/30"
            >
              <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-amber-600 transition-transform dark:text-amber-400 ${readyOpen ? '' : '-rotate-90'}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900 dark:text-white">{readyJobs.length} updates ready for your review</span>
                <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">
                  {readyOpen ? 'Press to fold them back into one' : 'Press to look at them one by one'}
                </span>
                {!readyOpen && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                    {readyJobs.slice(0, 5).map((j) => (
                      <li key={j.id} className="truncate">· {j.request}</li>
                    ))}
                    {readyJobs.length > 5 && <li>· and {readyJobs.length - 5} more</li>}
                  </ul>
                )}
              </span>
            </button>
          );
          if (grouped && !readyOpen) return groupHead || null;
          return (
            <React.Fragment key={job.id}>
            {groupHead}
            <article className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <button
                onClick={() => setOpenId(open ? null : job.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-white">
                    {job.codebaseName && <span className="mr-2 rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">{job.codebaseName}</span>}
                    {job.request}
                  </span>
                  {job.unrealTools && <span className="block text-xs text-slate-500">Unreal tools: {unrealToolsLabel[job.unrealTools]}</span>}
                  <span className={`mt-0.5 flex items-center gap-1.5 text-xs ${st.tone}`}>
                    {(job.status === 'working' || job.status === 'checking') && <Loader2 className="h-3 w-3 animate-spin" />}
                    {st.label}
                    {job.files && <span className="text-slate-500"> · {job.files.length} file{job.files.length === 1 ? '' : 's'}</span>}
                    <span className="text-slate-500"> · {new Date(job.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  {runningNow && (
                    <span className="mt-2 block">
                      <span
                        role="progressbar"
                        aria-label="Estimated progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        className="block h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                      >
                        <span className={`block h-full rounded-full transition-all duration-1000 ${overdue ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${percent}%` }} />
                      </span>
                      <span className="mt-1 block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {job.status === 'queued' ? 'Waiting for' : 'Running for'} {duration(elapsed)} · usually about {Math.max(1, Math.round(estimateMs / 60000))} min
                        {overdue && ' · taking longer than usual'}
                      </span>
                    </span>
                  )}
                  {!runningNow && job.startedAt && job.finishedAt && (
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Took {duration(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime())}</span>
                  )}
                </span>
              </button>

              {open && (
                <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                  {typeof job.uncommitted === 'number' && job.uncommitted > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{unsavedNote(job.uncommitted)}.</p>}

                  {job.status === 'queued' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
                        Number {queue.indexOf(job.id) + 1} of {queue.length} in the queue. It starts by itself when the one before it finishes.
                      </p>
                      {queue.length > 1 && (
                        <div role="group" aria-label="Change its place in the queue" className="flex gap-1">
                          {queue.indexOf(job.id) > 1 && (
                            <button onClick={() => move(job, 'first')} disabled={!!acting} className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                              <ChevronsUp className="h-4 w-4" /> Run next
                            </button>
                          )}
                          {queue.indexOf(job.id) > 0 && (
                            <button onClick={() => move(job, 'up')} disabled={!!acting} aria-label="Run sooner" title="Run sooner" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                              <ArrowUp className="h-4 w-4" />
                            </button>
                          )}
                          {queue.indexOf(job.id) < queue.length - 1 && (
                            <button onClick={() => move(job, 'down')} disabled={!!acting} aria-label="Run later" title="Run later" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(job.status === 'working' || job.status === 'checking' || (job.status === 'failed' && job.interrupted)) && (
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-300">
                      {job.log.slice(-40).map((l, i) => (
                        <li key={i}>· {l}</li>
                      ))}
                    </ul>
                  )}

                  {job.error && <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>}

                  {fix && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm dark:border-indigo-800 dark:bg-indigo-950/40">
                      <Wrench className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="min-w-0 flex-1 text-indigo-950 dark:text-indigo-100">{fix.reason}</span>
                      <button
                        onClick={() => fixOne(job, fix)}
                        disabled={acting === job.id || fixingAll || !canFix(job, fix, claudeReady, codexReady)}
                        title={canFix(job, fix, claudeReady, codexReady) ? undefined : `Sign in to ${job.codex ? 'ChatGPT' : 'Claude'} in Account → Connections first`}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50 ${fix.action === 'wait' ? 'border border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-200 dark:hover:bg-indigo-900/50' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
                      >
                        {acting === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : fix.action === 'discard' ? <Trash2 className="h-4 w-4" /> : <Wrench className="h-4 w-4" />} {fix.label}
                      </button>
                    </div>
                  )}

                  {!job.stale && job.olderBase && (job.status === 'ready' || job.status === 'undone') && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {job.olderBaseSameFiles ? 'Another update changed the same files after this one was checked' : 'The code changed after this one was checked'}: "{jobs.find((j) => j.id === job.olderBase)?.request.slice(0, 80) || 'an earlier update'}". It still fits, but its checks ran on the older code{job.olderBaseSameFiles ? '' : ' (a change elsewhere, like a shared type, can still break it)'}. Press Try again to re-make it on the current code, or apply it if you're sure.
                    </p>
                  )}
                  {job.stale && (job.status === 'ready' || job.status === 'undone') && (
                    <p className="text-sm text-amber-700 dark:text-amber-300">The code has changed since this update was made, so it no longer fits. "Try again" redoes it on the current code.</p>
                  )}

                  {job.autoRetry && job.retryOf && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {job.status === 'failed'
                        ? 'Eden re-made this on the latest code by itself, and that did not work out either. Press Try again to run it once more.'
                        : job.status === 'queued' || job.status === 'working' || job.status === 'checking'
                          ? 'Eden is re-making this on the latest code by itself, because the earlier one no longer fit.'
                          : 'Eden re-made this on the latest code by itself, because the earlier one no longer fit.'}
                    </p>
                  )}

                  {job.summary && (
                    <div className="rounded-lg bg-slate-50 p-3 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
                      <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{job.status === 'answered' ? 'Answer' : 'What the AI says it did'}</div>
                      <Formatted text={job.summary} />
                    </div>
                  )}

                  {job.files && !job.hasDiff && job.status !== 'answered' && (
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

                  {checkIssue && job.check?.ok !== false && <p className="text-sm text-red-600 dark:text-red-400">{checkIssue}</p>}
                  {job.check && (!checkIssue || !job.check.ok) && (
                    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${job.check.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'}`}>
                      {job.check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        {job.check.ok ? 'Checks passed.' : 'Checks failed. Applying anyway requires confirmation on the owner PC.'}
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
                    {canApply && (!remote || !checkIssue) && (
                      <button
                        onClick={() => (remote || checkIssue ? setConfirmApply(job) : act(job, 'apply'))}
                        disabled={acting === job.id}
                        className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${checkIssue ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                      >
                        <Check className="h-4 w-4" /> {checkIssue ? 'Review override' : 'Apply to the app'}
                      </button>
                    )}
                    {job.status === 'applied' && job.hasDiff && (
                      <button onClick={() => setConfirmUndo(job)} disabled={acting === job.id} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <RotateCcw className="h-4 w-4" /> Undo
                      </button>
                    )}
                    {/* The fix box above already offers running it again, so "Try again" only shows when it doesn't. */}
                    {(job.status === 'failed' || job.status === 'discarded' || checkIssue || ((job.stale || job.olderBase) && (job.status === 'ready' || job.status === 'undone'))) && !(fix && fix.action !== 'discard') && (
                      <button
                        onClick={() => retry(job)}
                        disabled={acting === job.id || !(job.codex ? codexReady : claudeReady)}
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
            </React.Fragment>
          );
        })}
      </section>

      {confirmApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmApply(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirmApply(null)}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900"
          >
            <h2 id="apply-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Check className="h-5 w-5 text-emerald-500" /> {confirmOverride ? 'Override the update checks?' : 'Apply this to the app on your PC?'}
            </h2>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">“{confirmApply.request.length > 140 ? `${confirmApply.request.slice(0, 140)}…` : confirmApply.request}”</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {confirmApply.files?.length || 'The'} changed file{confirmApply.files?.length === 1 ? ' is' : 's are'} copied into the real code on the PC. A restore point is saved first, so Undo puts everything back.
              {confirmOverride && ' This update has no passing release check and may break the app.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirmApply(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Not yet
              </button>
              <button
                onClick={() => {
                  const job = confirmApply;
                  setConfirmApply(null);
                  act(job, 'apply', confirmOverride);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white ${confirmOverride ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              >
                <Check className="h-4 w-4" /> {confirmOverride ? 'Apply anyway' : 'Yes, apply it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmFixAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmFixAll(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fix-all-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirmFixAll(false)}
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900"
          >
            <h2 id="fix-all-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Wrench className="h-5 w-5 text-indigo-500" /> Fix all {fixPlan.plan.length} problem{fixPlan.plan.length === 1 ? '' : 's'}?
            </h2>
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
              {fixPlan.plan.map(({ job, fix, blocked }) => (
                <li key={job.id} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                  <span className="block text-slate-800 dark:text-slate-100">{job.request.length > 90 ? `${job.request.slice(0, 90)}…` : job.request}</span>
                  <span className={`block text-xs ${fix.action === 'wait' || blocked ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400'}`}>
                    {fix.action === 'wait' ? 'Left for now: out of Claude usage.' : blocked ? 'Left for now: sign in to Claude first.' : fix.action === 'discard' ? `Cleared: ${fix.reason}` : `${fix.label}.`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Updates that run again wait in the queue and go one at a time. Nothing is applied to your code until you press Apply.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirmFixAll(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Not yet
              </button>
              <button onClick={fixAll} disabled={fixPlan.run + fixPlan.clear === 0} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                <Wrench className="h-4 w-4" /> Yes, fix them
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmAll(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-all-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirmAll(false)}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900"
          >
            <h2 id="apply-all-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Check className="h-5 w-5 text-emerald-500" /> Apply all {applyable.length} updates?
            </h2>
            <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700 dark:text-slate-300">
              {applyable.map((j) => (
                <li key={j.id}>{j.request.length > 100 ? `${j.request.slice(0, 100)}…` : j.request}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              They are applied one after another, oldest first. Each one saves its own restore point first, so you can still Undo any of them. If one no longer fits, it is skipped and the others carry on.
              {skippedChecks > 0 && ` ${skippedChecks} with check issues need individual review.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirmAll(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Not yet
              </button>
              <button onClick={applyAll} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                <Check className="h-4 w-4" /> Yes, apply them all
              </button>
            </div>
          </div>
        </div>
      )}

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
