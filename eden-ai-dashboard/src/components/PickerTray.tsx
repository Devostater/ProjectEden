import React from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, MessagesSquare, Pencil } from 'lucide-react';
import { usePicks, removePick, clearPicks } from '../picker.ts';

// The picked elements, floating at the bottom of the screen while picking or while any are picked.
// They go with the next Code update request or Chief message (both add them automatically).
export const PickerTray: React.FC<{ picking: boolean; onStop: () => void; onCodeUpdate: () => void; onChief?: () => void }> = ({ picking, onStop, onCodeUpdate, onChief }) => {
  const picks = usePicks();
  if (!picking && !picks.length) return null;
  return createPortal(
    <div data-eden-picker-ui="" className="fixed bottom-20 left-1/2 z-[2147483646] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-indigo-400 bg-white/95 p-3 shadow-xl backdrop-blur dark:bg-slate-900/95">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pencil className="h-4 w-4 text-indigo-500" />
        <span className="font-medium text-slate-900 dark:text-white">{picking ? 'Click parts of the screen to pick them' : `${picks.length} picked`}</span>
        <span className="text-xs text-slate-500">{picking ? 'Esc to stop' : 'They go with your next request'}</span>
        <span className="ml-auto flex gap-2">
          {picking && <button onClick={onStop} className="rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-600">Done</button>}
          {picks.length > 0 && (
            <>
              <button onClick={onCodeUpdate} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500"><Wand2 className="h-4 w-4" /> Code update</button>
              {onChief && <button onClick={onChief} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 dark:border-slate-600"><MessagesSquare className="h-4 w-4" /> Ask Chief</button>}
              <button onClick={clearPicks} className="text-xs text-slate-500 hover:underline">Clear</button>
            </>
          )}
        </span>
      </div>
      {picks.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <li key={p.id} title={[p.components.join(' < '), p.where].filter(Boolean).join(' · ')} className="flex max-w-[16rem] items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
              <span className="truncate">{p.components[0] ? `${p.components[0]}: ` : ''}{p.label}</span>
              <button onClick={() => removePick(p.id)} aria-label={`Remove ${p.label}`} className="shrink-0 hover:text-red-500"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
};
