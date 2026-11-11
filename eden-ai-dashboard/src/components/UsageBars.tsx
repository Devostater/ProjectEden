import React, { useEffect, useState } from 'react';

export interface ProviderUsage {
  provider: 'anthropic' | 'google' | 'openai';
  name: string;
  mode: 'subscription' | 'api' | 'off';
  messages: number;
  tokens: number;
  limit: number;
  limitNote: string;
}

// Polls the server for today's usage per AI. Refreshes every 15s and whenever the tab regains focus.
export function useProviderUsage(): ProviderUsage[] {
  const [usage, setUsage] = useState<ProviderUsage[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/provider-usage')
        .then((r) => r.json())
        .then((d) => alive && setUsage(d.usage || []))
        .catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);
  return usage;
}

export const UsageBar: React.FC<{ u: ProviderUsage; compact?: boolean }> = ({ u, compact }) => {
  const off = u.mode === 'off';
  const limited = !!u.limitNote;
  const pct = limited ? 100 : Math.min(100, Math.round((u.messages / u.limit) * 100));
  const color = off
    ? 'bg-slate-300 dark:bg-slate-700'
    : limited || pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const status = off ? 'Not connected' : limited ? 'Limit reached' : `${u.messages} / ${u.limit}`;

  return (
    <div title={limited ? u.limitNote : off ? 'Set it up in Account → Connections' : `${u.messages} of ${u.limit} messages today`}>
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
      {!compact && limited && <p className="mt-1.5 text-xs text-red-500">{u.limitNote}</p>}
    </div>
  );
};

// Compact stack for the sidebar.
export const UsageBars: React.FC = () => {
  const usage = useProviderUsage();
  if (!usage.length) return null;
  return (
    <div className="space-y-2.5 px-3 pb-1 pt-2">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Messages today</div>
      {usage.map((u) => (
        <UsageBar key={u.provider} u={u} compact />
      ))}
    </div>
  );
};
