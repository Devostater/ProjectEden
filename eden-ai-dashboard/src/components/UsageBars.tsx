import React, { useEffect, useState } from 'react';
import { RefreshCw, ChevronDown, Info } from 'lucide-react';
import type { UsageTotals } from '../types/index.ts';

export interface ProviderUsage {
  provider: 'lyra' | 'anthropic' | 'google' | 'openai' | 'extra';
  name: string;
  mode: 'subscription' | 'api' | 'off';
  messages: number;
  tokens: number;
  limit: number;
  limitNote: string;
  coveredByPlan?: boolean; // plan or free AI: counts as $0
  cost?: number; // today's estimate for AIs billed per use
  real?: { source: 'plan' | 'none'; usedPercent?: number; window?: string; resetsAt?: number; limited?: boolean; plan?: string };
}

// Shared by every usage display, so one refresh updates them all.
let shared: ProviderUsage[] = [];
let sharedTotals: UsageTotals | null = null; // tokens and estimated cost for today and the last 7 days
const subscribers = new Set<(u: ProviderUsage[]) => void>();
export async function refreshUsage(force = false) {
  try {
    const d = await fetch(`/api/provider-usage${force ? '?refresh=1' : ''}`).then((r) => r.json());
    shared = d.usage || [];
    sharedTotals = d.totals || null;
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

// Tokens and estimated cost for today and the last 7 days (null until the first check finishes).
export function useUsageTotals(): UsageTotals | null {
  useProviderUsage(); // re-renders this when a refresh brings new numbers
  return sharedTotals;
}

// How much of its limit an AI has used (0-100). One place, so the bars and the "almost at the limit" warning agree.
export const usagePercent = (u: ProviderUsage): number => {
  const real = u.real?.source === 'plan' ? u.real : undefined;
  const limited = !!real?.limited || !!u.limitNote;
  return real?.usedPercent !== undefined ? real.usedPercent : limited ? 100 : Math.min(100, Math.round((u.messages / u.limit) * 100));
};

// Runs a refresh and keeps `busy` true for at least 0.7s, so the spinning icon is always seen (a fast
// refresh used to finish before the eye caught it, which looked like the button did nothing).
export function useSpin(run: () => Promise<unknown> | unknown): [boolean, () => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    const started = Date.now();
    try {
      await run();
    } catch {
    } finally {
      setTimeout(() => setBusy(false), Math.max(0, 700 - (Date.now() - started)));
    }
  };
  return [busy, go];
}

export const RefreshUsageButton: React.FC<{ label?: boolean }> = ({ label = false }) => {
  const [busy, refresh] = useSpin(() => refreshUsage(true));
  return (
    <button
      onClick={refresh}
      disabled={busy}
      aria-label="Refresh usage and sign-in status"
      title="Check usage and sign-ins again"
      className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      {label && 'Refresh'}
    </button>
  );
};

export const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export const UsageBar: React.FC<{ u: ProviderUsage; compact?: boolean }> = ({ u, compact }) => {
  const off = u.mode === 'off';
  const real = u.real?.source === 'plan' ? u.real : undefined;
  const limited = !!real?.limited || !!u.limitNote;
  const pct = usagePercent(u);
  const color = off
    ? 'bg-slate-300 dark:bg-slate-700'
    : limited || pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  // Short label beside the name; the longer explanation shows when you hover below.
  const status = off
    ? 'Off'
    : real?.limited
      ? 'Used up'
      : real?.usedPercent !== undefined
        ? `${real.usedPercent}%`
        : limited
          ? 'Used up'
          : `${u.messages}/${u.limit}`;
  const detail = off
    ? 'Set it up in Account → Connections'
    : real?.usedPercent !== undefined
      ? `${real.plan ? `${real.plan[0].toUpperCase()}${real.plan.slice(1)} plan · ` : ''}${real.window || ''} limit${real.resetsAt ? `, resets ${resetText(real.resetsAt)}` : ''} (reported by the plan)`
      : real?.limited
        ? `${real.window || 'Plan'} limit reached, back ${resetText(real.resetsAt)} (reported by the plan)`
        : u.limitNote || `${u.messages} of your ${u.limit}-message daily budget used in this hub. The plan doesn't report its own remaining amount.`;

  // Shown as a hover tooltip so the list never jumps around.
  const tip = detail + (!off && u.coveredByPlan ? ' Covered by plan ($0).' : '') + (!off && u.coveredByPlan === false ? ` About ${money(u.cost || 0)} today (pay-per-use).` : '');

  return (
    <div className="rounded outline-none" tabIndex={0} title={tip}>
      <div className={`flex items-center justify-between gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className={`truncate ${off ? 'text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>{u.name}</span>
        <span className={`shrink-0 tabular-nums ${limited ? 'text-red-500' : 'text-slate-400'}`}>{status}</span>
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
      <p className="sr-only">{tip}</p>
    </div>
  );
};

// Compact stack for the sidebar.
export const UsageBars: React.FC = () => {
  const usage = useProviderUsage();
  // Minimized or open is remembered, so it stays how you left it.
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem('eden-usage-minimized') === '1';
    } catch {
      return false;
    }
  });
  if (!usage.length) return null;
  const toggle = () => {
    const next = !minimized;
    setMinimized(next);
    try {
      localStorage.setItem('eden-usage-minimized', next ? '1' : '0');
    } catch {}
  };
  return (
    <div className="space-y-2.5 px-3 pb-1 pt-2">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        <button
          onClick={toggle}
          aria-expanded={!minimized}
          title={minimized ? 'Show AI usage' : 'Minimize AI usage'}
          className="flex items-center gap-1 rounded px-0.5 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${minimized ? '-rotate-90' : ''}`} />
          AI usage
        </button>
        {!minimized && <RefreshUsageButton />}
      </div>
      {!minimized && usage.map((u) => <UsageBar key={u.provider} u={u} compact />)}
      {!minimized && (
        <div className="flex items-start gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          <div className="grid flex-1 grid-cols-[auto_1fr] gap-x-2">
            <span>About</span><span className="text-right">{money(usage.reduce((sum, u) => sum + (u.coveredByPlan === false ? u.cost || 0 : 0), 0))}</span>
            {sharedTotals && <><span>Est: {sharedTotals.today.tokens.toLocaleString()}</span><span className="text-right">{money(sharedTotals.today.cost)}</span></>}
            {sharedTotals && <><span>Wk: {sharedTotals.week.tokens.toLocaleString()}</span><span className="text-right">{money(sharedTotals.week.cost)}</span></>}
          </div>
          <InfoTip text="About: spent today on pay-per-use AIs. Est: tokens used today and their rough cost. Wk: the same for this week. Estimates, not a bill: AIs on a plan or free count as $0, and the week total fills up over the first week after this was added." />
        </div>
      )}
    </div>
  );
};

// An (i) icon that shows its text in a small box on hover, focus or tap.
const InfoTip: React.FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="What these numbers mean" aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} className="rounded p-0.5 hover:text-slate-800 dark:hover:text-slate-200">
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span role="tooltip" className="absolute bottom-full right-0 z-50 mb-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-xs leading-snug text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {text}
        </span>
      )}
    </span>
  );
};
