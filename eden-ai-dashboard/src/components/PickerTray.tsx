import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, MessagesSquare, Pencil, Loader2 } from 'lucide-react';
import { usePicks, removePick, clearPicks, picksAsText, getPickTarget } from '../picker.ts';
import { api } from '../api.ts';

// The picked elements, floating at the bottom of the screen while picking or while any are picked.
// Say what should change and start a Code update for EDEN right here, or take the picks to Chief.
export const PickerTray: React.FC<{ picking: boolean; onStop: () => void; onStarted: () => void; onChief?: () => void }> = ({ picking, onStop, onStarted, onChief }) => {
  const picks = usePicks();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!picking && !picks.length) return null;

  const start = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const t = getPickTarget();
      if (t.name && !t.codebaseId) throw new Error(`${t.name} has no code set yet. Choose its code in Project settings first.`);
      await api('POST', '/api/updates', { request: text.trim() + picksAsText(), codebaseId: t.codebaseId || 'hub', local: false });
      setText('');
      clearPicks();
      onStop();
      onStarted();
    } catch (err: any) {
      setError(err.message || 'Could not start the update.');
    }
    setBusy(false);
  };

  return createPortal(
    <div data-eden-picker-ui="" className="fixed bottom-20 left-1/2 z-[2147483646] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-indigo-400 bg-white/95 p-3 shadow-xl backdrop-blur dark:bg-slate-900/95">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pencil className="h-4 w-4 text-indigo-500" />
        <span className="font-medium text-slate-900 dark:text-white">{picking ? 'Click parts of the screen to pick them' : `${picks.length} picked${getPickTarget().name ? ` in ${getPickTarget().name}` : ' in EDEN'}`}</span>
        <span className="text-xs text-slate-500">{picking ? 'Esc to stop' : 'Say what should change'}</span>
        <span className="ml-auto flex gap-2">
          {picking && <button onClick={onStop} className="rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-600">Done</button>}
          {picks.length > 0 && <button onClick={clearPicks} className="text-xs text-slate-500 hover:underline">Clear</button>}
        </span>
      </div>
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
            <span className="text-xs text-slate-500">Ctrl+Enter starts it. Nothing changes until you apply it in Code updates.</span>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
};
