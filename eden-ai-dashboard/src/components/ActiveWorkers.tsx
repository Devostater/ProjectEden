// Top bar: Pause AI / Resume, always one tap away (also on phones), with how many are working. Tapping the count
// opens "Active workers": every AI working right now (cards, code updates, Nexus discussions, LYRA), each with a
// button to open it. Built from data the hub already has; refreshed every few seconds while open.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, X, Users, Loader2 } from 'lucide-react';
import type { Agent, Card, Project } from '../types/index.ts';

interface Room {
  id: string;
  name: string;
  running: boolean;
}
interface Job {
  id: string;
  status: string;
  request: string;
  createdAt: string;
  codebaseName?: string;
}
interface LyraTask {
  id: string;
  label: string;
  status: string;
  step?: string;
  pct?: number;
}

const since = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return isNaN(m) ? '' : m < 1 ? 'just started' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function usePause() {
  const [state, setState] = useState<{ paused: boolean; running: { cards: number; rooms: number } } | null>(null);
  const load = () =>
    fetch('/api/ai/pause')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 4000);
    return () => clearInterval(t);
  }, []);
  const toggle = async () => {
    if (!state) return;
    const d = await fetch('/api/ai/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !state.paused }) })
      .then((r) => r.json())
      .catch(() => null);
    if (d) setState(d);
  };
  return { state, toggle };
}

// The top-bar button pair: [Pause AI | Resume] and [N working]. Both big enough to hit easily.
export const PauseAndWorkers: React.FC<{ onOpenWorkers: () => void; workingNow: number }> = ({ onOpenWorkers, workingNow }) => {
  const { state, toggle } = usePause();
  if (!state) return null;
  const paused = state.paused;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={toggle}
        title={paused ? 'Let the team work on cards and discussions again' : 'Stop Nexus discussions and card work until you resume. Chat still works.'}
        className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
          paused ? 'border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-500' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100'
        }`}
      >
        {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        <span className="hidden sm:inline">{paused ? 'Resume AI' : 'Pause AI'}</span>
      </button>
      <button onClick={onOpenWorkers} title="See every AI working right now" className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">
        {workingNow > 0 ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> : <Users className="h-4 w-4" />}
        <span className="tabular-nums">{workingNow}</span>
        <span className="hidden md:inline">working</span>
      </button>
    </div>
  );
};

export const ActiveWorkers: React.FC<{
  open: boolean;
  onClose: () => void;
  cards: Card[];
  projects: Project[];
  agents: Agent[];
  rooms: Room[];
  onOpenCard: (card: Card) => void;
  onOpenRoom: (id: string) => void;
  onOpenUpdates: () => void;
  onOpenLyra: () => void;
}> = ({ open, onClose, cards, projects, agents, rooms, onOpenCard, onOpenRoom, onOpenUpdates, onOpenLyra }) => {
  const { state, toggle } = usePause();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lyra, setLyra] = useState<LyraTask[]>([]);
  useEffect(() => {
    if (!open) return;
    const load = () => {
      fetch('/api/updates')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setJobs((d.jobs || []).filter((j: Job) => ['working', 'checking', 'queued'].includes(j.status))))
        .catch(() => {});
      fetch('/api/lyra/overview')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setLyra((d.tasks || []).filter((t: LyraTask) => !['done', 'failed', 'cancelled', 'stopped'].includes(t.status))))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;

  const running = cards.filter((c) => c.runState === 'running');
  const talking = rooms.filter((r) => r.running);
  const total = running.length + talking.length + jobs.length + lyra.length;
  const row = 'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-slate-200 px-4 py-2 text-left hover:border-indigo-400 dark:border-slate-700';
  const H = ({ children, n }: { children: React.ReactNode; n: number }) => (
    <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
      {children} <span className="rounded-full bg-slate-200 px-2 text-xs tabular-nums text-slate-800 dark:bg-slate-700 dark:text-slate-100">{n}</span>
    </h3>
  );
  const open1 = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-stretch justify-center bg-black/50 md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Active workers"
        onClick={(e) => e.stopPropagation()}
        className="eden-read flex w-full max-w-3xl flex-col overflow-hidden bg-white md:max-h-[90dvh] md:rounded-2xl md:border md:border-slate-300 dark:bg-slate-900 md:dark:border-slate-700"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <h2 className="mr-auto text-xl font-bold text-slate-900 dark:text-white">Active workers {total > 0 && <span className="tabular-nums text-slate-500">({total})</span>}</h2>
          {state && (
            <button onClick={toggle} className={`flex min-h-11 items-center gap-2 rounded-lg px-4 text-base font-semibold ${state.paused ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-amber-500 text-slate-950 hover:bg-amber-400'}`}>
              {state.paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />} {state.paused ? 'Resume AI' : 'Pause AI'}
            </button>
          )}
          <button onClick={onClose} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" /> Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {state?.paused && <p className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">AI is paused: nothing new starts until you press Resume. Chat still works.</p>}
          {total === 0 && <p className="mt-6 text-base text-slate-700 dark:text-slate-200">Nobody is working right now.</p>}

          {running.length > 0 && <H n={running.length}>Cards being worked on</H>}
          <div className="grid gap-2">
            {running.map((c) => {
              const who = agents.find((a) => a.id === c.assigneeId);
              const proj = projects.find((p) => p.id === c.projectId);
              return (
                <button key={c.id} onClick={open1(() => onOpenCard(c))} className={row}>
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-slate-900 dark:text-white">{c.title}</span>
                    <span className="block text-sm text-slate-600 dark:text-slate-300">
                      {who?.name || 'A teammate'} · {proj?.name || 'a project'}
                      {c.runStartedAt ? ` · ${since(c.runStartedAt)}` : ''}
                      {c.runMessage ? ` · ${c.runMessage}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-indigo-700 dark:text-indigo-300">Open</span>
                </button>
              );
            })}
          </div>

          {jobs.length > 0 && <H n={jobs.length}>Code updates</H>}
          <div className="grid gap-2">
            {jobs.map((j) => (
              <button key={j.id} onClick={open1(onOpenUpdates)} className={row}>
                {j.status === 'queued' ? <span className="h-5 w-5 shrink-0 text-center text-slate-500">⏳</span> : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-slate-900 dark:text-white">{j.request.length > 140 ? `${j.request.slice(0, 140)}…` : j.request}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">
                    {j.status === 'queued' ? 'Waiting its turn' : j.status === 'checking' ? 'Checking the change' : 'Making the change'} · {j.codebaseName || 'code'} · {since(j.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-indigo-700 dark:text-indigo-300">Open</span>
              </button>
            ))}
          </div>

          {talking.length > 0 && <H n={talking.length}>Nexus discussions</H>}
          <div className="grid gap-2">
            {talking.map((r) => (
              <button key={r.id} onClick={open1(() => onOpenRoom(r.id))} className={row}>
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-500" />
                <span className="min-w-0 flex-1 break-words font-semibold text-slate-900 dark:text-white">{r.name}</span>
                <span className="shrink-0 text-sm font-medium text-indigo-700 dark:text-indigo-300">Open</span>
              </button>
            ))}
          </div>

          {lyra.length > 0 && <H n={lyra.length}>LYRA</H>}
          <div className="grid gap-2">
            {lyra.map((t) => (
              <button key={t.id} onClick={open1(onOpenLyra)} className={row}>
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-fuchsia-500" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-slate-900 dark:text-white">{t.label}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">
                    {t.status}
                    {t.pct ? ` · ${t.pct}%` : ''}
                    {t.step ? ` · ${t.step}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-indigo-700 dark:text-indigo-300">Open</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
