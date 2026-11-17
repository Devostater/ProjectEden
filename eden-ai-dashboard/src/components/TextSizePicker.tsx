// The five text sizes, each written at its own size so you can see what you'll get.
import React from 'react';
import { Check } from 'lucide-react';
import { TEXT_SIZES, useTextSize } from '../textSize.ts';

export const TextSizePicker: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [size, setSize] = useTextSize();
  const current = TEXT_SIZES.find((s) => s.id === size);
  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Text size" className="grid grid-cols-2 gap-2">
        {TEXT_SIZES.map((s, i) => {
          const on = s.id === size;
          const lastOdd = i === TEXT_SIZES.length - 1 && TEXT_SIZES.length % 2 === 1; // fills the last row
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={on}
              onClick={() => setSize(s.id)}
              className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border-2 px-3 font-semibold ${lastOdd ? 'col-span-2' : ''} ${
                on ? 'border-indigo-600 bg-indigo-50 text-slate-900 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-white' : 'border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-100'
              }`}
            >
              <span style={{ fontSize: `${(16 * s.percent) / 100}px` }}>{s.label}</span>
              {on && <Check className="h-5 w-5 shrink-0" />}
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        Text size: {current?.label}
      </p>
    </div>
  );
};
