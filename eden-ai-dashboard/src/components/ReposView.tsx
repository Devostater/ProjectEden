import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Sections } from './Sections.tsx';
import { FolderGit2, RefreshCw, ArrowDown, ArrowUp, Loader2, Save, ExternalLink, Link2, Download, CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';

interface Repo {
  name: string;
  dir: string;
  remote: string;
  web: string;
  branch: string;
  upstream: boolean;
  ahead: number;
  behind: number;
  changes: { status: string; file: string }[];
  changeCount: number;
  lastCommit: { hash: string; subject: string; when: string } | null;
  auto: boolean;
  lastSync?: string;
  error?: string;
}

const ago = (iso?: string) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const btn = 'flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

function RepoCard({ repo, onChange }: { repo: Repo; onChange: (r: Repo) => void }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(repo.error ? { ok: false, text: repo.error } : null);
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [open, setOpen] = useState(false);

  const act = async (action: string, body?: unknown) => {
    setBusy(action);
    setMsg(null);
    try {
      const r = await api<{ message: string; repo: Repo }>('POST', `/api/repos/${encodeURIComponent(repo.name)}/${action}`, body ?? {});
      onChange(r.repo);
      setMsg({ ok: true, text: r.message });
      if (action === 'commit') setNote('');
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  const state = !repo.remote
    ? { text: 'Not linked to GitHub', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
    : repo.ahead && repo.behind
      ? { text: `${repo.behind} to bring down, ${repo.ahead} to send`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' }
      : repo.behind
        ? { text: `${repo.behind} new on GitHub`, cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' }
        : repo.ahead
          ? { text: `${repo.ahead} not sent yet`, cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' }
          : !repo.upstream
            ? { text: 'Branch not on GitHub yet', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' }
            : { text: 'In step with GitHub', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{repo.name}</h2>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{repo.branch}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${state.cls}`}>{state.text}</span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={repo.dir}>
            {repo.dir}
            {repo.lastCommit && <> · last saved: “{repo.lastCommit.subject}” {ago(repo.lastCommit.when)}</>}
          </p>
        </div>
        {repo.web && (
          <a href={repo.web} target="_blank" rel="noreferrer" className={btn}>
            <ExternalLink className="h-4 w-4" /> GitHub
          </a>
        )}
      </div>

      {repo.remote ? (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => act('sync')} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync
          </button>
          <button onClick={() => act('pull')} disabled={!!busy} className={btn} title="Bring GitHub's changes down">
            {busy === 'pull' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />} Pull
          </button>
          <button onClick={() => act('push')} disabled={!!busy} className={btn} title="Send this PC's saved changes up">
            {busy === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />} Push
          </button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200" title="Every 10 minutes: bring GitHub's changes down and send saved ones up. Never saves your work for you.">
            <input type="checkbox" checked={repo.auto} disabled={!!busy} onChange={(e) => act('auto', { on: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
            Auto-sync
            {repo.lastSync && <span className="text-xs text-slate-500">· {ago(repo.lastSync)}</span>}
          </label>
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act('link', { repo: link });
          }}
        >
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="owner/name or GitHub link" aria-label={`GitHub repo for ${repo.name}`} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
          <button type="submit" disabled={!!busy || !link.trim()} className={btn}>
            {busy === 'link' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Link to GitHub
          </button>
        </form>
      )}

      {repo.changeCount > 0 && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm font-medium text-slate-700 dark:text-slate-200" aria-expanded={open}>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
            {repo.changeCount} unsaved change{repo.changeCount === 1 ? '' : 's'}
          </button>
          {open && (
            <ul className="max-h-48 overflow-auto font-mono text-xs text-slate-600 dark:text-slate-300">
              {repo.changes.map((c) => (
                <li key={c.file} className="truncate">
                  <span className="inline-block w-6 text-slate-400">{c.status}</span>
                  {c.file}
                </li>
              ))}
              {repo.changeCount > repo.changes.length && <li className="text-slate-400">…and {repo.changeCount - repo.changes.length} more</li>}
            </ul>
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act('commit', { message: note });
            }}
          >
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (e.g. Tablet AI and chat sync)" aria-label={`What changed in ${repo.name}`} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <button type="submit" disabled={!!busy || !note.trim()} className={btn}>
              {busy === 'commit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
          </form>
        </div>
      )}

      {msg && (
        <p role="status" className={`flex items-start gap-1.5 text-sm ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
          {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function ReposView() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [clone, setClone] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneMsg, setCloneMsg] = useState('');

  const load = async (fetchFirst: boolean) => {
    setLoading(true);
    setError('');
    try {
      const r = await api<{ root: string; repos: Repo[] }>('GET', `/api/repos${fetchFirst ? '?fetch=1' : ''}`);
      setRepos(r.repos);
      setRoot(r.root);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load(false).then(() => load(true)); // show what's here at once, then check GitHub
  }, []);

  const doClone = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloning(true);
    setCloneMsg('');
    try {
      const r = await api<{ repo: Repo }>('POST', '/api/repos/clone', { repo: clone });
      setRepos((rs) => [...(rs || []), r.repo]);
      setClone('');
    } catch (err: any) {
      setCloneMsg(err.message);
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <FolderGit2 className="h-6 w-6 text-indigo-500" /> GitHub
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Your projects in {root || 'your workspace'}, kept in step with GitHub. Sync brings GitHub's changes down and sends this PC's saved changes up.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading} aria-label="Check GitHub again" title="Check GitHub again" className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{error}</p>}
      {!repos && !error && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for your repos…
        </p>
      )}
      {repos && !repos.length && <p className="text-sm text-slate-500">No git projects found in {root}.</p>}
      <Sections
        storageKey="github"
        items={[
          ...(repos || []).map((r) => ({
            id: `repo:${r.name}`,
            title: r.name,
            body: <RepoCard repo={r} onChange={(n) => setRepos((rs) => rs!.map((x) => (x.name === n.name ? n : x)))} />,
          })),
          {
            id: 'clone',
            title: 'Bring a GitHub repo onto this PC',
            body: (
              <form onSubmit={doClone} className="space-y-2 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                <label htmlFor="clone-repo" className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Download className="h-4 w-4" /> Bring a GitHub repo onto this PC
                </label>
                <div className="flex flex-wrap gap-2">
                  <input id="clone-repo" value={clone} onChange={(e) => setClone(e.target.value)} placeholder="owner/name or GitHub link" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                  <button type="submit" disabled={cloning || !clone.trim()} className={btn}>
                    {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Clone
                  </button>
                </div>
                {cloneMsg && <p className="text-sm text-amber-700 dark:text-amber-300">{cloneMsg}</p>}
              </form>
            ),
          },
        ]}
      />
    </div>
  );
}
