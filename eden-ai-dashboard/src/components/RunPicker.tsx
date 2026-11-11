// The "Lines" dropdown on a project: tick which runs of cards to show, or show all.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Network, Sparkles, Hand, Search, Check } from 'lucide-react';
import type { RunInfo } from '../runs.ts';

export const RunPicker: React.FC<{
  runs: RunInfo[];
  selected: string[] | null; // null = all
  onChange: (selected: string[] | null) => void;
}> = ({ runs, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isOn = (key: string) => selected === null || selected.includes(key);
  const toggle = (key: string) => {
    const current = selected ?? runs.map((r) => r.key);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onChange(next.length === runs.length ? null : next);
  };
  const only = (key: string) => onChange([key]);

  const shown = runs.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()));
  const label =
    selected === null ? 'All lines' : selected.length === 0 ? 'No lines' : selected.length === 1 ? runs.find((r) => r.key === selected[0])?.title || '1 line' : `${selected.length} of ${runs.length} lines`;

  if (!runs.length) return null;

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex max-w-[16rem] items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
          selected === null ? 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300' : 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
        } hover:border-indigo-400`}
      >
        <span className="text-slate-400">Lines:</span>
        <span className="truncate font-medium">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
            <Search className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a line" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white" />
            <button onClick={() => onChange(null)} className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-slate-100 dark:text-indigo-400 dark:hover:bg-slate-800">All</button>
            <button onClick={() => onChange([])} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">None</button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-80 overflow-y-auto p-1">
            {shown.map((r) => {
              const on = isOn(r.key);
              const Icon = r.kind === 'nexus' ? Network : r.kind === 'plan' ? Sparkles : Hand;
              return (
                <li key={r.key} role="option" aria-selected={on} className="group flex items-center gap-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <button onClick={() => toggle(r.key)} className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900 dark:text-white" title={r.title}>{r.title}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {r.key !== 'manual' && <span>{new Date(r.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                        <span>{r.done}/{r.total} done</span>
                        {r.review > 0 && <span className="text-amber-600 dark:text-amber-400">{r.review} to review</span>}
                        {r.running && <span className="text-indigo-600 dark:text-indigo-400">working</span>}
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(r.done / r.total) * 100}%` }} />
                      </span>
                    </span>
                  </button>
                  <button onClick={() => only(r.key)} title="Show only this line" className="mr-1 shrink-0 rounded px-2 py-1 text-xs text-slate-500 opacity-0 hover:bg-slate-100 hover:text-indigo-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-slate-800">
                    Only
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-4 text-sm text-slate-500">No line matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
