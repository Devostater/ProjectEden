import React, { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';

// Pause AI / Resume, for the sidebar. Shows how much is running right now.
export const PauseAI: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState({ cards: 0, rooms: 0 });
  const [busy, setBusy] = useState(false);

  const apply = (d: any) => {
    if (!d) return;
    setPaused(d.paused);
    setRunning(d.running);
  };
  useEffect(() => {
    const load = () =>
      document.visibilityState === 'visible' &&
      fetch('/api/ai/pause')
        .then((r) => r.json())
        .then(apply)
        .catch(() => {});
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      apply(await fetch('/api/ai/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !paused }) }).then((r) => r.json()));
    } finally {
      setBusy(false);
    }
  };

  const active = running.cards + running.rooms;
  const label = paused ? 'Resume AI' : 'Pause AI';
  const detail = paused ? 'Nothing runs on its own' : active ? `${active} working now` : 'Team is idle';

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={paused}
      aria-label={`${label}. ${detail}.`}
      title={paused ? 'Let the team work on cards and discussions again' : 'Stop Nexus discussions and card work until you resume. Chat still works.'}
      className={`flex w-full items-center rounded-lg text-sm transition-colors disabled:opacity-60 ${compact ? 'justify-center py-2.5' : 'gap-3 px-3 py-2'} ${
        paused
          ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${paused ? 'bg-amber-500 text-white' : active ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-800'}`}>
        {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
      </span>
      {!compact && (
        <span className="min-w-0 text-left">
          <span className="block font-medium leading-tight">{label}</span>
          <span className="block truncate text-xs leading-tight opacity-75">{detail}</span>
        </span>
      )}
    </button>
  );
};
