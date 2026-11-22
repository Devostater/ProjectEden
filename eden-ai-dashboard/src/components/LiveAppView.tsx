import React, { useEffect, useRef, useState } from 'react';
import { Pencil, RefreshCw, AppWindow } from 'lucide-react';
import type { Project } from '../types/index.ts';
import { addPick, setPickTarget, setTrayOpen, type Pick } from '../picker.ts';

// App tab: the project's running app inside EDEN (through EDEN's preview proxy, see previewProxy.ts), with a
// pencil that picks elements inside it. Picks join the same tray as EDEN's own picker, aimed at this project's code.
export const LiveAppView: React.FC<{ project: Project; onOpenSettings?: () => void }> = ({ project, onOpenSettings }) => {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [ready, setReady] = useState(false);
  const [n, setN] = useState(0); // reload counter
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setUrl(undefined);
    setError('');
    setReady(false);
    setPicking(false);
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(project.id)}/live`, { method: 'POST', signal: controller.signal }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!controller.signal.aborted) setUrl(d.url);
    }).catch((e) => {
      if (!controller.signal.aborted) setError(e.message || 'Could not open the preview.');
    });
    return () => controller.abort();
  }, [project.id, project.previewUrl, n]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== 'null' || !frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'eden-preview-ready') setReady(true);
      if (d.type === 'eden-pick-ended') setPicking(false);
      if (d.type === 'eden-pick' && picking && d.pick && typeof d.pick === 'object') {
        const pick = d.pick;
        const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
        const list = (value: unknown) => Array.isArray(value) ? value.slice(0, 6).map(item => text(item, 120)) : [];
        const details: Omit<Pick, 'id'> = {
          label: text(pick.label, 80), tag: text(pick.tag, 40), components: list(pick.components),
          where: [text(pick.where, 100), pick.page && ('page ' + text(pick.page, 300))].filter(Boolean).join(' / '),
          classes: text(pick.classes, 300), elId: text(pick.elId, 120), path: text(pick.path, 500),
          html: text(pick.html, 500), styles: text(pick.styles, 800), siblings: list(pick.siblings),
        };
        setPickTarget({ codebaseId: project.codebaseId || '', name: project.name });
        setTrayOpen(true);
        addPick(details);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [picking, project.codebaseId, project.name]);

  const togglePick = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.postMessage({ type: picking ? 'eden-pick-stop' : 'eden-pick-start' }, '*');
    setPicking(!picking);
  };

  if (url === null)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        <AppWindow className="h-8 w-8 text-indigo-400" />
        <p>Show this project's running app here and point at parts of it.<br />Add an owner-approved HTTPS address (for example <code>https://preview.example.com</code>) in Project settings → Live app address.</p>
        {onOpenSettings && <button onClick={onOpenSettings} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">Open project settings</button>}
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5 text-xs dark:border-slate-800">
        <span className="truncate text-slate-500" title={project.previewUrl}>{project.previewUrl}</span>
        <span className="ml-auto flex items-center gap-1">
          <button onClick={togglePick} disabled={!ready} aria-pressed={picking} title={ready ? (picking ? 'Stop picking (Esc)' : 'Pick parts of the app') : 'Waiting for the app to load'} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 disabled:opacity-40 ${picking ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
            <Pencil className="h-3.5 w-3.5" /> Pick
          </button>
          <button onClick={() => { setReady(false); setPicking(false); setN((x) => x + 1); }} title="Reload" aria-label="Reload the app" className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" /></button>
        </span>
      </div>
      {error && <p role="alert" className="p-3 text-sm text-red-600">{error}</p>}
      {url === undefined && !error && <p className="p-3 text-sm text-slate-500">Opening the app…</p>}
      {url && <iframe key={n} ref={frame} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${project.name} app`} className="min-h-0 flex-1 border-0 bg-white" />}
    </div>
  );
};
