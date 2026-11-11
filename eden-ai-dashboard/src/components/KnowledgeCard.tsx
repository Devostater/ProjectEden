import React, { useEffect, useState } from 'react';
import { BookOpen, Search, FolderPlus, X, RefreshCw } from 'lucide-react';
import { api } from '../api.ts';

interface Info {
  folders: string[];
  defaultFolder: string;
  builtAt?: string;
  pieces: number;
  files: number;
  cards: number;
  nexus: number;
  projects: number;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';

// Account → Connections: the local knowledge base teammates draw on (works offline, no AI model needed).
export const KnowledgeCard: React.FC = () => {
  const [info, setInfo] = useState<Info | null>(null);
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ source: string; text: string }[] | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Info>('GET', '/api/knowledge').then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const changeFolder = async (dir: string, remove = false) => {
    setNote(null);
    try {
      await api('POST', '/api/knowledge/folders', { folder: dir, remove });
      if (!remove) setFolder('');
      setNote({ ok: true, text: remove ? 'Folder removed.' : 'Folder added and read.' });
      load();
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    }
  };
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const d = await api<{ results: { source: string; text: string }[] }>('GET', `/api/knowledge/search?q=${encodeURIComponent(q)}`);
    setResults(d.results);
  };

  if (!info) return null;
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white"><BookOpen className="h-5 w-5 text-indigo-500" /> Knowledge base</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        What your studio already knows, searched on this PC with no internet. Teammates get the most relevant bits with every task and chat, so even small local AIs answer from your own material.
      </p>
      <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
          <span>{info.cards} cards</span>
          <span>{info.nexus} Nexus discussions and plans</span>
          <span>{info.projects} projects</span>
          <span>{info.files} files</span>
          <button onClick={() => api('POST', '/api/knowledge/rebuild').then(load)} aria-label="Read everything again" title="Read everything again" className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Folders it reads (text, Markdown, JSON, CSV, web pages)</div>
          <ul className="space-y-1">
            {info.folders.map((f) => (
              <li key={f} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-950/60">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={f}>{f}</span>
                {f === info.defaultFolder && <span className="text-xs text-slate-500">drop files here</span>}
                <button onClick={() => changeFolder(f, true)} aria-label={`Stop reading ${f}`} className="rounded p-1 text-slate-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Paste a folder path, e.g. D:\Games\Nova\docs" className={inputClass} aria-label="Folder to add" />
            <button onClick={() => folder.trim() && changeFolder(folder.trim())} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">
              <FolderPlus className="h-4 w-4" /> Add
            </button>
          </div>
          {note && <p role="status" className={`mt-1.5 text-sm ${note.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{note.text}</p>}
        </div>

        <form onSubmit={search}>
          <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Try it: what would a teammate find?</div>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. launch trailer, pricing, Nova pilot ship" className={inputClass} aria-label="Search the knowledge base" />
            <button type="submit" aria-label="Search" className="shrink-0 rounded-lg border border-slate-300 px-3 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Search className="h-4 w-4" /></button>
          </div>
          {results && (
            <ul className="mt-2 space-y-2">
              {!results.length && <li className="text-sm text-slate-500">Nothing matched.</li>}
              {results.map((r) => (
                <li key={r.source} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
                  <div className="font-medium text-slate-900 dark:text-white">{r.source}</div>
                  <div className="mt-0.5 line-clamp-3 text-slate-600 dark:text-slate-400">{r.text}</div>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>
    </div>
  );
};
