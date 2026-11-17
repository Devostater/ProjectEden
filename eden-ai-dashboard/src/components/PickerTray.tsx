import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, MessagesSquare, Pencil, Loader2 } from 'lucide-react';
import { usePicks, removePick, clearPicks, picksAsText, getPickTarget } from '../picker.ts';
import { api } from '../api.ts';

// The picked elements, floating at the bottom of the screen while picking or while any are picked.
// Say what should change and start a Code update for EDEN right here, or take the picks to Chief.
// Option (saved on this device): jump to Code updates after sending. Off by default, so you keep working.
const JUMP_KEY = 'eden_picker_jump';
const readJump = () => { try { return localStorage.getItem(JUMP_KEY) === '1'; } catch { return false; } };

export const PickerTray: React.FC<{ picking: boolean; onStop: () => void; onResume: () => void; onClose: () => void; onOpenUpdates: () => void; onChief?: () => void }> = ({ picking, onStop, onResume, onClose, onOpenUpdates, onChief }) => {
  const picks = usePicks();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [jump, setJumpState] = useState(readJump);
  const setJump = (v: boolean) => { setJumpState(v); try { localStorage.setItem(JUMP_KEY, v ? '1' : '0'); } catch {} };

  const start = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    setSent('');
    try {
      const t = getPickTarget();
      if (t.name && !t.codebaseId) throw new Error(`${t.name} has no code set yet. Choose its code in Project settings first.`);
      await api('POST', '/api/updates', { request: text.trim() + picksAsText(), codebaseId: t.codebaseId || 'hub', local: false });
      setText('');
      clearPicks();
      onStop();
      if (jump) { onClose(); onOpenUpdates(); }
      else setSent(`Started. It keeps working in Code updates while you carry on${t.name ? ` (${t.name})` : ''}.`);
    } catch (err: any) {
      setError(err.message || 'Could not start the update.');
    }
    setBusy(false);
  };

  // Where the tray sits, so it never covers what you're picking:
  // - above the bottom panel, when the tray (its real height) fits there;
  // - otherwise at the top of the screen, under the top bar (tall or full-screen panel, e.g. picking in the App tab);
  // - with no bottom panel (phone), the usual spot near the bottom.
  const trayRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ bottom: number } | { top: number } | null>(null);
  useEffect(() => {
    const panel = document.querySelector('[data-eden-bottom-panel]') as HTMLElement | null;
    const measure = () => {
      const r = panel?.getBoundingClientRect();
      const gap = r && r.width > 0 && r.height > 0 ? Math.min(window.innerHeight, window.innerHeight - r.top) : 0;
      if (gap <= 0) return setPlace(null);
      const trayH = trayRef.current?.offsetHeight || 200;
      const room = window.innerHeight - gap - 12 - 64; // keep clear of the top bar
      setPlace(room >= trayH ? { bottom: Math.round(gap + 12) } : { top: 64 });
    };
    measure();
    window.addEventListener('resize', measure);
    const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (panel) watch?.observe(panel);
    if (trayRef.current) watch?.observe(trayRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      watch?.disconnect();
    };
  }, []);
  const placeStyle: React.CSSProperties | undefined = !place
    ? undefined
    : 'bottom' in place
      ? { bottom: place.bottom, maxHeight: `calc(100dvh - ${place.bottom + 64}px)` }
      : { top: place.top, maxHeight: `calc(100dvh - ${place.top + 16}px)` };

  return createPortal(
    <div ref={trayRef} data-eden-picker-ui="" style={placeStyle} className={`fixed ${place ? '' : 'bottom-20'} left-1/2 z-[2147483646] max-h-[calc(100dvh-6rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-xl border border-indigo-400 bg-white/95 p-3 shadow-xl backdrop-blur dark:bg-slate-900/95`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pencil className="h-4 w-4 text-indigo-500" />
        <span className="font-medium text-slate-900 dark:text-white">{picking ? 'Click parts of the screen to pick them' : picks.length ? `${picks.length} picked${getPickTarget().name ? ` in ${getPickTarget().name}` : ' in EDEN'}` : 'Picker'}</span>
        <span className="text-xs text-slate-500">{picking ? 'Esc to stop' : picks.length ? 'Say what should change' : ''}</span>
        <span className="ml-auto flex items-center gap-2">
          {picking ? (
            <button onClick={onStop} className="rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-600">Done</button>
          ) : (
            <button onClick={() => { setSent(''); onResume(); }} className="rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-600">Pick more</button>
          )}
          {picks.length > 0 && <button onClick={clearPicks} className="text-xs text-slate-500 hover:underline">Clear</button>}
          <button onClick={onClose} aria-label="Close the picker" title="Close (the pencil also closes it)" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </span>
      </div>
      {sent && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          {sent} <button onClick={onOpenUpdates} className="text-indigo-600 hover:underline dark:text-indigo-400">Open Code updates</button>
        </p>
      )}
      {picks.length > 0 && (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {picks.map((p) => (
              <li key={p.id} title={[p.components.join(' < '), p.where].filter(Boolean).join(' · ')} className="flex max-w-[16rem] items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
                <span className="truncate">{p.components[0] ? `${p.components[0]}: ` : ''}{p.label}</span>
                <button onClick={() => removePick(p.id)} aria-label={`Remove ${p.label}`} className="shrink-0 hover:text-red-500"><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start(); }}
            rows={2}
            placeholder="What should change about these? e.g. make this button smaller and move it to the right"
            aria-label="What should change about the picked elements"
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <button onClick={start} disabled={!text.trim() || busy} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Start code update
            </button>
            {onChief && <button onClick={onChief} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-600"><MessagesSquare className="h-4 w-4" /> Ask Chief instead</button>}
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300" title="Saved on this device">
              <input type="checkbox" checked={jump} onChange={(e) => setJump(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
              Open Code updates after sending
            </label>
            <span className="text-xs text-slate-500">Ctrl+Enter starts it. Nothing changes until you apply it.</span>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
};
