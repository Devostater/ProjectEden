// All projects: one card per project in C:\AZI (from AGENTS.md). Each project keeps its own folder and repo; this
// panel shows their state and starts their launchers. Reel gets its own actions: Reel Studio, Music Maker, a director
// step on a chosen project, and the finished videos. Server: hub.ts (/api/hub/*).
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Play, RefreshCw, Film, Lock, Github } from 'lucide-react';
import { api } from '../api.ts';
import { useFolded, FoldHeader } from './Foldable.tsx';

interface Progress { done: number; total: number; current?: { index: number; id?: string; text: string } }
interface HubCard {
  id: string; name: string; about: string; folder: string; exists: boolean; startHere: string; localOnly: boolean;
  git?: { github: boolean; branch?: string; changed?: number };
  progress?: Progress;
  runner?: { id: string; state: string };
  launchers: { id: string; label: string; url?: string; port?: number; running?: boolean }[];
  reel: boolean;
}
interface ReelState {
  projects: string[]; steps: string[];
  videos: { project: string; file: string; size: number; modified: string }[];
  step?: { project: string; step: string; state: string; startedAt: string; exitCode?: number | null; error?: string };
  log: string;
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200';
const mb = (n: number) => `${(n / 1048576).toFixed(n > 104857600 ? 0 : 1)} MB`;

const ReelActions: React.FC<{ onMessage: (m: string) => void }> = ({ onMessage }) => {
  const [reel, setReel] = useState<ReelState | null>(null);
  const [project, setProject] = useState('');
  const [step, setStep] = useState('status');
  const [playing, setPlaying] = useState<string | null>(null);
  const load = useCallback(() => api<ReelState>('POST', '/api/hub/reel').then((r) => {
    setReel(r);
    setProject((p) => p || r.projects[0] || '');
  }).catch((e) => onMessage(e.message)), [onMessage]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (reel?.step?.state !== 'Running') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [reel?.step?.state, load]);
  if (!reel) return null;
  const run = () => api('POST', '/api/hub/reel-step', { project, step }).then(load).catch((e) => onMessage(e.message));
  const running = reel.step?.state === 'Running';
  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">Run a step:</span>
        <select aria-label="Reel step" value={step} onChange={(e) => setStep(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
          {reel.steps.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span>on</span>
        <select aria-label="Reel project" value={project} onChange={(e) => setProject(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
          {reel.projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button onClick={run} disabled={running || !project} className={btn}><Play className="h-4 w-4" /> Run</button>
      </div>
      {reel.step && (
        <div className="text-sm">
          <div className={reel.step.state === 'Failed' ? 'text-rose-600' : reel.step.state === 'Done' ? 'text-emerald-600' : 'text-amber-600'}>
            {reel.step.step} on {reel.step.project}: {reel.step.state}{reel.step.error ? ` (${reel.step.error})` : ''}{reel.step.exitCode != null && reel.step.state === 'Failed' ? ` (exit ${reel.step.exitCode})` : ''}
          </div>
          {reel.log && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs dark:bg-slate-950">{reel.log}</pre>}
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><Film className="h-4 w-4" /> Finished videos ({reel.videos.length})</div>
        <ul className="max-h-48 space-y-1 overflow-auto text-sm">
          {reel.videos.map((v) => {
            const key = `${v.project}/${v.file}`;
            return (
              <li key={key} className="flex flex-wrap items-center gap-2">
                <button onClick={() => setPlaying(playing === key ? null : key)} className="text-indigo-600 hover:underline dark:text-indigo-400">{key}</button>
                <span className="text-xs text-slate-400">{mb(v.size)} · {new Date(v.modified).toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
        {playing && (
          <video key={playing} controls autoPlay className="mt-2 max-h-80 w-full rounded bg-black" src={`/api/hub/reel/video/${playing.split('/').map(encodeURIComponent).join('/')}`} />
        )}
      </div>
    </div>
  );
};

export const AllProjectsPanel: React.FC = () => {
  const [folded, toggle] = useFolded('eden_all_projects_folded');
  const [cards, setCards] = useState<HubCard[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api<{ projects: HubCard[] }>('POST', '/api/hub/status').then((r) => setCards(r.projects)).catch((e) => setMessage(e.message)), []);
  useEffect(() => { if (!folded) load(); }, [folded, load]);

  const launch = async (c: HubCard, l: HubCard['launchers'][number]) => {
    setBusy(`${c.id}/${l.id}`);
    setMessage('');
    try {
      const r = await api<{ already?: boolean; started?: boolean; waiting?: boolean; url?: string; log?: string }>('POST', '/api/hub/launch', { id: c.id, launcher: l.id });
      if (r.url && !r.waiting) window.open(r.url, '_blank', 'noopener');
      setMessage(r.already ? `${l.label}: already running.` : r.waiting ? `${l.label}: started, still loading. Log: ${r.log}` : `${l.label}: started.`);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const openFolder = (c: HubCard) => api('POST', '/api/hub/open-folder', { id: c.id }).catch((e) => setMessage(e.message));

  return (
    <section aria-label="All projects" className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <FoldHeader title="All projects" folded={folded} onToggle={toggle} foldedHint={cards ? `${cards.length} projects in C:\\AZI` : undefined} className="flex-1" />
        {!folded && <button onClick={load} aria-label="Refresh all projects" className="rounded p-1 text-slate-400 hover:text-indigo-600"><RefreshCw className="h-4 w-4" /></button>}
      </div>
      {!folded && (
        <>
          {message && <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">{message}</p>}
          <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
            {(cards ?? []).map((c) => (
              <article key={c.id} data-project={c.id} className={`rounded-lg border p-3 ${c.reel ? 'border-indigo-300 dark:border-indigo-700 [grid-column:1/-1]' : 'border-slate-200 dark:border-slate-800'}`}>
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 font-semibold text-slate-900 dark:text-white">{c.name}</h3>
                  {c.localOnly ? (
                    <span title="Stays on this PC" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Lock className="h-3 w-3" /> local only</span>
                  ) : c.git?.github ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Github className="h-3 w-3" /> GitHub</span>
                  ) : null}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{c.about}</p>
                {!c.exists ? (
                  <p className="mt-1 text-sm text-rose-600">Folder not found: {c.folder}</p>
                ) : (
                  <div className="mt-1 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {c.git && <div>{c.git.branch ? `Branch ${c.git.branch}` : 'Git repo'}{c.git.changed ? ` · ${c.git.changed} changed files` : c.git.changed === 0 ? ' · clean' : ''}</div>}
                    {c.runner && <div>Autopilot: {c.runner.state} <span className="text-slate-400">(start it in Code updates → Runners)</span></div>}
                    {c.progress && c.progress.total > 0 && (
                      <div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${Math.round((c.progress.done / c.progress.total) * 100)}%` }} />
                        </div>
                        <div className="mt-0.5">Tasks {c.progress.done}/{c.progress.total}{c.progress.current ? ` · next: ${c.progress.current.id ? c.progress.current.id + ' ' : ''}${c.progress.current.text}` : ' · all done'}</div>
                      </div>
                    )}
                    <div>Start here: {c.startHere}</div>
                  </div>
                )}
                {c.exists && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.launchers.map((l) => (
                      <button key={l.id} onClick={() => launch(c, l)} disabled={busy === `${c.id}/${l.id}`} className={btn}>
                        <Play className="h-4 w-4" /> {l.label}{l.running ? ' (running)' : ''}
                      </button>
                    ))}
                    <button onClick={() => openFolder(c)} className={btn}><FolderOpen className="h-4 w-4" /> Folder</button>
                  </div>
                )}
                {c.reel && c.exists && <ReelActions onMessage={setMessage} />}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
