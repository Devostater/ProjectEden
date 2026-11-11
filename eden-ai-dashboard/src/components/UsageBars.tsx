import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export interface ProviderUsage {
  provider: 'anthropic' | 'google' | 'openai';
  name: string;
  mode: 'subscription' | 'api' | 'off';
  messages: number;
  tokens: number;
  limit: number;
  limitNote: string;
  real?: { source: 'plan' | 'none'; usedPercent?: number; window?: string; resetsAt?: number; limited?: boolean; plan?: string };
}

// Shared by every usage display, so one refresh updates them all.
let shared: ProviderUsage[] = [];
const subscribers = new Set<(u: ProviderUsage[]) => void>();
export async function refreshUsage(force = false) {
  try {
    const d = await fetch(`/api/provider-usage${force ? '?refresh=1' : ''}`).then((r) => r.json());
    shared = d.usage || [];
    subscribers.forEach((fn) => fn(shared));
  } catch {}
}

const resetText = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

// Polls the server for today's usage per AI. Refreshes every 15s and whenever the tab regains focus.
export function useProviderUsage(): ProviderUsage[] {
  const [usage, setUsage] = useState<ProviderUsage[]>(shared);
  useEffect(() => {
    subscribers.add(setUsage);
    if (!shared.length) refreshUsage();
    const timer = setInterval(() => document.visibilityState === 'visible' && refreshUsage(), 15000);
    const onFocus = () => refreshUsage();
    window.addEventListener('focus', onFocus);
    return () => {
      subscribers.delete(setUsage);
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return usage;
}

export const RefreshUsageButton: React.FC<{ label?: boolean }> = ({ label = false }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await refreshUsage(true);
        setBusy(false);
      }}
      aria-label="Refresh usage and sign-in status"
      title="Check usage and sign-ins again"
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      {label && 'Refresh'}
    </button>
  );
};

export const UsageBar: React.FC<{ u: ProviderUsage; compact?: boolean }> = ({ u, compact }) => {
  const off = u.mode === 'off';
  const real = u.real?.source === 'plan' ? u.real : undefined;
  const limited = !!real?.limited || !!u.limitNote;
  const pct = real?.usedPercent !== undefined ? real.usedPercent : limited ? 100 : Math.min(100, Math.round((u.messages / u.limit) * 100));
  const color = off
    ? 'bg-slate-300 dark:bg-slate-700'
    : limited || pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const status = off
    ? 'Not connected'
    : real?.limited
      ? `Used up · back ${resetText(real.resetsAt)}`
      : real?.usedPercent !== undefined
        ? `${real.usedPercent}% of ${real.window || 'plan'}`
        : limited
          ? 'Limit reached'
          : `${u.messages} / ${u.limit} today`;
  const detail = off
    ? 'Set it up in Account → Connections'
    : real?.usedPercent !== undefined
      ? `${real.plan ? `${real.plan[0].toUpperCase()}${real.plan.slice(1)} plan · ` : ''}${real.window || ''} limit${real.resetsAt ? `, resets ${resetText(real.resetsAt)}` : ''} (reported by the plan)`
      : real?.limited
        ? `${real.window || 'Plan'} limit reached, back ${resetText(real.resetsAt)} (reported by the plan)`
        : u.limitNote || `${u.messages} of your ${u.limit}-message daily budget used in this hub. The plan doesn't report its own remaining amount.`;

  return (
    <div title={detail}>
      <div className={`flex items-center justify-between ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className={off ? 'text-slate-400' : 'text-slate-700 dark:text-slate-300'}>{u.name}</span>
        <span className={`tabular-nums ${limited ? 'text-red-500' : 'text-slate-400'}`}>{status}</span>
      </div>
      <div
        className={`mt-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800 ${compact ? 'h-1.5' : 'h-2'}`}
        role="progressbar"
        aria-label={`${u.name} usage today`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${off ? 0 : Math.max(pct, u.messages ? 3 : 0)}%` }} />
      </div>
      {!compact && <p className={`mt-1.5 text-xs ${limited ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>{detail}</p>}
    </div>
  );
};

// Compact stack for the sidebar.
export const UsageBars: React.FC = () => {
  const usage = useProviderUsage();
  if (!usage.length) return null;
  return (
    <div className="space-y-2.5 px-3 pb-1 pt-2">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        AI usage
        <RefreshUsageButton />
      </div>
      {usage.map((u) => (
        <UsageBar key={u.provider} u={u} compact />
      ))}
    </div>
  );
};
