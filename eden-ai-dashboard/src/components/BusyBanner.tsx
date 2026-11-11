import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

export interface BusyStatus {
  enabled: boolean;
  busy: boolean;
  active: boolean;
  reason: string;
  since?: string;
  freeGb: number;
  cpuPercent: number;
}

// Shared poll of "PC busy" mode, so the banner and the This PC card agree.
export function useBusy(): [BusyStatus | null, (enabled: boolean) => Promise<void>] {
  const [status, setStatus] = useState<BusyStatus | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/pc-busy').then((r) => (r.ok ? r.json() : null)).then((d) => d && setStatus(d)).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(t);
  }, []);
  const setEnabled = async (enabled: boolean) => {
    const d = await fetch('/api/pc-busy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then((r) => r.json());
    setStatus(d);
  };
  return [status, setEnabled];
}

// Shown across the top of the hub while the PC is busy and heavy jobs are waiting.
export const BusyBanner: React.FC = () => {
  const [status] = useBusy();
  if (!status?.active) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
      <Gauge className="h-4 w-4 shrink-0" />
      <span>
        <b>PC busy</b> ({status.reason}). Code updates, LYRA and AI models on this PC wait; cloud AIs keep working. Everything carries on by itself when it has room.
      </span>
    </div>
  );
};
