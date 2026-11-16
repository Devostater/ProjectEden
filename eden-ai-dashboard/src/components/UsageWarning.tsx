// Running low on an AI plan: a yellow line across the top once a plan passes 85%, and the
// "Pause AI automatically at 95%" switch for Account → Connections (the hub does the pausing, see usageGuard.ts).
import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../api.ts';
import { useProviderUsage, usagePercent, type ProviderUsage } from './UsageBars.tsx';

const WARN_PERCENT = 85;
const PLANS: ProviderUsage['provider'][] = ['anthropic', 'openai', 'google'];
const DISMISSED_KEY = 'eden-usage-warning-dismissed';

interface Guard {
  autoPause: boolean;
  pausedFor: string[];
}

export const UsageWarningBanner: React.FC = () => {
  const usage = useProviderUsage();
  const [guard, setGuard] = useState<Guard | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) || '';
    } catch {
      return '';
    }
  });

  const warn = usage.filter((u) => u.mode !== 'off' && PLANS.includes(u.provider) && usagePercent(u) >= WARN_PERCENT);
  // What the warning says right now. Hiding it hides exactly this; it comes back when anything changes
  // (another AI gets close, or one goes from "almost" to "used up").
  const signature = warn.map((u) => `${u.provider}:${usagePercent(u) >= 100 ? 'out' : 'near'}`).join(',');

  useEffect(() => {
    if (!signature) return;
    api<Guard>('GET', '/api/usage-guard').then(setGuard).catch(() => {});
  }, [signature]);

  if (!warn.length || dismissed === signature) return null;
  const names = warn.map((u) => `${u.name} (${usagePercent(u) >= 100 ? 'used up' : `${usagePercent(u)}%`})`).join(', ');
  const autoPaused = !!guard?.autoPause && warn.some((u) => guard.pausedFor.includes(u.provider));
  const hide = () => {
    setDismissed(signature);
    try {
      localStorage.setItem(DISMISSED_KEY, signature);
    } catch {}
  };
  return (
    <div role="status" className="flex items-start gap-2 border-b border-yellow-300 bg-yellow-50 px-4 py-2 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <b>Almost at the limit:</b> {names}.{' '}
        {autoPaused ? 'The AI team was paused for you. Press Resume AI when you want it to carry on.' : 'Work that would have used it goes to your other AIs.'}
      </span>
      <button onClick={hide} aria-label="Hide this warning" title="Hide (it comes back if this changes)" className="shrink-0 rounded p-0.5 hover:bg-yellow-100 dark:hover:bg-yellow-900/50">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

// Account → Connections: stops the team by itself when a plan is nearly out, so it isn't used up by accident.
export const AutoPauseCard: React.FC = () => {
  const [guard, setGuard] = useState<Guard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Guard>('GET', '/api/usage-guard').then(setGuard).catch(() => {});
  }, []);
  const set = async (autoPause: boolean) => {
    setError('');
    try {
      setGuard(await api<Guard>('POST', '/api/usage-guard', { autoPause }));
    } catch (err: any) {
      setError(err.message);
    }
  };
  if (!guard) return null;
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Running out of AI</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A yellow warning shows when Claude, ChatGPT or Gemini passes 85% of its limit. You can also have the team pause itself at 95%.</p>
      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <input type="checkbox" checked={guard.autoPause} onChange={(e) => set(e.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" />
        <span>
          <span className="block font-medium text-slate-900 dark:text-white">Pause AI automatically at 95%</span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            Nexus discussions and card work stop until you press Resume AI. Chat still works. The hub does this itself, even with every page closed. It pauses once each time a plan crosses 95%, so pressing Resume AI keeps it going.
          </span>
        </span>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};
