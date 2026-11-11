import React, { useEffect, useState } from 'react';
import { Plus, Radar, Loader2, CheckCircle2, AlertCircle, Trash2, ExternalLink, Cpu, X } from 'lucide-react';
import { api } from '../api.ts';
import { refreshUsage } from './UsageBars.tsx';

interface ExtraProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  free: boolean;
  local?: boolean;
  auto?: boolean;
  enabled: boolean;
  hasKey: boolean;
  lastError?: string;
}
interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  signup: string;
  note: string;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white';

// Account → Connections: extra AIs. Free ones are found automatically; others are added with a key.
// The team uses them when the main AIs are busy or out of limits, and you can put a teammate on one.
export const FreeAIs: React.FC = () => {
  const [providers, setProviders] = useState<ExtraProvider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [presetId, setPresetId] = useState('groq');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [openModels, setOpenModels] = useState<string | null>(null);

  const load = async () => {
    try {
      const d = await api<{ providers: ExtraProvider[]; presets: Preset[] }>('GET', '/api/extra-ai');
      setProviders(d.providers);
      setPresets(d.presets);
    } catch {}
  };
  useEffect(() => {
    load();
  }, []);

  const scan = async () => {
    setScanning(true);
    setNote(null);
    try {
      const d = await api<{ found: string[]; providers: ExtraProvider[] }>('POST', '/api/extra-ai/scan');
      setProviders(d.providers);
      setNote({ ok: true, text: d.found.length ? `Found ${d.found.join(', ')}.` : 'No new free AIs found. Start Ollama or LM Studio on this PC, or add one with a free key below.' });
      refreshUsage(true);
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    } finally {
      setScanning(false);
    }
  };

  const add = async () => {
    setSaving(true);
    setNote(null);
    try {
      const body = presetId === 'custom' ? { name, baseUrl, apiKey, free: true } : { presetId, apiKey };
      const d = await api<{ models: number; providers: ExtraProvider[] }>('POST', '/api/extra-ai', body);
      setProviders(d.providers);
      setNote({ ok: true, text: `Connected: ${d.models} model${d.models === 1 ? '' : 's'} ready for the team.` });
      setAdding(false);
      setApiKey('');
      setName('');
      setBaseUrl('');
      refreshUsage(true);
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, action: 'enable' | 'disable' | 'remove') => {
    try {
      const d = await api<{ providers: ExtraProvider[] }>('POST', `/api/extra-ai/${encodeURIComponent(id)}/${action}`);
      setProviders(d.providers);
      refreshUsage(true);
    } catch (err: any) {
      setNote({ ok: false, text: err.message });
    }
  };

  const preset = presets.find((p) => p.id === presetId);
  const totalModels = providers.filter((p) => p.enabled && !p.lastError).reduce((n, p) => n + p.models.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Free AIs</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Extra AIs that cost nothing. The team switches to them when your main AIs are busy or out of limits, and you can put a teammate on one.
            {totalModels > 0 && <> <b className="text-slate-700 dark:text-slate-200">{totalModels} models ready.</b></>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={scan} disabled={scanning} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Find free AIs
          </button>
          <button onClick={() => setAdding(!adding)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Add AI
          </button>
        </div>
      </div>

      {note && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${note.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
          {note.text}
        </p>
      )}

      {adding && (
        <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
          <div>
            <label htmlFor="xa-preset" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Which service?</label>
            <select id="xa-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)} className={inputClass}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="custom">Other (any OpenAI-compatible address)</option>
            </select>
            {preset && (
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                {preset.note}{' '}
                <a href={preset.signup} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline dark:text-indigo-400">
                  Get a free key <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            )}
          </div>
          {presetId === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. My server" className={inputClass} aria-label="Name" />
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" className={inputClass} aria-label="Address" />
            </div>
          )}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={presetId === 'custom' ? 'Key (leave empty if none)' : 'Paste your key'} className={inputClass} aria-label="Key" autoComplete="off" />
          <div className="flex items-center gap-3">
            <button onClick={add} disabled={saving || (presetId !== 'custom' && !apiKey.trim())} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Connect
            </button>
            <span className="text-xs text-slate-500">The key stays on this computer.</span>
          </div>
        </div>
      )}

      {!providers.length ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">No free AIs yet. Click "Find free AIs".</p>
      ) : (
        providers.map((p) => {
          const ok = p.enabled && !p.lastError;
          return (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                {ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <AlertCircle className={`h-5 w-5 shrink-0 ${p.enabled ? 'text-amber-500' : 'text-slate-400'}`} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-white">
                    {p.name}
                    {p.local && <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Cpu className="h-3 w-3" /> this PC</span>}
                    {p.free && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">free</span>}
                  </div>
                  <button onClick={() => setOpenModels(openModels === p.id ? null : p.id)} className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                    {!p.enabled ? 'Turned off' : p.lastError ? p.lastError : `${p.models.length} model${p.models.length === 1 ? '' : 's'} · ${openModels === p.id ? 'hide' : 'show'}`}
                  </button>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => act(p.id, e.target.checked ? 'enable' : 'disable')} className="h-4 w-4 accent-indigo-600" />
                  Use
                </label>
                {!p.auto && (
                  <button onClick={() => act(p.id, 'remove')} aria-label={`Remove ${p.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {openModels === p.id && p.models.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {p.models.map((m) => (
                    <span key={m} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">{m}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
