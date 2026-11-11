import React, { useEffect, useState } from 'react';
import { WifiOff, Cpu, Leaf } from 'lucide-react';

interface OfflineStatus {
  mode: 'auto' | 'on' | 'off';
  internetUp: boolean;
  offline: boolean;
  localFirst: boolean;
  models: { general: string | null; code: string | null; quick: string | null };
  localCount: number;
  hasGptOss: boolean;
  today: { local: number; cloud: number; localPercent: number };
  week: { local: number; cloud: number; localPercent: number };
}

const short = (id: string | null) => (id ? id.replace(/^x:[^:]+:/, '') : 'none');

function useOffline(): [OfflineStatus | null, (change: { mode?: OfflineStatus['mode']; localFirst?: boolean }) => Promise<void>] {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/offline').then((r) => (r.ok ? r.json() : null)).then((d) => d && setStatus(d)).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(t);
  }, []);
  const setMode = async (change: { mode?: OfflineStatus['mode']; localFirst?: boolean }) => {
    const d = await fetch('/api/offline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) }).then((r) => r.json());
    setStatus(d);
  };
  return [status, setMode];
}

// Across the top of the hub while offline mode is on.
export const OfflineBanner: React.FC = () => {
  const [s] = useOffline();
  if (!s?.offline) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-sky-300 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>
        <b>Offline</b>{s.mode === 'on' ? ' (always offline is on)' : ' (no internet)'}. The team runs on AI on this PC: {short(s.models.general)} for writing and chat, {short(s.models.code)} for code. Code updates and Aura wait for the internet.
      </span>
    </div>
  );
};

// Account → Connections: the offline switch.
export const OfflineCard: React.FC = () => {
  const [s, setMode] = useOffline();
  if (!s) return null;
  const options: { id: OfflineStatus['mode']; label: string; note: string }[] = [
    { id: 'auto', label: 'Automatic', note: 'Goes offline by itself when the internet drops' },
    { id: 'on', label: 'Always offline', note: 'Never sends anything to cloud AIs' },
    { id: 'off', label: 'Never', note: 'Cloud AIs only (local ones are a backup)' },
  ];
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
        Offline mode
        {s.offline ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">Offline now</span> : <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">Online</span>}
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Keep working with no internet, on AI that runs on this PC. Work that needs the internet waits and starts by itself when it's back.</p>
      <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div role="radiogroup" aria-label="Offline mode" className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={s.mode === o.id}
              onClick={() => setMode({ mode: o.id })}
              className={`rounded-lg border-2 px-3 py-2 text-left ${s.mode === o.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
            >
              <span className="block text-sm font-medium text-slate-900 dark:text-white">{o.label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{o.note}</span>
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
          <input type="checkbox" checked={s.localFirst} onChange={(e) => setMode({ localFirst: e.target.checked })} className="mt-0.5 h-4 w-4 accent-emerald-600" disabled={!s.localCount} />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white"><Leaf className="h-4 w-4 text-emerald-500" /> Local first, even online</span>
            <span className="block text-sm text-slate-600 dark:text-slate-400">
              Everyday work (chat, Nexus, drafts, most cards) runs on this PC and saves your plans. The cloud still handles teammates set to Opus, Aura, cards marked High priority, and any answer the local AI gets wrong. While the PC is busy, work goes to the cloud.
            </span>
          </span>
        </label>
        {s.week.local + s.week.cloud > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>This week: {s.week.local} on this PC, {s.week.cloud} in the cloud</span><span>{s.week.localPercent}% local</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900/60"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${s.week.localPercent}%` }} /></div>
          </div>
        )}
        {s.localCount ? (
          <p className="flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-400">
            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              Offline, writing, planning and chat use <b className="text-slate-800 dark:text-slate-200">{short(s.models.general)}</b>; code work uses <b className="text-slate-800 dark:text-slate-200">{short(s.models.code)}</b>. {s.hasGptOss ? ' gpt-oss-20b takes over for writing whenever there is enough free memory.' : ' Both fit on your graphics card, so they answer quickly.'}
            </span>
          </p>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-300">No AI on this PC is running. Start Ollama so the team can work offline.</p>
        )}
      </div>
    </div>
  );
};
