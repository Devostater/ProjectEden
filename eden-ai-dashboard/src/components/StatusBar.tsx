import React, { useEffect, useRef, useState } from 'react';
import { TextSizePicker } from './TextSizePicker.tsx';
import { Wifi, WifiOff, Leaf, Gauge, Tablet, Plus, PauseCircle, Sun, Moon, Inbox, Columns2, Square, Search, Pencil } from 'lucide-react';
import { startPicking, setTrayOpen, useTrayOpen, usePicks } from '../picker.ts';
import { PickerTray } from './PickerTray.tsx';
import type { AppTab } from './Sidebar.tsx';
import { VoiceCommands, type CommandActions } from './VoiceCommands.tsx';
import { openPanel } from '../panel.ts';
import type { KeepPage } from '../panes.ts';
import { TITLES } from './Header.tsx';
import { useTickerItems } from '../ticker.ts';

interface Status {
  offline?: { offline: boolean; mode: string; localFirst: boolean; week: { localPercent: number; local: number; cloud: number } };
  busy?: { active: boolean; enabled: boolean; cpuPercent: number; freeGb: number; reason: string };
  devices?: number;
  paused?: boolean;
  pausedForUpdate?: boolean; // paused by a running code update; resumes by itself
}

const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// Slim bar across the top: where things stand at a glance, each part a shortcut to where it's set.
export const StatusBar: React.FC<{ title: string; setActiveTab: (t: AppTab) => void; darkMode: boolean; setDarkMode: (v: boolean) => void; reviewCount?: number; actions: CommandActions; split?: boolean; onToggleSplit?: () => void; keepPage?: KeepPage; onKeepPage?: (v: KeepPage) => void; pauseSlot?: React.ReactNode }> = ({ split = false, onToggleSplit, keepPage = 'focused', onKeepPage, pauseSlot, title, setActiveTab, darkMode, setDarkMode, reviewCount = 0, actions }) => {
  const [s, setS] = useState<Status>({});
  const ticker = useTickerItems();
  useEffect(() => {
    const load = async () => {
      const [offline, busy, devices, pause] = await Promise.all([get('/api/offline'), get('/api/pc-busy'), get('/api/devices'), get('/api/ai/pause')]);
      setS({
        offline: offline || undefined,
        busy: busy || undefined,
        devices: devices?.devices ? devices.devices.filter((d: any) => d.state === 'device').length : undefined,
        paused: pause?.paused,
        pausedForUpdate: pause?.heldForUpdate,
      });
    };
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => clearInterval(t);
  }, []);

  // Text size picker ("Aa"): stays open while you try sizes; Esc or a click outside closes it.
  const [aaOpen, setAaOpen] = useState(false);
  const aaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aaOpen) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setAaOpen(false);
    const away = (e: PointerEvent) => !aaRef.current?.contains(e.target as Node) && setAaOpen(false);
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', away);
    };
  }, [aaOpen]);

  // Attention chips always show; calm ones ('Online', 'n devices'…) only on bigger screens so a phone bar isn't crowded.
  const chip = 'h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors';
  const calm = 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';
  // Routine status (online, PC, devices) folds into one Status button; chips that need you always show.
  const [more, setMore] = useState(false);
  const o = s.offline;
  const b = s.busy;
  return (
    <div className="relative z-20 flex min-h-[5.5rem] items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      {title && <span className="mr-1 max-w-[40vw] shrink-0 truncate text-base font-bold text-slate-900 dark:text-white">{title}</span>}
      <div className={`flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] ${ticker ? 'max-w-[45%] shrink-0' : 'flex-1'}`}>
        {reviewCount > 0 && (
          <button onClick={() => openPanel('review')} title="Finished work waiting for you: open Review" className={`${chip} flex border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200`}>
            <Inbox className="h-3.5 w-3.5" /> {reviewCount} to review
          </button>
        )}
        {o && (
          <button onClick={() => setActiveTab('settings')} title="Offline mode (Account → Connections)" className={`${chip} ${o.offline ? 'flex border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200' : `${more ? 'hidden md:flex' : 'hidden'} ${calm}`}`}>
            {o.offline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5 text-emerald-500" />}
            {o.offline ? 'Offline: local AI' : 'Online'}
          </button>
        )}
        {o?.localFirst && !o.offline && (
          <button onClick={() => setActiveTab('settings')} title="Local first: share of AI work done on this PC this week" className={`${chip} ${more ? 'hidden md:flex' : 'hidden'} border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40`}>
            <Leaf className="h-3.5 w-3.5" /> {o.week.local + o.week.cloud ? `${o.week.localPercent}% local` : 'Local first'}
          </button>
        )}
        {b && (
          <button onClick={() => setActiveTab('devices')} title={b.active ? `PC busy: ${b.reason}` : 'This PC (Devices)'} className={`${chip} ${b.active ? 'flex border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : `${more ? 'hidden md:flex' : 'hidden'} ${calm}`}`}>
            <Gauge className="h-3.5 w-3.5" /> {b.active ? 'PC busy' : `PC ${b.cpuPercent}% · ${b.freeGb} GB free`}
          </button>
        )}
        {s.devices !== undefined && (
          <button onClick={() => setActiveTab('devices')} title="Connected phones and tablets (Devices)" className={`${chip} ${more ? 'hidden md:flex' : 'hidden'} ${calm}`}>
            <Tablet className="h-3.5 w-3.5" /> {s.devices} {s.devices === 1 ? 'device' : 'devices'} <Plus className="h-3 w-3 text-indigo-500" />
          </button>
        )}
        {s.paused && (
          <span className={`${chip} flex border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200`}>
            <PauseCircle className="h-3.5 w-3.5" /> {s.pausedForUpdate ? 'AI paused while an update is applied' : 'AI paused'}
          </span>
        )}
        <button onClick={() => setMore((v) => !v)} aria-expanded={more} title={more ? 'Hide status' : 'Show status: online, PC, devices'} className={`${chip} hidden md:flex ${calm}`}>
          {more ? 'Less' : 'Status'}
        </button>
      </div>
      {/* News ticker: what is happening right now. Fills the height of the bar. Hover to pause. */}
      {ticker && (
        <div role="status" aria-label="What is happening now" className="eden-ticker flex min-w-0 flex-1 items-center self-stretch overflow-hidden rounded-lg border border-slate-200 bg-white text-base font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <div className="eden-ticker-track flex w-max gap-10 whitespace-nowrap px-4">
            {[0, 1].map((copy) => (
              <div key={copy} aria-hidden={copy === 1} className="flex gap-10">
                {ticker.map((t) => (
                  <span key={t}>• {t}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <GoBox setActiveTab={setActiveTab} />
      <PickButton setActiveTab={setActiveTab} />
      {pauseSlot}
      {split && onKeepPage && (
        <select value={keepPage} onChange={(e) => onKeepPage(e.target.value as KeepPage)} aria-label="When going back to one page, keep" title="When going back to one page, keep" className="hidden h-8 shrink-0 rounded-lg border border-slate-300 bg-white px-1 text-xs text-slate-700 md:block dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          <option value="focused">Keep: last used</option>
          <option value="left">Keep: left</option>
          <option value="right">Keep: right</option>
        </select>
      )}
      {onToggleSplit && (
        <button
          onClick={onToggleSplit}
          aria-pressed={split}
          title={split ? (keepPage === 'left' ? 'One page: keep the left page' : keepPage === 'right' ? 'One page: keep the right page' : 'One page: keep the page you used last') : 'Open a second page beside this one'}
          className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border md:flex ${split ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200' : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'}`}
        >
          {split ? <Square className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}<span className="sr-only">{split ? 'One page' : 'Two pages'}</span>
        </button>
      )}
      <VoiceCommands actions={actions} />
      <div ref={aaRef} className="shrink-0">
        <button
          onClick={() => setAaOpen((v) => !v)}
          aria-label="Text size"
          aria-expanded={aaOpen}
          title="Text size"
          className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Aa
        </button>
        {aaOpen && (
          <div className="absolute right-2 top-full z-30 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-300 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <TextSizePicker />
          </div>
        )}
      </div>
    </div>
  );
};

// Search/go: pick or type a page, Enter goes there.
const GoBox: React.FC<{ setActiveTab: (t: AppTab) => void }> = ({ setActiveTab }) => {
  const [q, setQ] = useState('');
  const [miss, setMiss] = useState(false);
  const pages = Object.entries(TITLES) as [AppTab, string][];
  const go = () => {
    const t = q.trim().toLowerCase();
    if (!t) return;
    const hit = pages.find(([, n]) => n.toLowerCase() === t) || pages.find(([, n]) => n.toLowerCase().startsWith(t)) || pages.find(([id, n]) => n.toLowerCase().includes(t) || id.includes(t));
    if (!hit) return setMiss(true);
    setActiveTab(hit[0]);
    setQ('');
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} role="search" className="hidden shrink-0 items-center md:flex">
      <label className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 text-sm ${miss ? 'border-amber-400' : 'border-slate-300 dark:border-slate-600'}`}>
        <Search className="h-4 w-4 text-slate-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setMiss(false); }} list="eden-go-pages" placeholder="Search / go to…" aria-label="Go to a page" title={miss ? 'No page with that name' : 'Type a page name, then Enter'} className="w-36 bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none lg:w-48 dark:text-slate-100" />
      </label>
      <datalist id="eden-go-pages">{[...new Set(pages.map(([, n]) => n).filter(Boolean))].map((n) => <option key={n} value={n} />)}</datalist>
    </form>
  );
};

// The pencil: pick parts of the screen to point the AI at them (see picker.ts).
const PickButton: React.FC<{ setActiveTab: (t: AppTab) => void }> = ({ setActiveTab }) => {
  const [on, setOn] = useState(false); // picking right now
  const open = useTrayOpen(); // the tray is showing
  const picks = usePicks();
  const stopRef = useRef<(() => void) | null>(null);
  const stop = () => { stopRef.current?.(); stopRef.current = null; setOn(false); };
  const start = () => { stopRef.current = startPicking(document, () => { stopRef.current = null; setOn(false); }); setOn(true); };
  // The pencil opens the picker (and starts picking); pressing it again closes it. Picks are kept until sent or cleared.
  const toggle = () => { if (open) { stop(); setTrayOpen(false); } else { setTrayOpen(true); start(); } };
  useEffect(() => () => stopRef.current?.(), []);
  return (
    <>
      <button data-eden-picker-ui="" onClick={toggle} aria-pressed={open} title={open ? 'Close the picker' : 'Pick parts of the screen to show the AI what to change'} aria-label="Pick elements" className={`hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border md:flex relative ${open ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
        <Pencil className="h-4 w-4" />
        {!open && picks.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-4 text-white">{picks.length}</span>}
      </button>
      {open && <PickerTray picking={on} onStop={stop} onResume={start} onClose={() => { stop(); setTrayOpen(false); }} onOpenUpdates={() => { try { sessionStorage.setItem('eden_updates_open', 'active'); } catch {} setActiveTab('updates'); }} onChief={() => { stop(); setActiveTab('projects'); }} />}
    </>
  );
};
