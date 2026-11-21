import React, { useEffect, useMemo, useState } from 'react';
import type { DAGPipeline, DAGNode, Agent } from '../types/index.ts';
import { Play, Plus, CheckCircle2, AlertCircle, Clock, Pencil, Trash2, ArrowUp, ArrowDown, Search, X, Save, ChevronDown, ChevronRight, FileCode, Layers } from 'lucide-react';

// Workflows: a list on the left, the chosen workflow on the right. A workflow is a chain of steps run in order;
// each step hands its result to the next. Create, edit, delete and run all happen on this page.

interface PipelineDAGViewProps {
  pipelines: DAGPipeline[];
  agents: Agent[];
  onSavePipeline: (pipe: DAGPipeline) => Promise<void>;
  onRefreshData?: () => void;
  openId?: string; // from the sidebar
  openNonce?: number;
  onSelected?: (id: string) => void;
}

type Draft = { id: string; name: string; description: string; nodes: DAGNode[] };

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const step = (label: string, prompt: string, agentId?: string): DAGNode => ({ id: uid('step'), label, type: 'agent', agentId, prompt, status: 'idle', x: 0, y: 0 });
const saveStep = (label: string, outputPath: string): DAGNode => ({ id: uid('step'), label, type: 'artifact_save', outputPath, status: 'idle', x: 0, y: 0 });
// Steps run top to bottom: each one is linked to the next.
const chain = (nodes: DAGNode[]) => nodes.slice(0, -1).map((n, i) => ({ id: `e-${n.id}`, source: n.id, target: nodes[i + 1].id }));

const TEMPLATES: { name: string; about: string; make: (first?: string) => Draft }[] = [
  { name: 'Blank', about: 'Start with one empty step.', make: (a) => ({ id: '', name: '', description: '', nodes: [step('Step 1', '', a)] }) },
  {
    name: 'Research → Write → Review',
    about: 'Look into a topic, write it up, then check it.',
    make: (a) => ({ id: '', name: 'Research and write', description: 'Research a topic, write it up, review it, save it.', nodes: [
      step('Research', 'Research the topic and list the key facts and sources.', a),
      step('Write', 'Write a clear draft from the research above.', a),
      step('Review', 'Review the draft. Fix mistakes and return the final version.', a),
      saveStep('Save to Files', 'workflows/result.md'),
    ] }),
  },
  {
    name: 'Idea → Plan → Tasks',
    about: 'Turn a rough idea into a plan and a task list.',
    make: (a) => ({ id: '', name: 'Idea to plan', description: 'Turn an idea into a plan with tasks.', nodes: [
      step('Shape the idea', 'Restate the idea clearly: goal, audience, what success looks like.', a),
      step('Plan', 'Write a step-by-step plan with milestones.', a),
      step('Task list', 'Break the plan into small tasks, each with a one-line description.', a),
    ] }),
  },
];

const input = 'w-full px-3 py-2 text-sm rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500';
const label = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1';
const card = 'rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800';
const ghost = 'px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-40';
const primary = 'px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap';

function StatusDot({ status }: { status?: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-label="Done" />;
  if (status === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-label="Failed" />;
  if (status === 'running') return <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse shrink-0" aria-label="Running" />;
  return <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0 mx-[3px]" aria-label="Not run yet" />;
}

const when = (iso?: string) => {
  if (!iso) return 'Never run';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never run' : `Last run ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

export const PipelineDAGView: React.FC<PipelineDAGViewProps> = ({ pipelines, agents, onSavePipeline, onRefreshData, openId, openNonce, onSelected }) => {
  const [selectedId, setSelectedId] = useState<string>(pipelines[0]?.id || '');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null); // set while creating or editing
  const [picking, setPicking] = useState(false); // choosing a template for a new workflow
  const [open, setOpen] = useState<Record<string, boolean>>({}); // which step results are unfolded
  const [runInput, setRunInput] = useState('');
  const [running, setRunning] = useState(false);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (openId && pipelines.some((p) => p.id === openId)) { setSelectedId(openId); setDraft(null); setPicking(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNonce]);
  useEffect(() => { onSelected?.(selectedId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId]);

  const active = pipelines.find((p) => p.id === selectedId) || pipelines[0];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pipelines.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : pipelines;
  }, [pipelines, query]);
  const firstAgent = agents[0]?.id;

  const pick = (id: string) => { setSelectedId(id); setDraft(null); setPicking(false); setOutputs({}); setFailed({}); setError(''); setOpen({}); };

  const run = async () => {
    if (!active || running) return;
    setRunning(true); setError(''); setOutputs({}); setFailed({});
    try {
      const res = await fetch(`/api/pipelines/${encodeURIComponent(active.id)}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customInput: runInput }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `The workflow could not be run (error ${res.status}).`);
      const steps: DAGNode[] = data.pipeline?.nodes || [];
      setOutputs(Object.fromEntries(steps.map((n) => [n.id, n.lastOutput || ''])));
      const bad = steps.filter((n) => n.status === 'error');
      setFailed(Object.fromEntries(bad.map((n) => [n.id, n.error || 'It failed without a message.'])));
      setOpen(Object.fromEntries(steps.map((n, i) => [n.id, n.status === 'error' || i === steps.length - 1])));
      if (bad.length) setError(`${bad.length} step${bad.length === 1 ? '' : 's'} failed: ${bad.map((n) => n.label).join(', ')}.`);
      onRefreshData?.();
    } catch (e: any) { setError(e.message); } finally { setRunning(false); }
  };

  const save = async () => {
    if (!draft || saving) return;
    const name = draft.name.trim();
    if (!name) return setError('Give the workflow a name.');
    if (!draft.nodes.length) return setError('Add at least one step.');
    const nodes = draft.nodes.map((n, i) => ({ ...n, label: n.label.trim() || `Step ${i + 1}`, y: i * 120 }));
    const id = draft.id || uid('pipe');
    setSaving(true); setError('');
    try {
      // Same steps in the same order: keep the links it had (some workflows branch). Otherwise link top to bottom.
      const before = pipelines.find((p) => p.id === id);
      const sameSteps = !!before && before.nodes.map((n) => n.id).join() === nodes.map((n) => n.id).join();
      await onSavePipeline({ id, name, description: draft.description.trim(), nodes, edges: sameSteps ? before.edges : chain(nodes), lastStatus: before?.lastStatus || 'idle' });
      setDraft(null); setSelectedId(id);
    } catch (e: any) { setError(e?.message || 'Could not save the workflow.'); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!active || !confirm(`Delete the workflow "${active.name}"? This can't be undone.`)) return;
    setError('');
    try {
      const res = await fetch(`/api/pipelines/${encodeURIComponent(active.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not delete the workflow.');
      setSelectedId(pipelines.find((p) => p.id !== active.id)?.id || '');
      onRefreshData?.();
    } catch (e: any) { setError(e.message); }
  };

  const edit = (i: number, patch: Partial<DAGNode>) => setDraft((d) => d && { ...d, nodes: d.nodes.map((n, k) => (k === i ? { ...n, ...patch } : n)) });
  const move = (i: number, by: number) => setDraft((d) => {
    if (!d) return d; const j = i + by; if (j < 0 || j >= d.nodes.length) return d;
    const nodes = [...d.nodes]; [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; return { ...d, nodes };
  });

  const who = (n: DAGNode) => (n.type === 'artifact_save' ? 'Saves to Files' : agents.find((a) => a.id === n.agentId)?.name || (n.type === 'agent' ? 'No teammate chosen' : n.type.replace('_', ' ')));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Workflows</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Chains of steps your team runs in order. Each step hands its result to the next.</p>
        </div>
        <button className={primary} onClick={() => { setPicking(true); setDraft(null); setError(''); }}><Plus className="w-3.5 h-3.5" />New workflow</button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4 items-start">
        {/* The list */}
        <div className={`${card} p-3`}>
          {pipelines.length > 5 && (
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a workflow" aria-label="Find a workflow" className={`${input} pl-8`} />
            </div>
          )}
          {!pipelines.length && <p className="text-sm text-slate-500 dark:text-slate-400 p-2">No workflows yet. Create your first one with New workflow.</p>}
          {!!pipelines.length && !shown.length && <p className="text-sm text-slate-500 dark:text-slate-400 p-2">Nothing matches “{query}”.</p>}
          <ul className="space-y-1">
            {shown.map((p) => (
              <li key={p.id}>
                <button onClick={() => pick(p.id)} aria-current={active?.id === p.id && !draft && !picking ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${active?.id === p.id && !draft && !picking ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                  <span className="flex items-center gap-2"><StatusDot status={p.lastStatus} /><span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{p.name}</span></span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 pl-5">{p.nodes.length} step{p.nodes.length === 1 ? '' : 's'} · {when(p.lastRunAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Right side: template picker, editor, or the chosen workflow */}
        {picking ? (
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900 dark:text-white">New workflow: pick a starting point</h2>
              <button className={ghost} onClick={() => setPicking(false)}><X className="w-3.5 h-3.5" />Cancel</button>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {TEMPLATES.map((t) => (
                <button key={t.name} onClick={() => { setDraft(t.make(firstAgent)); setPicking(false); }} className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20">
                  <span className="block font-semibold text-sm text-slate-900 dark:text-white">{t.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">{t.about}</span>
                </button>
              ))}
            </div>
          </div>
        ) : draft ? (
          <div className={`${card} p-5 space-y-4`}>
            <h2 className="font-semibold text-slate-900 dark:text-white">{draft.id ? 'Edit workflow' : 'New workflow'}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={label} htmlFor="wfName">Name</label><input id="wfName" className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Weekly devlog" autoFocus /></div>
              <div><label className={label} htmlFor="wfAbout">What it's for (optional)</label><input id="wfAbout" className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            </div>
            <div className="space-y-3">
              {draft.nodes.map((n, i) => (
                <div key={n.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/40 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400 w-12">Step {i + 1}</span>
                    <input className={`${input} flex-1 min-w-40`} value={n.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Step name" aria-label={`Step ${i + 1} name`} />
                    <select className={`${input} w-auto`} aria-label={`Step ${i + 1}: who does it`} value={n.type === 'artifact_save' ? '__save' : n.agentId || ''}
                      onChange={(e) => (e.target.value === '__save' ? edit(i, { type: 'artifact_save', agentId: undefined, outputPath: n.outputPath || 'workflows/result.md' }) : edit(i, { type: 'agent', agentId: e.target.value || undefined }))}>
                      {!n.agentId && n.type !== 'artifact_save' && <option value="">Choose a teammate…</option>}
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      <option value="__save">Save the result to Files</option>
                    </select>
                    <button className={ghost} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button className={ghost} onClick={() => move(i, 1)} disabled={i === draft.nodes.length - 1} aria-label="Move step down"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button className={ghost} onClick={() => setDraft({ ...draft, nodes: draft.nodes.filter((_, k) => k !== i) })} aria-label="Remove step"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {n.type === 'artifact_save'
                    ? <input className={input} value={n.outputPath || ''} onChange={(e) => edit(i, { outputPath: e.target.value })} placeholder="File name, e.g. workflows/result.md" aria-label={`Step ${i + 1} file name`} />
                    : <textarea className={`${input} min-h-20`} value={n.prompt || ''} onChange={(e) => edit(i, { prompt: e.target.value })} placeholder="What should this step do? It also gets the result of the step before it." aria-label={`Step ${i + 1} instructions`} />}
                </div>
              ))}
              <button className={ghost} onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, step(`Step ${draft.nodes.length + 1}`, '', firstAgent)] })}><Plus className="w-3.5 h-3.5" />Add a step</button>
            </div>
            <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button className={primary} onClick={save} disabled={saving}><Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save workflow'}</button>
              <button className={ghost} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
            </div>
          </div>
        ) : active ? (
          <div className={`${card} p-5 space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-lg text-slate-900 dark:text-white">{active.name}</h2>
                {active.description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{active.description}</p>}
                <p className="text-xs text-slate-400 mt-1">{active.nodes.length} step{active.nodes.length === 1 ? '' : 's'} · {when(active.lastRunAt)}</p>
              </div>
              <div className="flex gap-2">
                <button className={ghost} onClick={() => { setDraft({ id: active.id, name: active.name, description: active.description || '', nodes: active.nodes.map((n) => ({ ...n })) }); setError(''); }}><Pencil className="w-3.5 h-3.5" />Edit</button>
                <button className={ghost} onClick={remove}><Trash2 className="w-3.5 h-3.5" />Delete</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input className={`${input} flex-1 min-w-48`} value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder="What is this run about? e.g. A cozy farming game for phones" aria-label="What is this run about?" onKeyDown={(e) => { if (e.key === 'Enter') run(); }} />
              <button className={primary} onClick={run} disabled={running}>{running ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…</> : <><Play className="w-3.5 h-3.5 fill-current" />Run workflow</>}</button>
            </div>
            <ol className="space-y-2">
              {active.nodes.map((n, i) => {
                const out = outputs[n.id] || n.lastOutput || '';
                const err = failed[n.id] || (n.status === 'error' ? n.error : '') || '';
                const isOpen = !!open[n.id];
                const status = failed[n.id] ? 'error' : outputs[n.id] ? 'completed' : running ? 'running' : n.status;
                return (
                  <li key={n.id} className={`rounded-xl border ${err ? 'border-red-300 dark:border-red-900' : 'border-slate-200 dark:border-slate-800'}`}>
                    <button className="w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen({ ...open, [n.id]: !isOpen })} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                      {n.type === 'artifact_save' ? <FileCode className="w-4 h-4 text-emerald-500 shrink-0" /> : <Layers className="w-4 h-4 text-indigo-500 shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-sm text-slate-900 dark:text-white truncate">{i + 1}. {n.label}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{who(n)}</span>
                      </span>
                      <StatusDot status={status} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {n.type === 'artifact_save'
                          ? <p className="text-xs text-slate-500 dark:text-slate-400">Saves to <span className="font-mono">{n.outputPath || 'Files'}</span></p>
                          : <div><span className={label}>Instructions</span><p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{n.prompt || 'No instructions written.'}</p></div>}
                        {err && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Failed: {err}</p>}
                        <div><span className={label}>Result</span>
                          <div className="p-3 rounded-lg bg-slate-950 text-slate-200 text-xs overflow-y-auto max-h-96 leading-relaxed whitespace-pre-wrap">{out || 'Run the workflow to see this step’s result.'}</div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div className={`${card} p-8 text-center text-sm text-slate-500 dark:text-slate-400`}>Create a workflow to get started.</div>
        )}
      </div>
    </div>
  );
};
