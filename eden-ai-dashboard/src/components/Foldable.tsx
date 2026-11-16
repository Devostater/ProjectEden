import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// A panel you can fold away to a single line. The choice is remembered on this browser under `storageKey`.
export function useFolded(storageKey: string, initial = false): [boolean, () => void] {
  const [folded, setFolded] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setFolded((f) => {
      try {
        localStorage.setItem(storageKey, f ? '0' : '1');
      } catch {}
      return !f;
    });
  return [folded, toggle];
}

// The heading row of a foldable panel: the whole row is the button, with a chevron and an optional hint while folded.
export const FoldHeader: React.FC<{ title: React.ReactNode; folded: boolean; onToggle: () => void; foldedHint?: React.ReactNode; className?: string }> = ({ title, folded, onToggle, foldedHint, className = '' }) => (
  <button onClick={onToggle} aria-expanded={!folded} className={`flex w-full items-center gap-2 text-left ${className}`}>
    <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${folded ? '-rotate-90' : ''}`} />
    <span className="font-semibold text-slate-900 dark:text-white">{title}</span>
    {folded && foldedHint && <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">{foldedHint}</span>}
    <span className="sr-only">{folded ? '(folded, press to show)' : '(press to fold)'}</span>
  </button>
);
