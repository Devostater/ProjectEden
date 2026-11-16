// A pane of the two-pages view: a 48px header (page name, Swap sides, Close) when two pages are side by side, and a
// scroller with the same sizing as the old <main> so full-height pages (Chat, Nexus, Projects) still fill.
// No transform/filter/z-index here: pages have full-window dialogs (fixed inset-0) that must not be trapped.
import React, { useEffect, useRef } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';
import { PAGES } from '../pages.tsx';
import { rootPx } from '../textSize.ts';

const btn = 'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

export const PaneFrame: React.FC<{
  tab: AppTab;
  order: number;
  flex: string;
  showHeader: boolean;
  focused: boolean;
  hidden: boolean;
  onFocus: () => void;
  onSwap: () => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ tab, order, flex, showHeader, focused, hidden, onFocus, onSwap, onClose, children }) => {
  const page = PAGES.find((p) => p.id === tab);
  const Icon = page?.icon;
  const ref = useRef<HTMLElement>(null);
  // Narrow panes stop pages laying out by window width (see .eden-pane rules in index.css).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rem = el.clientWidth / rootPx();
      if (rem > 0 && rem < 40) el.dataset.narrow = '';
      else delete el.dataset.narrow;
      if (rem > 0 && rem < 30) el.dataset.tight = '';
      else delete el.dataset.tight;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <section
      ref={ref}
      aria-label={page?.label || tab}
      data-pane
      data-pane-focus={focused || !showHeader ? '' : undefined}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      className={`eden-pane flex min-h-0 min-w-0 flex-col overflow-hidden ${hidden ? 'hidden' : ''}`}
      style={{ order, flex }}
    >
      {showHeader && (
        <div
          className={`flex h-12 shrink-0 items-center gap-1 border-b border-t-4 border-b-slate-200 bg-white px-2 dark:border-b-slate-800 dark:bg-slate-900 ${
            focused ? 'border-t-indigo-600 dark:border-t-indigo-400' : 'border-t-transparent'
          }`}
        >
          {Icon && <Icon className="ml-1 h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" />}
          <h2 className={`min-w-0 flex-1 truncate text-base text-slate-900 dark:text-white ${focused ? 'font-bold underline decoration-2 underline-offset-4' : 'font-medium'}`}>{page?.label || tab}</h2>
          <button onClick={onSwap} aria-label="Swap sides" title="Swap the two pages" className={btn}>
            <ArrowLeftRight className="h-5 w-5" />
          </button>
          <button onClick={onClose} aria-label={`Close ${page?.label || tab}`} title="Close this page" className={btn}>
            <X className="h-5 w-5" /> Close
          </button>
        </div>
      )}
      <div data-pane-scroll className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </section>
  );
};

// When two pages are open but there isn't room for both side by side: one shows, a two-button switch flips them.
export const PaneSwitch: React.FC<{ panes: AppTab[]; focus: 0 | 1; onFocus: (i: 0 | 1) => void; onCloseOther: () => void }> = ({ panes, focus, onFocus, onCloseOther }) => (
  <div
    title="Not enough room to show both side by side. Hide the left bar or pick a smaller text size."
    className="hidden min-h-12 shrink-0 items-center gap-1 border-b border-slate-200 bg-white p-1 md:flex dark:border-slate-800 dark:bg-slate-900"
  >
    {panes.map((t, i) => {
      const p = PAGES.find((x) => x.id === t);
      const on = i === focus;
      return (
        <button
          key={t}
          onClick={() => onFocus(i as 0 | 1)}
          aria-pressed={on}
          className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg text-base ${on ? 'bg-indigo-600 font-bold text-white' : 'font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
        >
          {p && <p.icon className="h-5 w-5" />} {p?.label || t}
        </button>
      );
    })}
    <button onClick={onCloseOther} aria-label="Close the page that is not showing" title="Close the page that is not showing" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
      <X className="h-5 w-5" />
    </button>
  </div>
);

// The bar between the two pages: drag it, or focus it and use the arrow keys (Home/End to the limits, Enter resets).
export const SplitHandle: React.FC<{ ratio: number; setRatio: (r: number, save?: boolean) => void; containerRef: React.RefObject<HTMLElement | null> }> = ({ ratio, setRatio, containerRef }) => {
  // Keep each pane at least 22rem wide.
  const limits = () => {
    const w = containerRef.current?.clientWidth || 1;
    const min = Math.min(0.5, (22 * rootPx()) / w);
    return [Math.max(0.25, min), Math.min(0.75, 1 - min)] as const;
  };
  const clamp = (r: number) => {
    const [lo, hi] = limits();
    return Math.min(hi, Math.max(lo, r));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the two pages"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={25}
      aria-valuemax={75}
      tabIndex={0}
      title="Drag to resize. Double-click to make them equal."
      style={{ order: 1 }}
      className="relative w-3 shrink-0 cursor-col-resize touch-none bg-slate-200 hover:bg-indigo-500/40 focus-visible:bg-indigo-500/40 dark:bg-slate-800"
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const box = containerRef.current?.getBoundingClientRect();
        if (!box) return;
        const move = (ev: PointerEvent) => setRatio(clamp((ev.clientX - box.left) / box.width), false);
        const up = (ev: PointerEvent) => {
          setRatio(clamp((ev.clientX - box.left) / box.width), true);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => setRatio(0.5)}
      onKeyDown={(e) => {
        const [lo, hi] = limits();
        if (e.key === 'ArrowLeft') setRatio(clamp(ratio - 0.05));
        else if (e.key === 'ArrowRight') setRatio(clamp(ratio + 0.05));
        else if (e.key === 'Home') setRatio(lo);
        else if (e.key === 'End') setRatio(hi);
        else if (e.key === 'Enter') setRatio(0.5);
        else return;
        e.preventDefault();
      }}
    >
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-500" />
    </div>
  );
};
