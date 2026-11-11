import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, Leaf, Gauge, Tablet, Plus, PauseCircle, Sun, Moon } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';

interface Status {
  offline?: { offline: boolean; mode: string; localFirst: boolean; week: { localPercent: number; local: number; cloud: number } };
  busy?: { active: boolean; enabled: boolean; cpuPercent: number; freeGb: number; reason: string };
  devices?: number;
  paused?: boolean;
}

const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// Slim bar across the top: where things stand at a glance, each part a shortcut to where it's set.
export const StatusBar: React.FC<{ title: string; setActiveTab: (t: AppTab) => void; darkMode: boolean; setDarkMode: (v: boolean) => void }> = ({ title, setActiveTab, darkMode, setDarkMode }) => {
  const [s, setS] = useState<Status>({});
  useEffect(() => {
    const load = async () => {
      const [offline, busy, devices, pause] = await Promise.all([get('/api/offline'), get('/api/pc-busy'), get('/api/devices'), get('/api/ai/pause')]);
      setS({
        offline: offline || undefined,
        busy: busy || undefined,
        devices: devices?.devices ? devices.devices.filter((d: any) => d.state === 'device').length : undefined,
        paused: pause?.paused,
      });
    };
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => clearInterval(t);
  }, []);

  const chip = 'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
  const calm = 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
  const o = s.offline;
  const b = s.busy;
  return (
    <div className="relative z-20 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <span className="mr-1 hidden truncate text-sm font-bold text-slate-900 sm:block dark:text-white">{title}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {o && (
          <button onClick={() => setActiveTab('settings')} title="Offline mode (Account → Connections)" className={`${chip} ${o.offline ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200' : calm}`}>
            {o.offline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5 text-emerald-500" />}
            {o.offline ? 'Offline: local AI' : 'Online'}
          </button>
        )}
        {o?.localFirst && !o.offline && (
          <button onClick={() => setActiveTab('settings')} title="Local first: share of AI work done on this PC this week" className={`${chip} border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40`}>
            <Leaf className="h-3.5 w-3.5" /> {o.week.local + o.week.cloud ? `${o.week.localPercent}% local` : 'Local first'}
          </button>
        )}
        {b && (
          <button onClick={() => setActiveTab('devices')} title={b.active ? `PC busy: ${b.reason}` : 'This PC (Devices)'} className={`${chip} ${b.active ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : calm}`}>
            <Gauge className="h-3.5 w-3.5" /> {b.active ? 'PC busy' : `PC ${b.cpuPercent}% · ${b.freeGb} GB free`}
          </button>
        )}
        {s.devices !== undefined && (
          <button onClick={() => setActiveTab('devices')} title="Connected phones and tablets (Devices)" className={`${chip} ${calm}`}>
            <Tablet className="h-3.5 w-3.5" /> {s.devices} {s.devices === 1 ? 'device' : 'devices'} <Plus className="h-3 w-3 text-indigo-500" />
          </button>
        )}
        {s.paused && (
          <span className={`${chip} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200`}>
            <PauseCircle className="h-3.5 w-3.5" /> AI paused
          </span>
        )}
      </div>
      <button onClick={() => setDarkMode(!darkMode)} aria-label="Toggle light or dark theme" className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
};
