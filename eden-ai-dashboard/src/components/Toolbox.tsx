// 🧰 A project's own toolbox: tools (scripts/commands that run in its folder), connections (keys such as Azure AI
// that only this project uses, kept in C:\AZI\Security\Keys\<project>) and links. See toolbox.ts.
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Play, Plus, X, Wrench, KeyRound, Link2, Loader2 } from 'lucide-react';
import type { Project, ProjectTool, ProjectLink } from '../types/index.ts';

interface ToolRun {
  id: string;
  toolId: string;
  status: 'running' | 'ok' | 'failed';
  exitCode?: number | null;
  output: string;
  startedAt: string;
  finishedAt?: string;
}
interface ToolboxData {
  folder: string;
  keysFile: string;
  keys: { name: string; set: boolean }[];
  tools: ProjectTool[];
  links: ProjectLink[];
  presets: { id: string; label: string; keys: string[] }[];
  runs: ToolRun[];
}

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const input = 'w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700';
const small = 'rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900';

export const Toolbox: React.FC<{ project: Project }> = ({ project }) => {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`eden-toolbox-open-${project.id}`) === '1';
    } catch {
      return false;
    }
  });
  const [data, setData] = useState<ToolboxData | null>(null);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Record<string, ToolRun>>({});
  const [showRun, setShowRun] = useState<string | null>(null);
  const [addTool, setAddTool] = useState(false);
  const [tool, setTool] = useState({ name: '', command: '', folder: '', description: '' });
  const [keyForm, setKeyForm] = useState<{ name: string; value: string } | null>(null);
  const [link, setLink] = useState({ title: '', url: '' });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${project.id}/toolbox`);
      const d = await r.json();
      if (!r.ok) return setError(d.error || 'Could not load the toolbox.');
      setData(d);
      setRuns((cur) => {
        const next = { ...cur };
        for (const run of d.runs || []) next[run.toolId] = run;
        return next;
      });
    } catch {
      setError('The hub did not answer.');
    }
  }, [project.id]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  // While something runs, follow its output.
  useEffect(() => {
    const running = Object.values(runs).filter((r) => r.status === 'running');
    if (!running.length) return;
    const t = setInterval(async () => {
      for (const r of running) {
        try {
          const d = await (await fetch(`/api/projects/${project.id}/tools/${r.toolId}/run`)).json();
          if (d.run) setRuns((cur) => ({ ...cur, [r.toolId]: d.run }));
        } catch {}
      }
    }, 1500);
    return () => clearInterval(t);
  }, [runs, project.id]);

  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(`eden-toolbox-open-${project.id}`, v ? '0' : '1');
      } catch {}
      return !v;
    });

  const saveBox = async (tools: ProjectTool[], links: ProjectLink[]) => {
    setError('');
    const r = await fetch(`/api/projects/${project.id}/toolbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tools, links }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || 'Could not save.');
    await load();
  };
  const run = async (t: ProjectTool) => {
    setError('');
    const r = await fetch(`/api/projects/${project.id}/tools/${t.id}/run`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || 'Could not run it.');
    setRuns((cur) => ({ ...cur, [t.id]: d.run }));
    setShowRun(t.id);
  };
  const saveKey = async (name: string, value: string | null) => {
    setError('');
    const r = await fetch(`/api/projects/${project.id}/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || 'Could not save the key.');
    await load();
  };

  const counts = data ? `${data.tools.length} tools · ${data.keys.length} keys · ${data.links.length} links` : '';
  const shown = showRun ? runs[showRun] : null;

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/60">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Wrench className="h-4 w-4 text-sky-500" />
        <span className="font-semibold text-slate-900 dark:text-white">Toolbox</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{open ? counts : 'Tools, keys and links for this project only'}</span>
        <ChevronDown className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-800">
          {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {!data ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                {data.folder ? <>Tools run in <code>{data.folder}</code> with this project's keys only (Eden's own keys are left out).</> : <>This project has no folder in C:\AZI yet, so its tools can't run.</>}
              </p>
              <div className="grid gap-3 lg:grid-cols-3">
                {/* Tools */}
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                    <Wrench className="h-3.5 w-3.5" /> Tools
                  </h4>
                  <ul className="space-y-1.5">
                    {data.tools.map((t) => {
                      const r = runs[t.id];
                      return (
                        <li key={t.id} className="group flex items-center gap-2">
                          <button onClick={() => run(t)} disabled={r?.status === 'running' || !data.folder} title={`Run: ${t.command}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-left text-sm hover:border-indigo-400 disabled:opacity-60 dark:border-slate-700">
                            {r?.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            {r && r.status !== 'running' && <span aria-label={r.status === 'ok' ? 'last run ok' : 'last run failed'}>{r.status === 'ok' ? '✅' : '❌'}</span>}
                          </button>
                          {r && (
                            <button onClick={() => setShowRun(showRun === t.id ? null : t.id)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                              Output
                            </button>
                          )}
                          <button onClick={() => saveBox(data.tools.filter((x) => x.id !== t.id), data.links)} aria-label={`Remove ${t.name}`} className="rounded p-0.5 text-slate-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                    {!data.tools.length && <li className="text-xs text-slate-500">No tools yet. Add a build, test, deploy or any script.</li>}
                  </ul>
                  {addTool ? (
                    <form
                      className="mt-2 space-y-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!tool.name.trim() || !tool.command.trim()) return;
                        saveBox([...data.tools, { id: newId('tool'), name: tool.name.trim(), command: tool.command.trim(), ...(tool.folder.trim() ? { folder: tool.folder.trim() } : {}), ...(tool.description.trim() ? { description: tool.description.trim() } : {}) }], data.links);
                        setTool({ name: '', command: '', folder: '', description: '' });
                        setAddTool(false);
                      }}
                    >
                      <input autoFocus value={tool.name} onChange={(e) => setTool({ ...tool, name: e.target.value })} placeholder="Name, e.g. Build" className={input} />
                      <input value={tool.command} onChange={(e) => setTool({ ...tool, command: e.target.value })} placeholder="Command, e.g. npm run build" className={`${input} font-mono`} />
                      <input value={tool.folder} onChange={(e) => setTool({ ...tool, folder: e.target.value })} placeholder="Subfolder (optional), e.g. eden-ai-dashboard" className={input} />
                      <div className="flex gap-2">
                        <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">Add tool</button>
                        <button type="button" onClick={() => setAddTool(false)} className={small}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button onClick={() => setAddTool(true)} className="mt-2 flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                      <Plus className="h-3.5 w-3.5" /> Add a tool
                    </button>
                  )}
                </div>

                {/* Connections / keys */}
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                    <KeyRound className="h-3.5 w-3.5" /> Connections
                  </h4>
                  <ul className="space-y-1">
                    {data.keys.map((k) => (
                      <li key={k.name} className="group flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${k.set ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <code className="min-w-0 flex-1 truncate text-xs">{k.name}</code>
                        <span className="text-xs text-slate-500">{k.set ? 'set' : 'empty'}</span>
                        <button onClick={() => setKeyForm({ name: k.name, value: '' })} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                          {k.set ? 'Change' : 'Set'}
                        </button>
                        <button onClick={() => saveKey(k.name, null)} aria-label={`Remove ${k.name}`} className="rounded p-0.5 text-slate-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                    {!data.keys.length && <li className="text-xs text-slate-500">No keys. Add one, or pick a service below.</li>}
                  </ul>
                  {keyForm ? (
                    <form
                      className="mt-2 space-y-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!keyForm.name.trim()) return;
                        saveKey(keyForm.name.trim(), keyForm.value);
                        setKeyForm(null);
                      }}
                    >
                      <input value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value.toUpperCase() })} placeholder="NAME, e.g. AZURE_OPENAI_API_KEY" className={`${input} font-mono`} />
                      <input type="password" autoComplete="off" autoFocus={!!keyForm.name} value={keyForm.value} onChange={(e) => setKeyForm({ ...keyForm, value: e.target.value })} placeholder="Value (saved to Security\Keys, never shown again)" className={input} />
                      <div className="flex gap-2">
                        <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500">Save key</button>
                        <button type="button" onClick={() => setKeyForm(null)} className={small}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button onClick={() => setKeyForm({ name: '', value: '' })} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                        <Plus className="h-3.5 w-3.5" /> Add a key
                      </button>
                      <select
                        value=""
                        onChange={async (e) => {
                          const preset = data.presets.find((x) => x.id === e.target.value);
                          if (!preset) return;
                          for (const name of preset.keys) if (!data.keys.some((k) => k.name === name)) await saveKey(name, '');
                        }}
                        className="rounded-lg border border-slate-300 bg-transparent px-1.5 py-1 text-xs dark:border-slate-700"
                        aria-label="Add the keys a service needs"
                      >
                        <option value="">+ Service…</option>
                        {data.presets.map((x) => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="mt-2 truncate text-[11px] text-slate-400" title={data.keysFile}>🔒 {data.keysFile}</p>
                </div>

                {/* Links */}
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                    <Link2 className="h-3.5 w-3.5" /> Links
                  </h4>
                  <ul className="space-y-1">
                    {data.links.map((l) => (
                      <li key={l.id} className="group flex items-center gap-2 text-sm">
                        <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-600 hover:underline dark:text-indigo-400" title={l.url}>
                          {l.title}
                        </a>
                        <button onClick={() => saveBox(data.tools, data.links.filter((x) => x.id !== l.id))} aria-label={`Remove ${l.title}`} className="rounded p-0.5 text-slate-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                    {!data.links.length && <li className="text-xs text-slate-500">Docs, dashboards, store pages…</li>}
                  </ul>
                  <form
                    className="mt-2 flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const url = link.url.trim();
                      if (!/^https?:\/\//i.test(url)) return setError('Links start with http:// or https://');
                      saveBox(data.tools, [...data.links, { id: newId('link'), title: link.title.trim() || url.replace(/^https?:\/\//, '').split('/')[0], url }]);
                      setLink({ title: '', url: '' });
                    }}
                  >
                    <input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Title" className={`${input} w-1/3`} />
                    <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://…" className={input} />
                    <button type="submit" aria-label="Add link" className={small}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </form>
                </div>
              </div>

              {shown && (
                <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                    <b>{data.tools.find((t) => t.id === shown.toolId)?.name}</b>
                    <span className="text-slate-500">{shown.status === 'running' ? 'running…' : shown.status === 'ok' ? '✅ finished' : `❌ failed (exit ${shown.exitCode})`}</span>
                    <button onClick={() => setShowRun(null)} aria-label="Close output" className="ml-auto rounded p-0.5 text-slate-400 hover:text-slate-700">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-slate-700 dark:text-slate-300">{shown.output || (shown.status === 'running' ? '(no output yet)' : '(it printed nothing)')}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};
