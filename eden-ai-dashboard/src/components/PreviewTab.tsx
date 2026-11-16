// 🔍 Preview: look inside a project's folder without leaving Eden. A file list on the left; on the right the file
// itself, shown the way it reads best: Markdown formatted, images and video shown, JSON tidied, CSV as a table,
// code and text with line numbers. Also the latest output of the project's tools. Read-only (see toolbox.ts).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Folder, FileText, FileImage, FileCode2, ChevronRight, RefreshCw, Terminal as TerminalIcon, ArrowUp } from 'lucide-react';
import type { Project } from '../types/index.ts';
import { Formatted } from './ChatView.tsx';

interface Entry {
  name: string;
  dir: boolean;
  size: number;
  modified: string;
}
interface ToolRun {
  toolId: string;
  status: 'running' | 'ok' | 'failed';
  exitCode?: number | null;
  output: string;
  startedAt: string;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;
const VIDEO = /\.(mp4|webm)$/i;
const AUDIO = /\.(mp3|wav|ogg)$/i;
const PDF = /\.pdf$/i;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|json|html|css|yml|yaml|toml|xml|bat|ps1|sh|gradle|java|swift|rs|go|sql|ini|cfg)$/i;
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const iconFor = (e: Entry) => (e.dir ? Folder : IMAGE.test(e.name) ? FileImage : CODE.test(e.name) ? FileCode2 : FileText);

// A small CSV/TSV reader: handles quoted cells with commas and doubled quotes.
function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const Viewer: React.FC<{ projectId: string; path: string; size: number }> = ({ projectId, path, size }) => {
  const url = `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`;
  const [data, setData] = useState<{ kind: string; content?: string; truncated?: boolean; error?: string } | null>(null);
  const [raw, setRaw] = useState(false);
  const media = IMAGE.test(path) || VIDEO.test(path) || AUDIO.test(path) || PDF.test(path);
  useEffect(() => {
    setRaw(false);
    if (media) return setData({ kind: 'media' });
    setData(null);
    let alive = true;
    fetch(url)
      .then(async (r) => {
        const d = await r.json().catch(() => ({ error: `The hub answered ${r.status}.` }));
        if (alive) setData(r.ok ? d : { kind: 'error', error: d.error });
      })
      .catch(() => alive && setData({ kind: 'error', error: 'The hub did not answer.' }));
    return () => {
      alive = false;
    };
  }, [url, media]);

  if (!data) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (data.kind === 'error') return <p className="p-4 text-sm text-red-600 dark:text-red-400">{data.error}</p>;
  if (IMAGE.test(path))
    return (
      <div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4">
        <img src={url} alt={path} className="max-h-full max-w-full object-contain" />
      </div>
    );
  if (VIDEO.test(path)) return <video src={url} controls className="h-full w-full bg-black object-contain" />;
  if (AUDIO.test(path)) return <div className="p-6"><audio src={url} controls className="w-full" /></div>;
  if (PDF.test(path)) return <iframe src={url} title={path} sandbox="" className="h-full w-full border-0 bg-white" />;
  if (data.kind === 'binary') return <p className="p-4 text-sm text-slate-500">This file isn't text ({kb(size)}), so it can't be previewed here.</p>;

  const text = (data.content || '').replace(/\r\n?/g, '\n'); // Windows line endings would hide Markdown headings
  const note = data.truncated ? <p className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">Showing the first 512 KB of {kb(size)}.</p> : null;
  const isMd = /\.(md|markdown)$/i.test(path);
  const isCsv = /\.(csv|tsv)$/i.test(path);
  const isJson = /\.json$/i.test(path);

  let pretty: React.ReactNode = null;
  if (!raw && isMd) pretty = <div className="p-4"><Formatted text={text} /></div>;
  if (!raw && isCsv) {
    const rows = parseDelimited(text, /\.tsv$/i.test(path) ? '\t' : ',').slice(0, 1000);
    pretty = (
      <div className="overflow-auto p-2">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
            <tr>{(rows[0] || []).map((h, i) => <th key={i} className="border border-slate-200 px-2 py-1 text-left font-semibold dark:border-slate-700">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, i) => (
              <tr key={i} className="odd:bg-slate-50 dark:odd:bg-slate-900/60">{r.map((c, j) => <td key={j} className="border border-slate-200 px-2 py-1 align-top dark:border-slate-800">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-slate-500">{rows.length - 1} rows{rows.length >= 1000 ? ' (first 1000 shown)' : ''}</p>
      </div>
    );
  }
  let shown = text;
  if (!raw && isJson) {
    try {
      shown = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* not valid JSON: shown as it is */
    }
  }
  const lines = shown.split('\n');
  return (
    <div className="flex h-full flex-col">
      {note}
      {(isMd || isCsv || isJson) && (
        <div className="flex shrink-0 justify-end gap-1 border-b border-slate-200 px-2 py-1 dark:border-slate-800">
          <button onClick={() => setRaw(false)} aria-pressed={!raw} className={`rounded px-2 py-0.5 text-xs ${!raw ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Formatted</button>
          <button onClick={() => setRaw(true)} aria-pressed={raw} className={`rounded px-2 py-0.5 text-xs ${raw ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Raw</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {pretty || (
          <pre className="text-xs leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className="flex">
                <span className="w-12 shrink-0 select-none pr-3 text-right text-slate-400">{i + 1}</span>
                <span className="whitespace-pre-wrap break-all pr-3 text-slate-800 dark:text-slate-200">{l || ' '}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
};

export const PreviewTab: React.FC<{ project: Project }> = ({ project }) => {
  const [dir, setDir] = useState('');
  const [root, setRoot] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ path: string; size: number } | 'tools' | null>(null);
  const [runs, setRuns] = useState<ToolRun[]>([]);
  const [filter, setFilter] = useState('');
  const tools = project.toolbox?.tools || [];

  const load = useCallback(
    async (d: string) => {
      setError('');
      try {
        const r = await fetch(`/api/projects/${project.id}/files?dir=${encodeURIComponent(d)}`);
        const j = await r.json();
        if (!r.ok) return setError(j.error || 'Could not open the folder.');
        setRoot(j.root);
        setDir(j.dir);
        setEntries(j.entries);
        setFilter('');
      } catch {
        setError('The hub did not answer.');
      }
    },
    [project.id],
  );
  useEffect(() => {
    load('');
    setSelected(null);
  }, [load]);
  // The project's tool runs (for the "Tool output" view).
  useEffect(() => {
    if (!tools.length) return setRuns([]);
    let alive = true;
    const get = async () => {
      const all: ToolRun[] = [];
      for (const t of tools) {
        try {
          const d = await (await fetch(`/api/projects/${project.id}/tools/${t.id}/run`)).json();
          if (d.run) all.push(d.run);
        } catch {}
      }
      if (alive) setRuns(all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    };
    get();
    const timer = setInterval(get, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id, tools.length]);

  const crumbs = dir ? dir.split('/') : [];
  const shown = useMemo(() => entries.filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase())), [entries, filter]);
  const join = (name: string) => (dir ? `${dir}/${name}` : name);

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* Files */}
      <div className="flex max-h-[40%] w-full shrink-0 flex-col border-b border-slate-200 sm:max-h-none sm:w-72 sm:border-b-0 sm:border-r dark:border-slate-800">
        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 text-xs dark:border-slate-800">
          <button onClick={() => load('')} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400" title={root}>
            {root.split(/[\\/]/).pop() || project.name}
          </button>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
              <button onClick={() => load(crumbs.slice(0, i + 1).join('/'))} className="truncate hover:underline">{c}</button>
            </React.Fragment>
          ))}
          <button onClick={() => load(dir)} aria-label="Refresh" title="Refresh" className="ml-auto rounded p-1 text-slate-400 hover:text-slate-700">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder…" className="mx-2 my-1.5 rounded-md border border-slate-200 bg-transparent px-2 py-1 text-xs dark:border-slate-700" />
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {tools.length > 0 && (
            <button onClick={() => setSelected('tools')} className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${selected === 'tools' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
              <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> Tool output
              {runs.some((r) => r.status === 'running') && <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
            </button>
          )}
          {dir && (
            <button onClick={() => load(crumbs.slice(0, -1).join('/'))} className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <ArrowUp className="h-3.5 w-3.5" /> ..
            </button>
          )}
          {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {shown.map((e) => {
            const Icon = iconFor(e);
            const path = join(e.name);
            const active = typeof selected === 'object' && selected?.path === path;
            return (
              <button
                key={e.name}
                onClick={() => (e.dir ? load(path) : setSelected({ path, size: e.size }))}
                title={`${e.name}${e.dir ? '' : ` · ${kb(e.size)}`}${e.modified ? ` · ${new Date(e.modified).toLocaleString()}` : ''}`}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'}`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${e.dir ? 'text-amber-500' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {!e.dir && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{kb(e.size)}</span>}
              </button>
            );
          })}
          {!error && !shown.length && <p className="px-3 py-2 text-xs text-slate-500">Nothing here.</p>}
        </div>
      </div>

      {/* Preview */}
      <div className="min-w-0 flex-1">
        {selected === 'tools' ? (
          <div className="h-full overflow-y-auto p-3">
            {!runs.length && <p className="text-sm text-slate-500">No tool has run yet. Run one from the Toolbox tab.</p>}
            {runs.map((r) => (
              <div key={r.toolId} className="mb-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-sm dark:border-slate-800">
                  <b>{tools.find((t) => t.id === r.toolId)?.name || r.toolId}</b>
                  <span className="text-xs text-slate-500">{r.status === 'running' ? 'running…' : r.status === 'ok' ? '✅ finished' : `❌ failed (exit ${r.exitCode})`} · {new Date(r.startedAt).toLocaleTimeString()}</span>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-slate-700 dark:text-slate-300">{r.output || (r.status === 'running' ? '(no output yet)' : '(it printed nothing)')}</pre>
              </div>
            ))}
          </div>
        ) : selected ? (
          <div className="flex h-full flex-col">
            <div className="shrink-0 truncate border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800" title={selected.path}>
              {selected.path} · {kb(selected.size)}
            </div>
            <div className="min-h-0 flex-1">
              <Viewer projectId={project.id} path={selected.path} size={selected.size} />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-slate-500">
            <p>Pick a file to preview it here: Markdown, images, video, JSON, CSV tables, code.</p>
            <p className="text-xs">Use “Large screen” for a full-window view. Secret files (.env, keys) are never shown.</p>
          </div>
        )}
      </div>
    </div>
  );
};
