import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, ChevronDown, MessageSquare } from 'lucide-react';
import type { Agent } from '../types/index.ts';
import { useProviderUsage, type ProviderUsage } from './UsageBars.tsx';
import { ReformTeam } from './ReformTeam.tsx';

interface MyAIViewProps {
  agents: Agent[];
  onSaveAgent: (agent: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onSelectAgentForSwarm: (agentId: string) => void; // opens Chat addressed to this teammate
  request?: { kind: 'new-teammate' | 'edit-teammate'; id?: string; n: number } | null; // from the sidebar
  onTeamChanged?: () => void | Promise<void>; // reload the team after "Reform team"
}

type ProviderId = 'lyra' | 'anthropic' | 'google' | 'openai' | 'extra' | 'aura';

// The AIs a teammate can run on (LYRA = your own local AI on this PC), and the model each uses unless you pick another under "More options".
const AI_CHOICES: { id: ProviderId; name: string; model: string; badge: string }[] = [
  { id: 'lyra', name: 'LYRA', model: 'lyra', badge: 'text-fuchsia-500 bg-fuchsia-500/10' },
  { id: 'anthropic', name: 'Claude', model: 'claude-sonnet-5-5', badge: 'text-orange-500 bg-orange-500/10' },
  { id: 'google', name: 'Gemini', model: 'gemini-3.6-flash', badge: 'text-sky-500 bg-sky-500/10' },
  { id: 'openai', name: 'ChatGPT', model: 'gpt-5', badge: 'text-emerald-500 bg-emerald-500/10' },
  // Free AIs (Account → Connections): the model is filled in from what's available.
  { id: 'extra', name: 'Free AI', model: '', badge: 'text-lime-600 bg-lime-500/10' },
  // Aura (Unreal): Claude with Aura's Unreal tools. Only shown when Aura is installed.
  { id: 'aura', name: 'Aura (Unreal)', model: 'aura', badge: 'text-violet-500 bg-violet-500/10' },
];

const MODELS: { id: string; label: string; provider: ProviderId }[] = [
  { id: 'lyra', label: 'LYRA (local, picks the best free model)', provider: 'lyra' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (deepest thinking)', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)', provider: 'anthropic' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fast)', provider: 'anthropic' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (standard)', provider: 'google' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest)', provider: 'google' },
  { id: 'gpt-5', label: 'ChatGPT (GPT-5)', provider: 'openai' },
];

const ROLE_IDEAS = ['Music & Sound', 'QA & Testing', 'Translation', 'Legal & Licensing', 'Video & Trailers'];
const COLORS = ['#06B6D4', '#F43F5E', '#84CC16', '#D97706', '#3B82F6', '#8B5CF6', '#10B981', '#EC4899'];
const LEAD_ID = 'agent-synthesizer';

const providerOf = (model: string): ProviderId => (model.startsWith('aura') ? 'aura' : model.startsWith('x:') ? 'extra' : model.startsWith('lyra') ? 'lyra' : model.startsWith('claude') ? 'anthropic' : model.startsWith('gemini') ? 'google' : 'openai');

function aiStatus(u?: ProviderUsage): { text: string; ok: boolean } {
  if (!u) return { text: '', ok: true };
  if (u.mode === 'off') return { text: 'Not set up', ok: false };
  if (u.limitNote) return { text: 'Limit reached', ok: false };
  return { text: 'Connected', ok: true };
}

const defaultInstruction = (name: string, role: string) =>
  `You are ${name || 'a specialist'}, responsible for ${role || 'your specialty'} at a small studio that makes games and digital products and sells them online. Give practical, specific help in your area, keep answers short, and say what you need from the owner or other teammates.`;

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export const MyAIView: React.FC<MyAIViewProps> = ({ agents, onSaveAgent, onDeleteAgent, onSelectAgentForSwarm, request, onTeamChanged }) => {
  const usage = useProviderUsage();
  // Free AI models found in Account → Connections (Google AI Studio, Ollama on this PC, …).
  const [freeModels, setFreeModels] = useState<{ id: string; label: string; provider: ProviderId }[]>([]);
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        setFreeModels((d.models || []).filter((m: any) => m.provider === 'extra'));
        setAuraModels((d.models || []).filter((m: any) => String(m.id).startsWith('aura')).map((m: any) => ({ ...m, provider: 'aura' })));
      })
      .catch(() => {});
  }, []);
  // Aura (Unreal): listed only when Aura is installed on this PC.
  const [auraModels, setAuraModels] = useState<{ id: string; label: string; provider: ProviderId }[]>([]);
  const allModels = [...MODELS, ...auraModels, ...freeModels];
  // AI that runs on this PC (Ollama, LM Studio): used offline and in local-first mode.
  const pcModels = freeModels.filter((m) => /^x:(ollama|lmstudio):/.test(m.id));
  const choiceModel = (c: (typeof AI_CHOICES)[number]) => c.model || freeModels[0]?.id || '';
  // Aura runs on your Claude plan, so it shows Claude's status.
  const usageOf = (p: ProviderId) => usage.find((u) => u.provider === (p === 'aura' ? 'anthropic' : p));

  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState('gemini-3.6-flash');
  const [localModel, setLocalModel] = useState('');
  const [instruction, setInstruction] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  const openForm = (agent?: Agent) => {
    setEditing(agent || null);
    setName(agent?.name || '');
    setRole(agent?.role || '');
    // New teammates start on the first AI that is working right now.
    const firstWorking = AI_CHOICES.find((c) => choiceModel(c) && aiStatus(usageOf(c.id)).ok && usageOf(c.id)?.mode !== 'off');
    setModel(agent?.model || (firstWorking ? choiceModel(firstWorking) : '') || 'gemini-3.6-flash');
    setInstruction(agent?.systemInstruction || '');
    setColor(agent?.color || COLORS[agents.length % COLORS.length]);
    setLocalModel(agent?.localModel || '');
    setShowMore(false);
    setOpen(true);
  };

  // The sidebar's "Add teammate" or a teammate's name opens the form here.
  useEffect(() => {
    if (!request) return;
    if (request.kind === 'new-teammate') openForm();
    else {
      const agent = agents.find((a) => a.id === request.id);
      if (agent) openForm(agent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;
    setSaving(true);
    await onSaveAgent({
      id: editing?.id,
      name: name.trim(),
      role: role.trim(),
      model,
      localModel,
      color,
      avatar: name.trim().slice(0, 2).toUpperCase(),
      systemInstruction: instruction.trim() || defaultInstruction(name.trim(), role.trim()),
    });
    setSaving(false);
    setOpen(false);
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    setOpen(false);
    await onDeleteAgent(id);
  };

  // Escape closes the form.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const chosenProvider = providerOf(model);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Team</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Click a teammate to change them.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ReformTeam onApplied={onTeamChanged || (() => {})} />
          <button onClick={() => openForm()} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" /> Add teammate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {agents.map((agent) => {
          const choice = AI_CHOICES.find((c) => c.id === providerOf(agent.model))!;
          const status = aiStatus(usageOf(choice.id));
          const asking = confirmDelete === agent.id;
          return (
            <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => openForm(agent)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={`Edit ${agent.name}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: agent.color }}>
                  {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900 dark:text-white">{agent.name}</span>
                  <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{agent.role}</span>
                </span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${choice.badge}`} title={status.ok ? '' : `${choice.name}: ${status.text}. Another connected AI answers for now.`}>
                  {choice.name}
                  {!status.ok && ' ⚠'}
                </span>
              </button>

              {asking ? (
                <span className="flex shrink-0 items-center gap-1 text-sm">
                  <button onClick={() => remove(agent.id)} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-500">
                    Remove
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Keep
                  </button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center">
                  <button onClick={() => onSelectAgentForSwarm(agent.id)} aria-label={`Chat with ${agent.name}`} title="Chat" className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800">
                    <MessageSquare className="h-4 w-4" />
                  </button>
                  {agent.id !== LEAD_ID && (
                    <button onClick={() => setConfirmDelete(agent.id)} aria-label={`Remove ${agent.name}`} title="Remove" className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}

        <button
          onClick={() => openForm()}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-3 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
          style={{ minHeight: '4.25rem' }}
        >
          <Plus className="h-4 w-4" /> Add teammate
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h2 className="font-semibold text-slate-900 dark:text-white">{editing ? `Edit ${editing.name}` : 'Add a teammate'}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-5">
              <div>
                <label htmlFor="tm-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input id="tm-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lyra" className={inputClass} />
              </div>

              <div>
                <label htmlFor="tm-role" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">What do they do?</label>
                <input id="tm-role" required value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Music & Sound" className={inputClass} />
                {!editing && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ROLE_IDEAS.map((r) => (
                      <button key={r} type="button" onClick={() => setRole(r)} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300">
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Which AI?</span>
                <div className="grid grid-cols-3 gap-2">
                  {AI_CHOICES.filter((c) => (c.id !== 'extra' || freeModels.length) && (c.id !== 'aura' || auraModels.length)).map((c) => {
                    const status = aiStatus(usageOf(c.id));
                    const selected = chosenProvider === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setModel(choiceModel(c))}
                        aria-pressed={selected}
                        className={`rounded-lg border-2 px-3 py-2.5 text-left ${
                          selected ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                        }`}
                      >
                        <span className="block text-sm font-medium text-slate-900 dark:text-white">{c.name}</span>
                        <span className={`block text-xs ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{status.text || ' '}</span>
                      </button>
                    );
                  })}
                </div>
                {!aiStatus(usageOf(chosenProvider)).ok && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">This AI can't answer right now, so another connected AI will answer for this teammate until it can.</p>
                )}
              </div>

              <div>
                <button type="button" onClick={() => setShowMore(!showMore)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                  <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} /> More options
                </button>
                {showMore && (
                  <div className="mt-3 space-y-4">
                    <div>
                      <label htmlFor="tm-model" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Exact model</label>
                      <select id="tm-model" value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
                        {allModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        {!allModels.some((m) => m.id === model) && <option value={model}>{model}</option>}
                      </select>
                    </div>
                    {pcModels.length > 0 && (
                      <div>
                        <label htmlFor="tm-local" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">On this PC (offline and local first)</label>
                        <select id="tm-local" value={localModel} onChange={(e) => setLocalModel(e.target.value)} className={inputClass}>
                          <option value="">Automatic (picked for their role)</option>
                          {pcModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.id.replace(/^x:[^:]+:/, '')}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">Big models (gpt-oss-20b, 14B) are only used when the PC has enough free memory; otherwise a smaller one answers.</p>
                      </div>
                    )}
                    <div>
                      <label htmlFor="tm-inst" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Instructions</label>
                      <textarea
                        id="tm-inst"
                        rows={5}
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={defaultInstruction(name, role)}
                        className={inputClass}
                      />
                      <p className="mt-1 text-xs text-slate-500">Leave empty to use the suggestion shown.</p>
                    </div>
                    <div>
                      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Colour</span>
                      <div className="flex gap-2">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            aria-label={`Colour ${c}`}
                            aria-pressed={color === c}
                            style={{ backgroundColor: c }}
                            className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-900' : ''}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              {editing && editing.id !== LEAD_ID && (
                <button type="button" onClick={() => remove(editing.id)} className="flex items-center gap-1.5 text-sm text-red-600 hover:underline dark:text-red-400">
                  <Trash2 className="h-4 w-4" /> Remove from team
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="submit" disabled={saving || !name.trim() || !role.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
                {editing ? 'Save' : 'Add to team'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
